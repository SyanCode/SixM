import zlib from 'node:zlib';

const UTF8 = 0x800;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // date fixe : archives reproductibles

/** entries : [{ name, data: Buffer|string, mode? }] -> Buffer zip. */
export function createZip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, data, mode = 0o644 } of entries) {
    const raw = Buffer.from(data);
    const deflated = zlib.deflateRawSync(raw);
    const store = deflated.length >= raw.length;
    const body = store ? raw : deflated;
    const file = Buffer.from(name, 'utf8');
    const common = Buffer.alloc(26);
    common.writeUInt16LE(20, 0);
    common.writeUInt16LE(UTF8, 2);
    common.writeUInt16LE(store ? 0 : 8, 4);
    common.writeUInt16LE(0, 6);
    common.writeUInt16LE(DOS_DATE, 8);
    common.writeUInt32LE(zlib.crc32(raw), 10);
    common.writeUInt32LE(body.length, 14);
    common.writeUInt32LE(raw.length, 18);
    common.writeUInt16LE(file.length, 22);

    const local = Buffer.concat([Buffer.from('PK\x03\x04', 'latin1'), common, file, body]);
    const tail = Buffer.alloc(14);
    tail.writeUInt32LE(((0o100000 | mode) << 16) >>> 0, 6); // droits Unix
    tail.writeUInt32LE(offset, 10);
    // Système d'origine 3 (Unix), pour que les droits soient lus.
    centrals.push(Buffer.concat([Buffer.from('PK\x01\x02', 'latin1'), Buffer.from([20, 3]), common, tail, file]));
    locals.push(local);
    offset += local.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.write('PK\x05\x06', 'latin1');
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;

/** Refuse tout chemin qui pourrait sortir du dossier d'extraction ou piéger Windows. */
export function isSafePath(name) {
  return name.length > 0 && name.length <= 200 && name.split('/').every((part) =>
    part !== '' && part !== '.' && part !== '..'
    && !/[\u0000-\u001f\\:*?"<>|]/.test(part) && !/[. ]$/.test(part) && !RESERVED.test(part));
}

/** Lit un zip NON FIABLE. Retourne [{ name, data }] sans les dossiers. */
export function readZip(buf, { maxEntries = 1000, maxBytes = 50 << 20 } = {}) {
  try {
    return parse(buf, maxEntries, maxBytes);
  } catch (e) {
    throw new Error(e instanceof RangeError || e.code?.startsWith('Z_') ? 'fichier zip abîmé' : e.message);
  }
}

function parse(buf, maxEntries, maxBytes) {
  let end = buf.length - 22;
  const stop = Math.max(0, end - 0xffff);
  while (end >= stop && buf.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < stop) throw new Error('ce fichier n\'est pas un zip');
  const count = buf.readUInt16LE(end + 10);
  if (count > maxEntries) throw new Error('trop de fichiers dans le zip');
  let at = buf.readUInt32LE(end + 16);
  let left = maxBytes;
  const out = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error('fichier zip abîmé');
    const flags = buf.readUInt16LE(at + 8), method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16), packed = buf.readUInt32LE(at + 20), size = buf.readUInt32LE(at + 24);
    const nameLength = buf.readUInt16LE(at + 28);
    const start = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLength).replaceAll('\\', '/');
    at += 46 + nameLength + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
    if (name.endsWith('/')) continue;
    if (flags & 1) throw new Error('zip chiffré non pris en charge');
    if (!isSafePath(name)) throw new Error(`chemin refusé dans le zip : ${name.slice(0, 80)}`);
    if (size > left) throw new Error('contenu du zip trop volumineux');
    if (buf.readUInt32LE(start) !== 0x04034b50) throw new Error('fichier zip abîmé');
    const from = start + 30 + buf.readUInt16LE(start + 26) + buf.readUInt16LE(start + 28);
    const body = buf.subarray(from, from + packed);
    let data;
    if (method === 0) data = Buffer.from(body);
    // La taille annoncée ne fait pas foi : on borne aussi la décompression réelle.
    else if (method === 8) data = zlib.inflateRawSync(body, { maxOutputLength: Math.max(1, size) });
    else throw new Error('compression zip non prise en charge');
    if (data.length !== size || zlib.crc32(data) !== crc) throw new Error('fichier zip abîmé');
    left -= size;
    out.push({ name, data });
  }
  return out;
}
