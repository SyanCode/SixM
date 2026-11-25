import fs from 'node:fs';
import path from 'node:path';
import { isSafePath, readZip } from './zip.js';

const NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/i;

/** Mods (ressources) installés dans un dossier `resources`. */
export function listMods(resourcesDir) {
  if (!fs.existsSync(resourcesDir)) return [];
  return fs.readdirSync(resourcesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(resourcesDir, d.name, 'resource.json')))
    .map((d) => {
      try {
        const m = JSON.parse(fs.readFileSync(path.join(resourcesDir, d.name, 'resource.json'), 'utf8'));
        return { name: d.name, description: String(m.description ?? '').slice(0, 200), server: !!m.server?.length, client: !!m.client?.length };
      } catch {
        return { name: d.name, description: 'resource.json illisible', server: false, client: false, broken: true };
      }
    });
}

/** Installe un mod depuis un zip : resource.json à la racine ou dans un unique dossier. */
export function importMod(resourcesDir, buffer, fileName = '') {
  const files = readZip(buffer).filter((f) => !f.name.startsWith('__MACOSX/') && !f.name.endsWith('.DS_Store'));
  const manifests = files.filter((f) => /^([^/]+\/)?resource\.json$/.test(f.name));
  if (manifests.length !== 1) throw new Error('le zip doit contenir un seul mod, avec son fichier resource.json');
  const prefix = manifests[0].name.slice(0, -'resource.json'.length);

  let manifest;
  try { manifest = JSON.parse(manifests[0].data.toString('utf8').replace(/^﻿/, '')); }
  catch { throw new Error('resource.json n\'est pas un JSON valide'); }
  if (!manifest || typeof manifest !== 'object') throw new Error('resource.json invalide');
  const name = [manifest.name, prefix.slice(0, -1), path.parse(fileName).name].find((n) => typeof n === 'string' && n);
  if (!NAME.test(name ?? '') || !isSafePath(name)) throw new Error('nom de mod invalide (lettres, chiffres, - et _)');

  const inside = files.filter((f) => f.name.startsWith(prefix)).map((f) => ({ name: f.name.slice(prefix.length), data: f.data }));
  for (const key of ['server', 'client']) {
    const list = manifest[key] ?? [];
    if (!Array.isArray(list) || !list.every((f) => typeof f === 'string')) throw new Error(`resource.json : "${key}" doit être une liste de fichiers`);
    const missing = list.find((f) => !inside.some((i) => i.name === f));
    if (missing) throw new Error(`fichier manquant dans le mod : ${missing}`);
  }

  const target = path.join(resourcesDir, name);
  if (fs.existsSync(target)) throw new Error(`le mod "${name}" est déjà installé`);
  // Extraction à côté puis renommage : jamais de mod à moitié copié dans `resources`.
  fs.mkdirSync(resourcesDir, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(path.dirname(resourcesDir), '.import-'));
  try {
    for (const f of inside) {
      const file = path.join(tmp, f.name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, f.data);
    }
    fs.renameSync(tmp, target);
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  return { name };
}
