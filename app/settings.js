import fs from 'node:fs';
import path from 'node:path';

const DEFAULTS = { name: 'Joueur', adapter: 'mock', favorites: [], recents: [] };
const clean = (v, max) => String(v).replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, max);

function normalize(raw) {
  const s = { ...DEFAULTS, ...raw };
  const address = (v) => (typeof v === 'string' ? clean(v, 255) : '');
  return {
    name: clean(s.name ?? '', 24) || DEFAULTS.name,
    adapter: ['mock', 'victory'].includes(s.adapter) ? s.adapter : DEFAULTS.adapter,
    favorites: (Array.isArray(s.favorites) ? s.favorites : []).slice(0, 50)
      .map((f) => ({ address: address(f?.address), label: clean(f?.label ?? '', 64) })).filter((f) => f.address),
    recents: (Array.isArray(s.recents) ? s.recents : []).map(address).filter(Boolean).slice(0, 8),
  };
}

/** Réglages du joueur dans `settings.json`. Aucun mot de passe n'y est gardé. */
export class Settings {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    let raw = {};
    // Réglages illisibles : on repart des valeurs par défaut plutôt que de bloquer l'application.
    try { raw = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* premier lancement */ }
    this.value = normalize(raw && typeof raw === 'object' ? raw : {});
  }

  update(patch) {
    this.value = normalize({ ...this.value, ...patch });
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.value, null, 2) + '\n');
    fs.renameSync(tmp, this.file);
    return this.value;
  }

  remember(address) {
    this.update({ recents: [address, ...this.value.recents.filter((a) => a !== address)] });
  }

  toggleFavorite(address, label = '') {
    const { favorites } = this.value;
    const without = favorites.filter((f) => f.address !== address);
    return this.update({ favorites: without.length < favorites.length ? without : [...favorites, { address, label }] });
  }
}
