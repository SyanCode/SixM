import { PINNED, REPO } from './builder.js';

/**
 * Projets de portage que SixM sait installer : même structure que VIctory (apps/victory, GPL-3),
 * compilés sur le PC du joueur à un commit vérifié. SixM n'en contient aucun code.
 *
 * Chaque option de lancement devient des variables d'environnement pour le programme du portage.
 *   bool   : `on` quand activée, `off` sinon
 *   choice : la valeur choisie dans `env` (rien si vide)
 *   path   : le chemin dans `env` ; vide, celui que SixM a trouvé seul si l'option a `find`
 *            ({ kind, file } : voir sdks.js), sinon rien
 * fetch : bibliothèques que le portage sait télécharger lui-même (arguments de son victory.exe).
 * launch(valeurs, exe, console) : arguments de victory.exe quand le portage a son propre lanceur (sinon
 *   `run <exe> --execute --console <console>`).
 */
export const PORTS = [
  {
    id: 'victory', name: 'VIctory', author: 'Marvisak', repo: REPO, pinned: PINNED, url: 'https://github.com/Marvisak/VIctory',
    description: 'Le projet d\'origine : couche de compatibilité qui fait tourner la version Xbox Series du jeu sous Windows.',
    tags: ['Officiel'], env: {}, options: [],
  },
  {
    id: 'belobug-amd', name: 'VIctory Belobug AMD', author: 'Belobug',
    repo: 'https://github.com/Belobug/VIctory-Belobug-AMD.git', pinned: 'cd8dfc06ace7ccb91a19431e74bc2d0de2a10145',
    url: 'https://github.com/Belobug/VIctory-Belobug-AMD',
    description: 'Fork de VIctory optimisé pour les cartes AMD (testé sur RX 7900 XTX) : correctifs du moteur de rendu, FSR 4 jusqu\'en 4K. 64 Go de RAM conseillés.',
    tags: ['AMD', 'FSR 4'],
    // Réglages avec lesquels le fork est joué (scripts/play.ps1 du dépôt).
    env: {
      VICTORY_TEXTURE_NO_WAIT: '1', VICTORY_RELAY: '2', VICTORY_WIDE_BACK: '1', VICTORY_CARD_REHASH_RUNS: '1',
      VICTORY_JOIN_COPIES: '1', VICTORY_INDIRECT_WINDOW: '1', VICTORY_RELAY_COPY: '1', VICTORY_CARD_STEPS: '2',
      VICTORY_INDIRECT_BATCH: '2', VICTORY_MAP_THREADS: '1', VICTORY_TITLE_PRIORITIES: '0', VICTORY_CARD_AWAKE: '1',
      VICTORY_SHOW_AFTER: '1', VICTORY_AMBIENT: '0.8', VICTORY_D3D12_DRED: 'light',
    },
    options: [
      {
        id: 'safe', type: 'bool', label: 'Mode sûr', default: false,
        description: 'Sans les réglages les plus récents et les plus rapides. À essayer en premier si quelque chose ne va pas.',
        on: { VICTORY_UNDER_WIDE: '0', VICTORY_LAND_ECHO: '0' },
        off: { VICTORY_THIN: '1', VICTORY_JOIN_PARTS: '8', VICTORY_UPLOAD_AHEAD: '1' },
      },
      {
        id: 'rayTracing', type: 'bool', label: 'Ray tracing', default: false,
        description: 'L\'éclairage indirect du jeu : intérieurs mieux éclairés, environ un tiers plus lent.',
        on: { VICTORY_BVH_BUILDER: '1' },
      },
      {
        id: 'unlock', type: 'bool', label: 'Au-delà de 30 images/s', default: false,
        description: 'Menus et vidéos jusqu\'à 60 images/s ; l\'horloge du jeu reste juste.',
        on: { VICTORY_FRAME_INTERVAL_MS: '16.667' },
      },
      {
        id: 'fsr4k', type: 'choice', label: 'FSR 4 en 4K', env: 'VICTORY_FSR_4K', default: '',
        choices: [['', 'Désactivé'], ['quality', 'Qualité (1440p)'], ['balanced', 'Équilibré (1270p)'], ['performance', 'Performance (1080p)']],
        description: 'Sortie 3840×2160. Demande la DLL signée d\'AMD (dossier FidelityFX ci-dessous).',
      },
      {
        id: 'fidelityfx', type: 'path', label: 'Dossier FidelityFX', env: 'VICTORY_FIDELITYFX_DIR', default: '', folder: true,
        description: 'Le dossier qui contient amd_fidelityfx_upscaler_dx12.dll (AMD FSR SDK 2.4.0, Kits/FidelityFX/signedbin). Vide : SixM le cherche seul.',
        find: { kind: 'fidelityfx', file: 'amd_fidelityfx_upscaler_dx12.dll' },
      },
    ],
  },
  {
    id: 'tequesta', name: 'Tequesta', author: '0v3rr',
    repo: 'https://github.com/0v3rr/Tequesta.git', pinned: '5b04aa0341de9f922f4434d93b3d60747a749392',
    url: 'https://github.com/0v3rr/Tequesta',
    description: 'Couche de compatibilité dérivée de VIctory, optimisée pour les cartes NVIDIA RTX : clavier et souris natifs (AZERTY et QWERTY), menu de réglages F1 dans le jeu, cache des shaders. Jouable dans le prologue, quelques images par seconde pour l\'instant.',
    tags: ['NVIDIA RTX', 'Clavier et souris'],
    // Réglages recommandés pour les cartes NVIDIA RTX (README du dépôt).
    env: { VICTORY_THIN: '1', VICTORY_JOIN_PARTS: '8', VICTORY_CARD_REHASH_RUNS: '1' },
    options: [
      {
        id: 'kbm', type: 'bool', label: 'Clavier et souris natifs', default: true,
        description: 'Souris brute à 125 Hz et touches selon leur position (AZERTY comme QWERTY). F2 capture ou libère la souris.',
        on: { VICTORY_KBM_NATIVE: '1' }, off: { VICTORY_KBM_NATIVE: '0' },
      },
      {
        id: 'staticCache', type: 'bool', label: 'Cache des dessins statiques', default: true,
        description: 'Mémorise la géométrie qui ne bouge pas : environ 40 % d\'images en plus en intérieur.',
        on: { VICTORY_PORT_STATIC: '1' }, off: { VICTORY_PORT_STATIC: '0' },
      },
      {
        id: 'rawViews', type: 'bool', label: 'Vues GPU directes', default: false,
        description: 'À laisser désactivé sur les cartes NVIDIA : SixM garde alors la sous-allocation par blocs de 4 Mio.',
        on: { VICTORY_RAW_VIEWS: '1' }, off: { VICTORY_RAW_VIEWS: '0' },
      },
    ],
  },
  {
    id: 'victory-nvidia', name: 'VIctory-NVIDIA', author: 'trustno1-coder',
    repo: 'https://github.com/trustno1-coder/VIctory-NVIDIA.git', pinned: '64d4931b3dd90305134512b805fc98f04119fb6e',
    url: 'https://github.com/trustno1-coder/VIctory-NVIDIA',
    description: 'Fork de VIctory optimisé pour les cartes NVIDIA GeForce RTX : DLSS, génération d\'images DLSS (RTX 40 et 50) ou FSR 3, menu de réglages F1, statistiques F3. Les fichiers DLSS de NVIDIA ne sont pas fournis. 32 Go de RAM conseillés.',
    tags: ['NVIDIA RTX', 'DLSS'],
    // `victory get-dlss` : les fichiers de NVIDIA, depuis le GitHub de NVIDIA, dans %LOCALAPPDATA%\victory\nvidia-sdk.
    fetch: { streamline: ['get-dlss'] },
    // Lancé par sa propre commande `play`, comme sans SixM : ses réglages (priorités, textures, DLSS, menu F1)
    // sont ceux de sa version, sans copie à tenir à jour. Elle garde VICTORY_STREAMLINE_DIR et VICTORY_FIDELITYFX_DIR.
    env: {},
    launch: (v, exe, console) => [
      'play', exe, ...(console === 'series-s' ? ['--series-s'] : []), '--res', v.native1440p ? '1440' : '4k',
      '--dlss', v.dlss ? v.dlssMode : 'off', ...(v.frameGen ? [] : ['--no-framegen-ready']), '--fps', v.fps,
    ],
    options: [
      {
        id: 'native1440p', type: 'bool', label: 'Image en 2560×1440', default: true,
        description: 'Profil Series X : image et scène en 1440p. Désactivé, la sortie d\'origine en 3840×2160.',
      },
      {
        id: 'dlss', type: 'bool', label: 'DLSS', default: true,
        description: 'Remplace la mise à l\'échelle du jeu. Sans les fichiers de NVIDIA, le jeu tourne sans, et l\'indique au démarrage.',
      },
      {
        id: 'dlssMode', type: 'choice', label: 'Mode DLSS', default: 'quality',
        choices: [['dlaa', 'DLAA'], ['quality', 'Qualité'], ['balanced', 'Équilibré'], ['performance', 'Performance']],
        description: 'Utilisé seulement quand le DLSS est activé.',
      },
      {
        id: 'frameGen', type: 'bool', label: 'Génération d\'images', default: true,
        description: 'Prête mais éteinte au départ : le menu F1 l\'allume. DLSS sur RTX 40 et 50, sinon FSR 3 (2× au plus, DLL d\'AMD à fournir).',
      },
      {
        id: 'fps', type: 'choice', label: 'Limite d\'images/s', default: '1000',
        choices: [['1000', 'Aucune'], ['120', '120'], ['60', '60'], ['30', '30 (celle du jeu)']],
        description: 'Ce que le menu F1 du jeu a enregistré passe avant ces réglages.',
      },
      {
        id: 'streamline', type: 'path', label: 'Dossier DLSS de NVIDIA', env: 'VICTORY_STREAMLINE_DIR', default: '', folder: true,
        description: 'Le dossier qui contient sl.interposer.dll (NVIDIA Streamline). Vide : SixM le cherche seul.',
        find: { kind: 'streamline', file: 'sl.interposer.dll' },
      },
      {
        id: 'fidelityfx', type: 'path', label: 'Dossier FidelityFX', env: 'VICTORY_FIDELITYFX_DIR', default: '', folder: true,
        description: 'Pour FSR 3 : le dossier qui contient amd_fidelityfx_loader_dx12.dll et amd_fidelityfx_framegeneration_dx12.dll. Vide : SixM le cherche seul.',
        find: { kind: 'fidelityfx', file: 'amd_fidelityfx_framegeneration_dx12.dll' },
      },
    ],
  },
];

