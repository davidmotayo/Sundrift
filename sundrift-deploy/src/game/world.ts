import { SPAWN, type Obstacle } from "./sim";

export type Rock = {
  x: number;
  z: number;
  xz: number;
  y: number;
  rot: number;
  color: number;
};

export type Cactus = {
  x: number;
  z: number;
  h: number;
  rot: number;
  /** 0, 1, or 2 arms */
  arms: number;
  /** which side the single arm uses */
  armSide: number;
};

export type Barrel = { x: number; z: number; s: number };

export type Mesa = { x: number; z: number; h: number; r: number; rot: number; color: number };

export type World = {
  obstacles: Obstacle[];
  rocks: Rock[];
  cacti: Cactus[];
  barrels: Barrel[];
  mesas: Mesa[];
};

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ROCK_COLORS = [0xc4a27a, 0xa68462, 0x8d6b4e, 0xd2b48c, 0x6f5340];
const MESA_COLORS = [0xc4926a, 0xb07d58, 0x9a6b48];

export function createWorld(seed = 20261015): World {
  const rand = mulberry32(seed);
  const obstacles: Obstacle[] = [];
  const rocks: Rock[] = [];
  const cacti: Cactus[] = [];
  const barrels: Barrel[] = [];
  const mesas: Mesa[] = [];

  const fits = (x: number, z: number, r: number, roadClear: number) => {
    if (Math.abs(x) > 340 || Math.abs(z) > 340) return false;
    if (Math.abs(x) < roadClear && Math.abs(z) < 330) return false;
    const dx = x - SPAWN.x;
    const dz = z - SPAWN.z;
    if (dx * dx + dz * dz < 28 * 28) return false;
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      const ox = x - o.x;
      const oz = z - o.z;
      const min = r + o.r + 1.2;
      if (ox * ox + oz * oz < min * min) return false;
    }
    return true;
  };

  const place = (r: number, roadClear: number) => {
    for (let n = 0; n < 24; n++) {
      const x = (rand() * 2 - 1) * 330;
      const z = (rand() * 2 - 1) * 330;
      if (fits(x, z, r, roadClear)) return { x, z };
    }
    return null;
  };

  for (let i = 0; i < 8; i++) {
    const h = 22 + rand() * 28;
    const radius = 12 + rand() * 10;
    const spot = place(radius * 0.9, 28);
    if (!spot) continue;
    const mesa: Mesa = {
      x: spot.x,
      z: spot.z,
      h,
      r: radius,
      rot: rand() * Math.PI,
      color: MESA_COLORS[i % MESA_COLORS.length],
    };
    mesas.push(mesa);
    obstacles.push({ x: mesa.x, z: mesa.z, r: radius * 0.72 });
  }

  for (let i = 0; i < 72; i++) {
    const xz = 0.55 + rand() * 1.7;
    const y = 0.4 + rand() * 1.35;
    const r = xz * 0.82;
    const spot = place(r, 11);
    if (!spot) continue;
    rocks.push({
      x: spot.x,
      z: spot.z,
      xz,
      y,
      rot: rand() * Math.PI,
      color: ROCK_COLORS[(rand() * ROCK_COLORS.length) | 0],
    });
    obstacles.push({ x: spot.x, z: spot.z, r });
  }

  for (let i = 0; i < 48; i++) {
    const h = 1.4 + rand() * 2.1;
    const spot = place(0.6, 10);
    if (!spot) continue;
    const arms = rand() < 0.25 ? 0 : rand() < 0.45 ? 1 : 2;
    cacti.push({
      x: spot.x,
      z: spot.z,
      h,
      rot: rand() * Math.PI * 2,
      arms,
      armSide: rand() < 0.5 ? -1 : 1,
    });
    obstacles.push({ x: spot.x, z: spot.z, r: 0.55 });
  }

  for (let i = 0; i < 26; i++) {
    const s = 0.7 + rand() * 0.7;
    const spot = place(0.7 * s, 10);
    if (!spot) continue;
    barrels.push({ x: spot.x, z: spot.z, s });
    obstacles.push({ x: spot.x, z: spot.z, r: 0.55 * s });
  }

  return { obstacles, rocks, cacti, barrels, mesas };
}
