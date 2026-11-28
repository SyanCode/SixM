import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createIdentity, isIdentity, playerUid } from '../server/identity.js';
import { isRepo, PORTS } from './ports.js';

const DEFAULTS = {
  name: 'Joueur', autoUpdate: true, scanner: false, target: 'demo', victory: '', games: [], favorites: [], recents: [], directories: [],
  port: 'victory', portOptions: {}, customPort: { repo: '', commit: '' },
};
const PORT_IDS = [...PORTS.map((p) => p.id), 'custom'];
const clean = (v, max) => String(v).replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, max);

function normalize(raw) {
  const s = { ...DEFAULTS, ...raw };
  const address = (v) => (typeof v === 'string' ? clean(v, 255) : '');
  const games = (Array.isArray(s.games) ? s.games : []).slice(0, 20).map((g) => ({
    id: /^[a-f0-9]{8}$/.test(g?.id) ? g.id : crypto.randomBytes(4).toString('hex'),
    name: clean(g?.name ?? '', 40) || 'Mon jeu',
    path: clean(g?.path ?? '', 1024), // dossier extrait, ou .exe
    console: g?.console === 'series-s' ? 'series-s' : 'series-x',
  }));
  return {
    name: clean(s.name ?? '', 24) || DEFAULTS.name,
    autoUpdate: s.autoUpdate !== false,
    // Recherche mémoire dans le jeu, pour les admins (scanner du module SixM) : désactivée tant que le joueur ne
    // l'allume pas lui-même ; aucun serveur ne peut l'allumer à sa place.
    scanner: s.scanner === true,
    // 'demo' : sans jeu ; 'attach' : VIctory déjà ouvert ; sinon l'installation à lancer.
    target: ['demo', 'attach', ...games.map((g) => g.id)].includes(s.target) ? s.target : DEFAULTS.target,
    victory: clean(s.victory ?? '', 1024),
    games,
    favorites: (Array.isArray(s.favorites) ? s.favorites : []).slice(0, 50)
      .map((f) => ({ address: address(f?.address), label: clean(f?.label ?? '', 64) })).filter((f) => f.address),
    recents: (Array.isArray(s.recents) ? s.recents : []).map(address).filter(Boolean).slice(0, 8),
    // Annuaires de serveurs publics consultés par l'onglet « Publics ».
    directories: (Array.isArray(s.directories) ? s.directories : []).map((u) => clean(u ?? '', 255))
      .filter((u) => /^https?:\/\/[^\s/]+\/?$/.test(u)).slice(0, 4),
    // Portage choisi, ses options de lancement (relues par app/ports.js), et le dépôt « au choix ».
    port: PORT_IDS.includes(s.port) ? s.port : DEFAULTS.port,
    portOptions: Object.fromEntries(PORT_IDS.filter((id) => s.portOptions?.[id] && typeof s.portOptions[id] === 'object').map((id) => [id,
      Object.fromEntries(Object.entries(s.portOptions[id]).slice(0, 32)
        .filter(([k, v]) => /^\w{1,32}$/.test(k) && (typeof v === 'boolean' || typeof v === 'string'))
        .map(([k, v]) => [k, typeof v === 'string' ? clean(v, 1024) : v]))])),
    customPort: {
      repo: isRepo(s.customPort?.repo) ? s.customPort.repo : '',
      commit: /^[0-9a-f]{40}$/.test(s.customPort?.commit) ? s.customPort.commit : '',
    },
    // Clé du joueur : créée une fois, jamais envoyée à l'interface ni aux serveurs.
    identity: isIdentity(s.identity) ? { publicKey: s.identity.publicKey, privateKey: s.identity.privateKey } : createIdentity(),
  };
}

/**
 * Réglages du joueur dans `settings.json`. Aucun mot de passe de serveur n'y est gardé ; il contient la clé
 * privée du joueur, d'où un fichier lisible par lui seul.
 */
export class Settings {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    let raw = {};
    // Réglages illisibles : on repart des valeurs par défaut plutôt que de bloquer l'application.
    try { raw = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* premier lancement */ }
    this.value = normalize(raw && typeof raw === 'object' ? raw : {});
    // Nouvelle identité : enregistrée tout de suite pour rester la même au prochain lancement.
    if (!isIdentity(raw?.identity)) {
      try { this.update({}); } catch (e) { console.error('[réglages]', e.message); }
    }
  }

  update(patch) {
    this.value = normalize({ ...this.value, ...patch });
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.value, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    return this.value;
  }

  /** Réglages montrés à l'interface : l'identité réduite à son identifiant public. */
  public() {
    const { identity, ...rest } = this.value;
    return { ...rest, uid: playerUid(identity.publicKey) };
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