/** Dépôt GitHub public, adresse https. */
export const isRepo = (url) => typeof url === 'string' && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(\.git)?$/.test(url);

/** Portage « au choix » : un dépôt de la même famille que VIctory, au dernier commit ou à un commit donné. */
export function customPort({ repo = '', commit = '' } = {}) {
  return {
    id: 'custom', name: 'Autre portage', author: '', repo, pinned: /^[0-9a-f]{40}$/.test(commit) ? commit : null,
    url: repo.replace(/\.git$/, ''), custom: true, tags: ['Au choix'], env: {}, options: [],
    description: 'Un autre fork de VIctory, de la même structure (apps/victory). Son code est compilé sur ce PC : ne choisissez qu\'un dépôt de confiance.',
  };
}

/** Valeurs d'options gardées : seulement les options connues, du bon type. */
export function cleanOptions(port, values = {}) {
  const out = {};
  for (const o of port.options) {
    const v = values?.[o.id];
    if (o.type === 'bool') out[o.id] = typeof v === 'boolean' ? v : o.default;
    else if (o.type === 'choice') out[o.id] = o.choices.some(([c]) => c === v) ? v : o.default;
    else if (o.type === 'path') out[o.id] = typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 1024) : o.default;
  }
  return out;
}

/** Arguments de victory.exe pour lancer `exe` avec ce portage et ces options. */
export function portArgs(port, values, exe, console) {
  return port.launch ? port.launch(cleanOptions(port, values), exe, console) : ['run', exe, '--execute', '--console', console];
}

/**
 * Variables d'environnement du lancement : réglages du portage, puis options choisies.
 * found : dossiers trouvés par SixM, par option (`findOptions`), pour les chemins laissés vides.
 */
export function portEnv(port, values = {}, found = {}) {
  const v = cleanOptions(port, values);
  const env = { ...port.env };
  for (const o of port.options) {
    if (o.type === 'bool') Object.assign(env, v[o.id] ? o.on ?? {} : o.off ?? {});
    else if (!o.env) continue; // option lue par `launch`
    else if (v[o.id]) env[o.env] = v[o.id];
    else if (o.type === 'path' && found[o.id]) env[o.env] = found[o.id];
  }
  return env;
}

/** Dossiers trouvés pour les options `find` d'un portage : { id: chemin ou null }. */
export function findOptions(port, ctx, find) {
  return Object.fromEntries(port.options.filter((o) => o.find).map((o) => [o.id, find(o.find.kind, ctx, o.find.file)]));
}
