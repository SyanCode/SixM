/**
 * Pages HTTP du serveur : accueil, politique de confidentialité et mentions légales.
 * Les champs `[À COMPLÉTER : …]` sont des informations que seul l'éditeur du site connaît :
 * à remplacer ici avant de considérer les pages comme définitives.
 */

export const LEGAL = {
  publisher: '[À COMPLÉTER : nom et prénom, ou raison sociale et forme juridique de l’éditeur]',
  address: '[À COMPLÉTER : adresse postale de l’éditeur]',
  email: '[À COMPLÉTER : adresse e-mail de contact]',
  phone: '[À COMPLÉTER : téléphone, si l’éditeur est une société]',
  registration: '[À COMPLÉTER : numéro SIREN/SIRET et RCS, si l’éditeur est une société]',
  director: '[À COMPLÉTER : directeur ou directrice de la publication]',
  host: '[À COMPLÉTER : nom de l’hébergeur]',
  hostAddress: '[À COMPLÉTER : adresse postale et téléphone de l’hébergeur]',
  webLogs: '[À COMPLÉTER : durée de conservation des journaux du serveur web]',
  updated: '[À COMPLÉTER : date de dernière mise à jour]',
};

export const PAGES = {
  '/': 'home',
  '/confidentialite': 'privacy',
  '/mentions-legales': 'legal',
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const STYLE = `
  :root { color-scheme: light dark; --fg: #1d2127; --bg: #fafaf8; --muted: #5b636d; --line: #d9dbd6; --link: #0b5cad; }
  @media (prefers-color-scheme: dark) { :root { --fg: #e8eaed; --bg: #14171a; --muted: #a0a7b0; --line: #2d3238; --link: #7db7f2; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; flex-direction: column; font: 1rem/1.6 system-ui, sans-serif; color: var(--fg); background: var(--bg); }
  main, footer > div { width: min(42rem, 100% - 2rem); margin-inline: auto; }
  main { flex: 1; padding-block: 3rem 2rem; }
  h1 { font-size: 1.9rem; line-height: 1.2; margin: 0 0 1rem; }
  h2 { font-size: 1.2rem; margin: 2rem 0 .5rem; }
  p, ul { margin: 0 0 1rem; }
  a { color: var(--link); }
  a:focus-visible { outline: 3px solid var(--link); outline-offset: 2px; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: .4rem 1.5rem; margin: 0 0 1rem; }
  dt { color: var(--muted); }
  dd { margin: 0; }
  footer { border-top: 1px solid var(--line); padding-block: 1.25rem; color: var(--muted); font-size: .9rem; }
  footer ul { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: .25rem 1.5rem; margin: 0; }
  @media (max-width: 30rem) { dl { grid-template-columns: 1fr; gap: 0; } dd { margin-bottom: .6rem; } }
`;

function layout({ title, description, path, body, name }) {
  const link = (href, label) => `<li><a href="${href}"${href === path ? ' aria-current="page"' : ''}>${label}</a></li>`;
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="icon" href="data:,">
<style>${STYLE}</style>
</head>
<body>
<main>
${body}
</main>
<footer>
<div>
<nav aria-label="Informations légales">
<ul>
${link('/', esc(name))}
${link('/confidentialite', 'Politique de confidentialité')}
${link('/mentions-legales', 'Mentions légales')}
</ul>
</nav>
</div>
</footer>
</body>
</html>
`;
}

const home = (name, description) => `<h1>${esc(name)}</h1>
<p>${description ? esc(description) : 'Ce domaine héberge un serveur de jeu SixM.'}</p>
<p>On s’y connecte depuis l’application SixM, pas depuis un navigateur. La fiche publique du serveur (nom, nombre de joueurs, ressources actives) est lisible en <a href="/info.json">JSON</a>.</p>
<p>Les informations sur les données des joueurs sont dans la <a href="/confidentialite">politique de confidentialité</a>.</p>`;

const privacy = (name) => `<h1>Politique de confidentialité</h1>
<p>Dernière mise à jour : ${esc(LEGAL.updated)}</p>

<h2>Qui est responsable de vos données</h2>
<p>${esc(LEGAL.publisher)} édite le serveur de jeu « ${esc(name)} » et décide des données qu’il traite. Contact : ${esc(LEGAL.email)}.</p>

<h2>Données traitées quand vous jouez</h2>
<ul>
<li><strong>Votre pseudo</strong>, limité à 24 caractères, pour vous afficher aux autres joueurs.</li>
<li><strong>Votre identifiant de joueur</strong> (de la forme <code>sixm:…</code>), calculé à partir de la clé publique de votre application SixM. Il sert à vous reconnaître, à tenir la liste blanche et les droits d’administrateur, et à empêcher deux connexions avec la même identité.</li>
<li><strong>Votre adresse IP</strong>, pour limiter le nombre de connexions par adresse, bloquer les essais répétés de mot de passe et appliquer les bannissements.</li>
<li><strong>Votre position et les actions de votre jeu</strong>, transmises aux autres joueurs pendant la partie. Elles restent en mémoire du serveur et ne sont pas enregistrées par lui. Les ressources (mods) installées sur ce serveur peuvent traiter d’autres données : leur hôte doit les indiquer ici.</li>
</ul>

<h2>Ce qui est conservé</h2>
<ul>
<li><strong>Liste des bannissements</strong> : adresse IP, identifiant de joueur, pseudo, motif et date. Conservée jusqu’à ce qu’un administrateur lève le bannissement.</li>
<li><strong>Liste d’accès</strong> (si la liste blanche est activée) : identifiant, pseudo et date des joueurs acceptés, des administrateurs et des demandes en attente. Les 50 demandes les plus récentes sont gardées. Une entrée reste jusqu’à ce qu’un administrateur la retire.</li>
<li><strong>Journaux du serveur web</strong> qui reçoit les visites de ce site : ils peuvent contenir votre adresse IP. Durée de conservation : ${esc(LEGAL.webLogs)}.</li>
</ul>

<h2>Pourquoi, et sur quel fondement</h2>
<p>Le pseudo, l’identifiant et la position servent à faire fonctionner le jeu que vous demandez à rejoindre. L’adresse IP et les bannissements relèvent de l’intérêt légitime de l’éditeur à protéger le serveur et ses joueurs contre les abus.</p>

<h2>Annuaires et réseau local</h2>
<p>Un serveur public se signale sur le réseau local et s’inscrit auprès des annuaires que son hôte a choisis. Ils reçoivent la fiche publique du serveur (nom, description, nombre de joueurs) et l’adresse du serveur, pas les données des joueurs.</p>

<h2>Cookies et traceurs</h2>
<p>Ces pages ne déposent aucun cookie et n’utilisent aucun outil de mesure d’audience.</p>

<h2>Vos droits</h2>
<p>Vous pouvez demander l’accès à vos données, leur rectification, leur effacement, la limitation du traitement ou vous y opposer, en écrivant à ${esc(LEGAL.email)}. Pour retrouver vos données, indiquez votre identifiant de joueur ou votre pseudo.</p>
<p>Si la réponse ne vous satisfait pas, vous pouvez saisir la CNIL (<a href="https://www.cnil.fr/fr/plaintes" rel="noopener">cnil.fr/fr/plaintes</a>).</p>`;

const legal = (name) => `<h1>Mentions légales</h1>
<p>Dernière mise à jour : ${esc(LEGAL.updated)}</p>

<h2>Éditeur du site</h2>
<dl>
<dt>Site</dt><dd>${esc(name)}</dd>
<dt>Éditeur</dt><dd>${esc(LEGAL.publisher)}</dd>
<dt>Adresse</dt><dd>${esc(LEGAL.address)}</dd>
<dt>E-mail</dt><dd>${esc(LEGAL.email)}</dd>
<dt>Téléphone</dt><dd>${esc(LEGAL.phone)}</dd>
<dt>Immatriculation</dt><dd>${esc(LEGAL.registration)}</dd>
<dt>Directeur de la publication</dt><dd>${esc(LEGAL.director)}</dd>
</dl>

<h2>Hébergeur</h2>
<dl>
<dt>Nom</dt><dd>${esc(LEGAL.host)}</dd>
<dt>Coordonnées</dt><dd>${esc(LEGAL.hostAddress)}</dd>
</dl>

<h2>Logiciel</h2>
<p>Ce serveur fait tourner SixM, un logiciel distribué sous licence MIT. Les jeux et marques cités appartiennent à leurs propriétaires.</p>

<h2>Données personnelles</h2>
<p>Le détail des données traitées et vos droits sont dans la <a href="/confidentialite">politique de confidentialité</a>.</p>`;

/** HTML de la page demandée, ou null si ce chemin n'est pas une page. */
export function renderPage(path, config) {
  const kind = Object.hasOwn(PAGES, path) ? PAGES[path] : null;
  if (!kind) return null;
  const name = config.name;
  if (kind === 'privacy') {
    return layout({ title: `Politique de confidentialité · ${name}`, description: `Données personnelles traitées par le serveur ${name} et vos droits.`, path, body: privacy(name), name });
  }
  if (kind === 'legal') {
    return layout({ title: `Mentions légales · ${name}`, description: `Éditeur et hébergeur du serveur ${name}.`, path, body: legal(name), name });
  }
  return layout({ title: name, description: config.description || `Serveur de jeu SixM ${name}.`, path, body: home(name, config.description), name });
}
