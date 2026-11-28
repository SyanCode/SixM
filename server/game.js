/**
 * Actions sur le jeu de chaque joueur, par le module SixM dans VIctory (integrations/victory/sixm-bridge).
 * Le profil local du joueur dit ce qui est permis : téléportation, et des valeurs nommées (noclip…). Le
 * serveur ne voit que ces noms ; le module refuse tout ce que le profil ne prévoit pas.
 */
export const VALUE_TYPES = ['u8', 'i32', 'f32'];
const NAME = /^[a-z0-9_]{1,24}$/;
const MAX_VALUES = 32;
const coord = (v) => Number.isFinite(v) && Math.abs(v) < 1e6;

/** Ce que le jeu d'un joueur sait faire : { teleport, values: [{ name, type }] }. */
export function cleanAbilities(a) {
  const values = [];
  for (const v of Array.isArray(a?.values) ? a.values.slice(0, MAX_VALUES) : []) {
    if (NAME.test(v?.name) && VALUE_TYPES.includes(v.type) && !values.some((x) => x.name === v.name)) values.push({ name: v.name, type: v.type });
  }
  return { teleport: a?.teleport === true, values };
}

export const NO_ABILITIES = Object.freeze({ teleport: false, values: Object.freeze([]) });

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
  throw new Error('action inconnue');
}

/** Le résultat d'une action, renvoyé par le jeu. */
export function cleanResult(r) {
  return {
    what: String(r?.what ?? '').replace(/[^\w]/g, '').slice(0, 24),
    ok: r?.ok === true,
    error: typeof r?.error === 'string' ? r.error.replace(/[\u0000-\u001f]/g, ' ').slice(0, 120) : null,
  };
}
