import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Bibliothèques que les portages chargent au lancement sans les contenir (DLSS de NVIDIA, FidelityFX
 * d'AMD) : SixM ne les fournit pas, il cherche seulement où elles sont déjà sur ce PC. Lecture de dossiers
 * seulement, sur quelques endroits connus, sans parcourir tout le disque.
 */
export const KINDS = {
  streamline: {
    file: 'sl.interposer.dll',
    // Dossier fixe, relatif à une racine.
    fixed: (c) => [
      c.localAppData && [c.localAppData, 'victory', 'nvidia-sdk', 'Streamline', 'bin', 'x64'],
      c.src && [c.src, 'nvidia-sdk', 'Streamline', 'bin', 'x64'],
      c.exeDir && [c.exeDir, 'nvidia-sdk', 'Streamline', 'bin', 'x64'],
      c.exeDir && [c.exeDir],
    ],
    // Un SDK décompressé à la main : dossier nommé ainsi, puis l'un de ces chemins dedans.
    named: /streamline/i,
    inside: [['bin', 'x64'], ['*', 'bin', 'x64']],
  },
  fidelityfx: {
    files: ['amd_fidelityfx_framegeneration_dx12.dll', 'amd_fidelityfx_upscaler_dx12.dll'],
    fixed: (c) => [
      c.exeDir && [c.exeDir, 'fidelityfx'],
      c.src && [c.src, 'amd-sdk', 'FidelityFX', 'bin'],
      c.src && [c.src, 'fidelityfx'],
      c.localAppData && [c.localAppData, 'victory', 'fidelityfx'],
      c.localAppData && [c.localAppData, 'victory', 'amd-sdk', 'FidelityFX', 'bin'],
      c.exeDir && [c.exeDir],
    ],
    named: /fidelityfx/i,
    inside: [[], ['bin'], ['signedbin'], ['PrebuiltSignedDLL'], ['Kits', 'FidelityFX', 'signedbin'], ['Kits', 'FidelityFX', 'bin'], ['*', 'Kits', 'FidelityFX', 'signedbin'], ['*', 'bin']],
  },
};

/** Endroits où l'on range d'habitude un SDK téléchargé. */
export function searchRoots(env = process.env, home = os.homedir()) {
  const roots = [path.join(home, 'Downloads'), path.join(home, 'Téléchargements'), path.join(home, 'Documents'), path.join(home, 'Desktop'), home];
  if (process.platform === 'win32' || env.SystemDrive) {
    const drive = `${env.SystemDrive ?? 'C:'}\\`;
    roots.push(path.join(drive, 'dev', 'sdk'), path.join(drive, 'dev'), path.join(drive, 'sdk'), drive);
  }
  return roots;
}

const list = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

/** Le fichier attendu est là (casse ignorée, comme sous Windows). */
function has(dir, file) {
  const want = file.toLowerCase();
  return list(dir).some((e) => e.name.toLowerCase() === want && (e.isFile() || e.isSymbolicLink()));
}

/** Dossiers d'un chemin où « * » vaut n'importe quel sous-dossier. */
function expand(base, parts) {
  let dirs = [base];
  for (const p of parts) {
    dirs = p === '*' ? dirs.flatMap((d) => list(d).filter((e) => e.isDirectory()).map((e) => path.join(d, e.name)).slice(0, 20))
      : dirs.map((d) => path.join(d, p));
  }
  return dirs;
}

/**
 * Dossier qui contient la bibliothèque `kind`, ou null.
 * ctx : { exeDir, src, localAppData, roots } ; `file` : un fichier précis à la place de ceux du type.
 */
export function findSdk(kind, ctx = {}, file = null) {
  const k = KINDS[kind];
  if (!k) return null;
  const files = file ? [file] : k.files ?? [k.file];
  const ok = (d) => isDir(d) && files.every((f) => has(d, f));
  for (const parts of k.fixed(ctx).filter(Boolean)) {
    const d = path.join(...parts);
    if (ok(d)) return d;
  }
  for (const root of ctx.roots ?? []) {
    for (const e of list(root)) {
      if (!e.isDirectory() || !k.named.test(e.name)) continue;
      for (const inside of k.inside) {
        const found = expand(path.join(root, e.name), inside).find(ok);
        if (found) return found;
      }
    }
  }
  return null;
}
