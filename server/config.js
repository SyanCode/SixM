import fs from 'node:fs';
import path from 'node:path';

export const DEFAULTS = {
  name: 'Serveur SixM',
  description: '',
  host: null, // null : toutes les interfaces
  port: 30120,
  maxPlayers: 32,
  password: '', // vide : serveur ouvert
  tickRate: 20,
  syncRadius: 0, // 0 : illimité
  maxConnectionsPerIp: 16,
  trustProxy: false, // true seulement derrière un reverse proxy (X-Forwarded-For)
  resourcesDir: 'resources',
  autostart: [],
  bansFile: null, // null : bannissements en mémoire
  accessFile: null, // liste blanche et admins ; null : en mémoire
  visibility: 'public', // public : annoncé sur le réseau local et aux annuaires ; private : seulement par adresse
  whitelist: false, // true : seuls les joueurs acceptés par l'hôte entrent
  tags: [],
  motd: '', // message d'accueil, affiché à l'arrivée
  directories: [], // annuaires publics où s'inscrire (http://hôte:port)
};

const int = (min, max) => (v) => Number.isInteger(v) && v >= min && v <= max;
const text = (max) => (v) => typeof v === 'string' && v.length <= max;
const nullable = (check) => (v) => v === null || check(v);
const RULES = {
  name: text(64),
  description: text(256),
  host: nullable(text(255)),
  port: int(0, 65535),
  maxPlayers: int(0, 1024),
  password: text(128),
  tickRate: int(1, 100),
  syncRadius: (v) => Number.isFinite(v) && v >= 0,
  maxConnectionsPerIp: int(1, 1024),
  trustProxy: (v) => typeof v === 'boolean',
  resourcesDir: text(1024),
  autostart: (v) => Array.isArray(v) && v.every(text(64)),
  bansFile: nullable(text(1024)),
  accessFile: nullable(text(1024)),
  visibility: (v) => v === 'public' || v === 'private',
  whitelist: (v) => typeof v === 'boolean',
  tags: (v) => Array.isArray(v) && v.length <= 8 && v.every((t) => text(24)(t) && t.trim() !== ''),
  motd: text(256),
  directories: (v) => Array.isArray(v) && v.length <= 4 && v.every((u) => text(255)(u) && /^https?:\/\/[^\s/]+\/?$/.test(u)),
};

export function normalizeConfig(raw) {
  const config = { ...DEFAULTS, ...raw };
  for (const [key, ok] of Object.entries(RULES))
    if (!ok(config[key])) throw new Error(`server.json : valeur invalide pour "${key}"`);
  return config;
}

/**
 * Variables d'environnement qui priment sur server.json, pour un serveur hébergé sans interface
 * (Docker, CI, plateforme comme Mas) :
 *   SIXM_PORT, SIXM_HOST ; à défaut PORT et HOST donnés par la plateforme
 *   SIXM_NAME, SIXM_DESCRIPTION, SIXM_MOTD, SIXM_PASSWORD, SIXM_MAX_PLAYERS
 *   SIXM_VISIBILITY (public | private), SIXM_WHITELIST (1 | 0)
 *   SIXM_TRUST_PROXY=1 : derrière un reverse proxy (nginx), l'adresse des joueurs vient de X-Forwarded-For
 *   SIXM_DATA_DIR : dossier gardé d'un déploiement à l'autre, pour bans.json et access.json
 *   SIXM_ADMINS : identifiants de joueurs (sixm:…) administrateurs, séparés par des virgules (voir hostDirectory)
 */
export function envOverrides(env = process.env) {
  const raw = {};
  const set = (name, key, conv = (v) => v) => { if (env[name] !== undefined && env[name] !== '') raw[key] = conv(env[name]); };
  const flag = (v) => ['1', 'true', 'yes', 'oui'].includes(v.trim().toLowerCase());
  if (env.SIXM_PORT === undefined && env.PORT) {
    raw.port = Number(env.PORT);
    if (env.HOST) raw.host = env.HOST;
  }
  set('SIXM_PORT', 'port', Number);
  set('SIXM_HOST', 'host');
  set('SIXM_NAME', 'name');
  set('SIXM_DESCRIPTION', 'description');
  set('SIXM_MOTD', 'motd');
  if (env.SIXM_PASSWORD !== undefined) raw.password = env.SIXM_PASSWORD;
  set('SIXM_MAX_PLAYERS', 'maxPlayers', Number);
  set('SIXM_VISIBILITY', 'visibility', (v) => v.trim());
  set('SIXM_WHITELIST', 'whitelist', flag);
  set('SIXM_TRUST_PROXY', 'trustProxy', flag);
  return raw;
}

/**
 * Charge `<dir>/server.json`. Les chemins sont relatifs à ce dossier ; les variables d'environnement
 * d'`envOverrides` priment sur le fichier.
 */
export function loadConfig(dir, env = process.env) {
  const file = path.join(dir, 'server.json');
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    throw new Error(`impossible de lire ${file} : ${e.message}`);
  }
  const config = normalizeConfig({ ...raw, ...envOverrides(env) });
  config.resourcesDir = path.resolve(dir, config.resourcesDir);
  if (env.SIXM_DATA_DIR) {
    // Le dossier du serveur est remplacé à chaque déploiement : bannissements et accès vont ailleurs.
    const data = path.resolve(env.SIXM_DATA_DIR);
    fs.mkdirSync(data, { recursive: true });
    config.bansFile = path.join(data, path.basename(config.bansFile ?? 'bans.json'));
    config.accessFile = path.join(data, path.basename(config.accessFile ?? 'access.json'));
  } else {
    config.bansFile = path.resolve(dir, config.bansFile ?? 'bans.json');
    config.accessFile = path.resolve(dir, config.accessFile ?? 'access.json');
  }
  return config;
}
