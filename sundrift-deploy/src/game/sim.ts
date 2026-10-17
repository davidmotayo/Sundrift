export type DriveInput = {
  /** +1 gas, −1 brake / reverse */
  throttle: number;
  /** +1 left (A / ←), −1 right (D / →) */
  steer: number;
};

export type DriveState = {
  x: number;
  z: number;
  yaw: number;
  speed: number;
};

export type Obstacle = {
  x: number;
  z: number;
  r: number;
};

export const SPAWN = { x: 0, z: 210, yaw: 0 };

const MAX_FWD = 32;
const MAX_REV = 9;
const CAR_R = 1.15;
const LIMIT = 360;

export function createDrive(): DriveState {
  return { x: SPAWN.x, z: SPAWN.z, yaw: SPAWN.yaw, speed: 0 };
}

export function resetDrive(s: DriveState) {
  s.x = SPAWN.x;
  s.z = SPAWN.z;
  s.yaw = SPAWN.yaw;
  s.speed = 0;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Arcade step. Heading basis (controls skill):
 *   forward = (−sin yaw, 0, −cos yaw), yaw 0 faces −Z, +yaw is nose-left.
 *   A / ← → steer +1 → yaw increases while moving forward.
 */
export function stepDrive(s: DriveState, input: DriveInput, dt: number, obstacles: readonly Obstacle[]) {
  const throttle = clamp(input.throttle, -1, 1);
  const steer = clamp(input.steer, -1, 1);

  if (throttle > 0) {
    s.speed += (s.speed < -0.4 ? 28 : 18) * dt;
  } else if (throttle < 0) {
    s.speed += (s.speed > 0.4 ? -28 : -12) * dt;
  }

  s.speed -= s.speed * 0.42 * dt;
  if (throttle === 0 && s.speed !== 0) {
    const coast = Math.min(Math.abs(s.speed), 2.4 * dt);
    s.speed -= Math.sign(s.speed) * coast;
  }

  if (Math.abs(s.speed) < 0.08 && throttle === 0) s.speed = 0;
  s.speed = clamp(s.speed, -MAX_REV, MAX_FWD);

  const sp = Math.abs(s.speed);
  const speedFactor = Math.min(1, sp / 4);
  const reverse = s.speed >= 0 ? 1 : -1;
  s.yaw += steer * 2.2 * speedFactor * reverse * dt;

  const fx = -Math.sin(s.yaw);
  const fz = -Math.cos(s.yaw);
  s.x += fx * s.speed * dt;
  s.z += fz * s.speed * dt;

  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    const dx = s.x - o.x;
    const dz = s.z - o.z;
    const min = o.r + CAR_R;
    const d2 = dx * dx + dz * dz;
    if (d2 < min * min && d2 > 1e-8) {
      const d = Math.sqrt(d2);
      const push = min - d;
      s.x += (dx / d) * push;
      s.z += (dz / d) * push;
      s.speed *= 0.7;
    }
  }

  if (s.x > LIMIT) {
    s.x = LIMIT;
    s.speed *= 0.45;
  } else if (s.x < -LIMIT) {
    s.x = -LIMIT;
    s.speed *= 0.45;
  }
  if (s.z > LIMIT) {
    s.z = LIMIT;
    s.speed *= 0.45;
  } else if (s.z < -LIMIT) {
    s.z = -LIMIT;
    s.speed *= 0.45;
  }
}
