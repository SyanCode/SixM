/**
 * Interface GameAdapter : seule couche dépendante du jeu.
 *
 * SixM est volontairement agnostique : le serveur, le protocole et les ressources
 * ne connaissent rien de GTA VI. Pour brancher un vrai jeu / portage PC, on
 * implémente cette interface (ex. via un plugin natif, un script-hook officiel,
 * ou l'API d'un projet de portage qui l'autorise).
 */
export class GameAdapter {
  /** Appelé au démarrage ; `onReady` quand le jeu est prêt. */
  async init() { throw new Error('non implémenté'); }
  /** Position du joueur local: { x, y, z, h } (h en radians), ou null si inconnue. */
  getLocalPlayerPosition() { throw new Error('non implémenté'); }
  /** Applique la position d'un joueur distant (ped/avatar). */
  setRemotePlayer(id, name, pos, avatar) { throw new Error('non implémenté'); }
  /** Modèles 3D des avatars (server/avatars.js), pour un jeu ou une surcouche qui sait les dessiner (facultatif). */
  setModels(models) {}
  removeRemotePlayer(id) { throw new Error('non implémenté'); }
  /** Affichage de texte (chat, notifications). */
  log(text) { throw new Error('non implémenté'); }
  /** Nom du serveur et de tous les joueurs (facultatif). */
  setRoster(server, names) {}
  /** Ce que le jeu permet au serveur : { teleport, values: [{ name, type }] } (server/game.js). */
  getAbilities() { return { teleport: false, values: [] }; }
  /** Action demandée par le serveur (déjà validée) ; renvoie faux si le jeu ne peut pas la recevoir. */
  act(action) { return false; }
  /** Appelé par l'adaptateur quand le joueur écrit depuis le jeu ; défini par le client. */
  onChat = null;
  /** Appelé avec le résultat d'une action : { what, ok, error } ; défini par le client. */
  onResult = null;
  /** Recherche mémoire : état d'une recherche, chemins de pointeurs (server/game.js) ; définis par le client. */
  onScan = null;
  onPointers = null;
  async shutdown() {}
}
