const TAU = Math.PI * 2;

/** Interpole un angle en radians par le plus court chemin. */
export function lerpAngle(a, b, t) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return a + d * t;
}

/**
 * Tampon de positions d'un joueur distant. Les snapshots arrivent à `tickRate` avec de la gigue ;
 * on affiche avec un léger retard pour toujours avoir deux échantillons à interpoler.
 */
export class PositionBuffer {
  constructor({ teleportDistance = 50, maxSamples = 32 } = {}) {
    Object.assign(this, { teleportDistance, maxSamples });
    this.samples = [];
  }

  push(time, pos) {
    this.samples.push({ time, pos });
    if (this.samples.length > this.maxSamples) this.samples.shift();
  }

  sample(time) {
    const s = this.samples;
    if (!s.length) return null;
    // Au-delà du dernier échantillon : on fige, pas d'extrapolation.
    if (time >= s.at(-1).time) return s.at(-1).pos;
    if (time <= s[0].time) return s[0].pos;
    let i = s.length - 2;
    while (s[i].time > time) i--;
    const { time: t0, pos: a } = s[i];
    const { time: t1, pos: b } = s[i + 1];
    // Téléportation : pas de glissade à travers la carte.
    if (Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) > this.teleportDistance) return a;
    const t = (time - t0) / (t1 - t0);
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
      h: lerpAngle(a.h, b.h, t),
    };
  }
}
