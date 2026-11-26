import crypto from 'node:crypto';

/**
 * Identité d'un joueur : une paire de clés Ed25519 gardée par son SixM. Le serveur envoie un défi,
 * le client le signe ; l'identifiant (`sixm:` + empreinte de la clé publique) ne peut pas être usurpé
 * en changeant de pseudo. C'est lui que retiennent la liste blanche, les admins et les bannissements.
 */
export function createIdentity() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  };
}

export const isIdentity = (v) => typeof v?.publicKey === 'string' && typeof v.privateKey === 'string'
  && v.publicKey.length < 200 && v.privateKey.length < 200;

/** Identifiant public, stable, à donner à l'hôte d'un serveur. */
export function playerUid(publicKey) {
  return `sixm:${crypto.createHash('sha256').update(Buffer.from(String(publicKey), 'base64')).digest('hex').slice(0, 20)}`;
}

export const UID = /^sixm:[0-9a-f]{20}$/;

const message = (nonce) => Buffer.from(`sixm-hello:${nonce}`);

export function signChallenge(identity, nonce) {
  const key = crypto.createPrivateKey({ key: Buffer.from(identity.privateKey, 'base64'), format: 'der', type: 'pkcs8' });
  return crypto.sign(null, message(nonce), key).toString('base64');
}

/** true si `signature` est celle du défi par la clé `publicKey`. */
export function verifyChallenge(publicKey, nonce, signature) {
  try {
    if (typeof publicKey !== 'string' || typeof signature !== 'string' || publicKey.length > 200 || signature.length > 200) return false;
    const key = crypto.createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
    return key.asymmetricKeyType === 'ed25519' && crypto.verify(null, message(nonce), key, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}
