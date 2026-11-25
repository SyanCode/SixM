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
};

export function normalizeConfig(raw) {
  const config = { ...DEFAULTS, ...raw };
  for (const [key, ok] of Object.entries(RULES))
    if (!ok(config[key])) throw new Error(`server.json : valeur invalide pour "${key}"`);
  return config;
}

/**
 * Charge `<dir>/server.json`. Les chemins sont relatifs à ce dossier.
 * SIXM_PORT et SIXM_PASSWORD priment sur le fichier (Docker, CI).
 */
export function loadConfig(dir) {
  const file = path.join(dir, 'server.json');
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    throw new Error(`impossible de lire ${file} : ${e.message}`);
  }
  if (process.env.SIXM_PORT !== undefined) raw.port = Number(process.env.SIXM_PORT);
  if (process.env.SIXM_PASSWORD !== undefined) raw.password = process.env.SIXM_PASSWORD;
  const config = normalizeConfig(raw);
  config.resourcesDir = path.resolve(dir, config.resourcesDir);
  config.bansFile = path.resolve(dir, config.bansFile ?? 'bans.json');
  return config;
}
