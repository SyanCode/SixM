/**
 * Avatars 3D des joueurs : modèles Wavefront OBJ fournis par les mods (`"models"` dans resource.json), dessinés par la
 * surcouche à la place de chaque joueur, avec la caméra du jeu. Ce ne sont pas des personnages du jeu : ni collision,
 * ni masqués par les murs.
 *
 * Un modèle : { v: [x, y, z, …] en mètres (z vers le haut, l'origine au centre du joueur, l'avant vers +y),
 *               f: [a, b, c, …] triangles (indices de sommets), c: [couleur 0xrrggbb ou -1, …] une par triangle }.
 */
export const MAX_VERTICES = 4000;
export const MAX_FACES = 6000;
export const MAX_MODELS = 32;
export const DEFAULT_MODEL = 'sixm:humain';
const NAME = /^[\w:.-]{1,32}$/;
const COLOR = /^#[0-9a-f]{6}$/i;

/** Lit un fichier OBJ : sommets, faces (découpées en triangles), couleurs par `usemtl #rrggbb`. */
export function parseObj(text) {
  const v = [], f = [], c = [];
  let color = -1;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.split('#')[0].trim();
    const mtl = /^usemtl\s+(#[0-9a-f]{6})\b/i.exec(raw.trim());
    if (mtl) { color = parseInt(mtl[1].slice(1), 16); continue; }
    if (/^usemtl\b/.test(line)) { color = -1; continue; }
    const [kind, ...parts] = line.split(/\s+/);
    if (kind === 'v') {
      const p = parts.slice(0, 3).map(Number);
      if (p.length !== 3 || !p.every((x) => Number.isFinite(x) && Math.abs(x) < 1000)) throw new Error('sommet invalide');
      if (v.length / 3 >= MAX_VERTICES) throw new Error(`plus de ${MAX_VERTICES} sommets`);
      v.push(...p);
    } else if (kind === 'f') {
      const n = v.length / 3;
      const idx = parts.map((p) => {
        const i = parseInt(p.split('/')[0], 10);
        const at = i < 0 ? n + i : i - 1;
        if (!Number.isInteger(at) || at < 0 || at >= n) throw new Error('face invalide');
        return at;
      });
      for (let k = 1; k + 1 < idx.length; k++) {
        if (f.length / 3 >= MAX_FACES) throw new Error(`plus de ${MAX_FACES} triangles`);
        f.push(idx[0], idx[k], idx[k + 1]);
        c.push(color);
      }
    }
  }
  if (!f.length) throw new Error('aucune face');
  return { v, f, c };
}

/** Un modèle reçu : mêmes bornes, sinon une erreur. */
export function cleanModel(m) {
  const { v, f, c } = m ?? {};
  if (!Array.isArray(v) || !Array.isArray(f) || !Array.isArray(c)) throw new Error('modèle invalide');
  if (v.length % 3 || v.length / 3 > MAX_VERTICES || !v.every((x) => Number.isFinite(x) && Math.abs(x) < 1000)) throw new Error('sommets invalides');
  const n = v.length / 3;
  if (f.length % 3 || !f.length || f.length / 3 > MAX_FACES || !f.every((i) => Number.isInteger(i) && i >= 0 && i < n)) throw new Error('faces invalides');
  if (c.length !== f.length / 3 || !c.every((x) => Number.isInteger(x) && x >= -1 && x <= 0xffffff)) throw new Error('couleurs invalides');
  return { v: [...v], f: [...f], c: [...c] };
}

/** Modèles reçus, ceux qui sont valides. */
export function cleanModels(list) {
  const out = {};
  for (const [name, m] of Object.entries(list && typeof list === 'object' ? list : {}).slice(0, MAX_MODELS + 1)) {
    if (!NAME.test(name)) continue;
    try { out[name] = cleanModel(m); } catch { /* ignoré */ }
  }
  return out;
}

/** L'avatar d'un joueur : un modèle connu, une échelle (0,1 à 10), une couleur facultative. */
export function cleanAvatar(a) {
  const scale = Number(a?.scale);
  return {
    model: typeof a?.model === 'string' && NAME.test(a.model) ? a.model : DEFAULT_MODEL,
    scale: Number.isFinite(scale) ? Math.min(10, Math.max(0.1, Math.round(scale * 100) / 100)) : 1,
    color: COLOR.test(a?.color) ? a.color.toLowerCase() : null,
  };
}

export const DEFAULT_AVATAR = Object.freeze(cleanAvatar({}));

/** Un humanoïde de blocs, 1,8 m, centré sur le joueur : le modèle par défaut. */
export function defaultModel() {
  const v = [], f = [], c = [];
  const box = ([x0, y0, z0], [x1, y1, z1], color) => {
    const b = v.length / 3;
    for (const z of [z0, z1]) for (const y of [y0, y1]) for (const x of [x0, x1]) v.push(x, y, z);
    // Sommets : 0..3 en bas, 4..7 en haut ; x varie le plus vite, puis y.
    const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
    for (const [a, b2, c2, d] of quads) {
      f.push(b + a, b + b2, b + c2, b + a, b + c2, b + d);
      c.push(color, color);
    }
  };
  const skin = 0xe0b48c, shirt = -1, pants = 0x2b3445, shoes = 0x1a1a1a;
  box([-0.12, -0.08, -0.95], [-0.02, 0.12, -0.85], shoes); box([0.02, -0.08, -0.95], [0.12, 0.12, -0.85], shoes);
  box([-0.12, -0.06, -0.85], [-0.02, 0.06, -0.05], pants); box([0.02, -0.06, -0.85], [0.12, 0.06, -0.05], pants);
  box([-0.2, -0.1, -0.05], [0.2, 0.1, 0.55], shirt);
  box([-0.3, -0.06, -0.05], [-0.2, 0.06, 0.5], shirt); box([0.2, -0.06, -0.05], [0.3, 0.06, 0.5], shirt);
  box([-0.09, -0.09, 0.58], [0.09, 0.11, 0.85], skin);
  return { v, f, c };
}
