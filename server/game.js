/**
 * Actions sur le jeu de chaque joueur, par le module SixM dans VIctory (integrations/victory/sixm-bridge).
 * Le profil local du joueur dit ce qui est permis : téléportation, et des valeurs nommées (noclip…). Le
 * serveur ne voit que ces noms ; le module refuse tout ce que le profil ne prévoit pas.
 */
export const VALUE_TYPES = ['u8', 'i32', 'f32'];
const NAME_RE = /^[a-z0-9_]{1,24}$/;
// Un vrai texte : RegExp.test(undefined) teste « undefined ».
const NAME = { test: (n) => typeof n === 'string' && NAME_RE.test(n) };
const MAX_VALUES = 32;
const coord = (v) => Number.isFinite(v) && Math.abs(v) < 1e6;

/** Ce que le jeu d'un joueur sait faire : { teleport, values: [{ name, type }] }. */
export function cleanAbilities(a) {
  const values = [];
  for (const v of Array.isArray(a?.values) ? a.values.slice(0, MAX_VALUES) : []) {
    if (NAME.test(v?.name) && VALUE_TYPES.includes(v.type) && !values.some((x) => x.name === v.name)) values.push({ name: v.name, type: v.type });
  }
  return { teleport: a?.teleport === true, values, scanner: a?.scanner === true };
}

export const NO_ABILITIES = Object.freeze({ teleport: false, values: Object.freeze([]), scanner: false });

const TESTS = ['exact', 'between', 'changed', 'unchanged', 'increased', 'decreased'];
// Adresse de l'espace utilisateur de Windows : un entier exact en JavaScript.
const isAddress = (a) => Number.isSafeInteger(a) && a >= 0x10000 && a < 2 ** 47;
const isChain = (c) => Array.isArray(c) && c.length >= 1 && c.length <= 16 && c.every((o) => Number.isSafeInteger(o) && o >= 0 && o < 2 ** 40);

/** Les actions de la recherche mémoire (pour `game.scanner`). */
export const SCANNER_ACTIONS = ['scan', 'poke', 'unpoke', 'pointers', 'saveProfile'];

/** Une action demandée au jeu ; lève si elle est mal formée. */
export function cleanAction(a) {
  if (a?.action === 'teleport') {
    if (![a.x, a.y, a.z].every(coord)) throw new Error('position invalide');
    return { action: 'teleport', x: a.x, y: a.y, z: a.z, ...(coord(a.h) && { h: a.h }) };
  }
  if (a?.action === 'set') {
    if (!NAME.test(a.name)) throw new Error('nom de valeur invalide');
    const value = typeof a.value === 'boolean' ? Number(a.value) : a.value;
    if (!Number.isFinite(value)) throw new Error('valeur invalide');
    return { action: 'set', name: a.name, value, hold: a.hold === true };
  }
  if (a?.action === 'release') {
    if (!NAME.test(a.name)) throw new Error('nom de valeur invalide');
    return { action: 'release', name: a.name };
  }
  if (a?.action === 'scan') {
    if (!VALUE_TYPES.includes(a.type) || !TESTS.includes(a.test)) throw new Error('recherche invalide');
    const first = a.first === true;
    if (first && !['exact', 'between'].includes(a.test)) throw new Error('une première recherche cherche une valeur ou une fourchette');
    const need = a.test === 'exact' ? ['a'] : a.test === 'between' ? ['a', 'b'] : [];
    if (!need.every((k) => Number.isFinite(a[k]))) throw new Error('valeur de recherche invalide');
    return { action: 'scan', first, type: a.type, test: a.test, ...Object.fromEntries(need.map((k) => [k, a[k]])) };
  }
  if (a?.action === 'poke') {
    if (!isAddress(a.address) || !VALUE_TYPES.includes(a.type) || !Number.isFinite(a.value)) throw new Error('écriture invalide');
    return { action: 'poke', address: a.address, type: a.type, value: a.value, hold: a.hold === true };
  }
  if (a?.action === 'unpoke' || a?.action === 'pointers') {
    if (!isAddress(a.address)) throw new Error('adresse invalide');
    return { action: a.action, address: a.address };
  }
  if (a?.action === 'saveProfile') {
    // Une ligne du profil local du joueur : sa position, ou une valeur nommée.
    if (!isChain(a.chain)) throw new Error('chemin invalide');
    if (a.key === 'position') return { action: 'saveProfile', key: 'position', chain: a.chain, teleport: a.teleport === true };
    if (a.key === 'value' && NAME.test(a.name) && VALUE_TYPES.includes(a.type)) return { action: 'saveProfile', key: 'value', name: a.name, type: a.type, chain: a.chain };
    throw new Error('ligne de profil invalide');
  }
  throw new Error('action inconnue');
}

/** L'état d'une recherche mémoire, renvoyé par le jeu. */
export function cleanScan(s) {
  const results = (Array.isArray(s?.results) ? s.results : []).slice(0, 30)
    .filter((r) => isAddress(r?.a)).map((r) => ({ a: r.a, v: Number.isFinite(r.v) ? r.v : null }));
  return {
    busy: s?.busy === true,
    progress: Number.isFinite(s?.progress) ? Math.min(1, Math.max(0, s.progress)) : 0,
    type: VALUE_TYPES.includes(s?.type) ? s.type : null,
    count: Number.isSafeInteger(s?.count) && s.count >= 0 ? s.count : 0,
    results,
    error: typeof s?.error === 'string' ? s.error.replace(/[\u0000-\u001f]/g, ' ').slice(0, 160) : null,
  };
}

/** Chemins de pointeurs vers une adresse, renvoyés par le jeu. */
export function cleanPointers(p) {
  return { address: isAddress(p?.address) ? p.address : 0, chains: (Array.isArray(p?.chains) ? p.chains : []).filter(isChain).slice(0, 12) };
}

/** Le résultat d'une action, renvoyé par le jeu. */
export function cleanResult(r) {
  return {
    what: String(r?.what ?? '').replace(/[^\w]/g, '').slice(0, 24),
    ok: r?.ok === true,
    error: typeof r?.error === 'string' ? r.error.replace(/[\u0000-\u001f]/g, ' ').slice(0, 120) : null,
  };
}
