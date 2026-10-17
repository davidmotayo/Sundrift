import * as THREE from "three";
import { createDrive, resetDrive, stepDrive, type DriveInput } from "./sim";
import { createWorld } from "./world";

export type TouchHeld = {
  gas: boolean;
  brake: boolean;
  left: boolean;
  right: boolean;
};

export type MountOpts = {
  isStarted: () => boolean;
  touch: TouchHeld;
  speedEl: HTMLElement | null;
  gearEl: HTMLElement | null;
};

export type DriveHandle = {
  dispose: () => void;
  unlock: () => void;
  reset: () => void;
};

const STEP = 1 / 60;
const UP = new THREE.Vector3(0, 1, 0);

type Puff = {
  life: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
};

export function mountDrive(canvas: HTMLCanvasElement, opts: MountOpts): DriveHandle {
  const world = createWorld();
  const sim = createDrive();
  const container = canvas.parentElement ?? canvas;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0xf5b875, 1);

  const narrow = window.matchMedia("(max-width: 48rem)").matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, narrow ? 1.25 : 1.5));

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xf5b875, 48, 300);
  scene.background = new THREE.Color(0xf5b875);

  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 900);

  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  const g = <T extends THREE.BufferGeometry>(geo: T) => {
    geos.push(geo);
    return geo;
  };
  const m = <T extends THREE.Material>(mat: T) => {
    mats.push(mat);
    return mat;
  };

  const sky = new THREE.Mesh(
    g(new THREE.SphereGeometry(680, 28, 16)),
    m(
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        toneMapped: false,
        vertexShader: `
          varying vec3 vP;
          void main() {
            vP = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying vec3 vP;
          void main() {
            float h = normalize(vP).y;
            vec3 top = vec3(0.40, 0.64, 0.86);
            vec3 hor = vec3(0.96, 0.71, 0.45);
            vec3 col = mix(hor, top, smoothstep(-0.02, 0.62, h));
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
    ),
  );
  scene.add(sky);

  const sun = new THREE.Mesh(
    g(new THREE.SphereGeometry(16, 16, 12)),
    m(new THREE.MeshBasicMaterial({ color: 0xfff1c2, fog: false, toneMapped: false })),
  );
  sun.position.set(-140, 78, -220);
  scene.add(sun);

  scene.add(new THREE.HemisphereLight(0xc5d8ee, 0xc4a06a, 0.95));
  const sunLight = new THREE.DirectionalLight(0xfff3d4, 1.45);
  sunLight.position.set(-40, 70, 30);
  scene.add(sunLight);

  const sandTex = sandTexture();
  textures.push(sandTex);
  const ground = new THREE.Mesh(
    g(new THREE.PlaneGeometry(1400, 1400)),
    m(new THREE.MeshLambertMaterial({ map: sandTex, color: 0xffffff })),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const shoulder = new THREE.Mesh(
    g(new THREE.PlaneGeometry(18, 700)),
    m(new THREE.MeshLambertMaterial({ color: 0xd7b483 })),
  );
  shoulder.rotation.x = -Math.PI / 2;
  shoulder.position.y = 0.01;
  scene.add(shoulder);

  const roadTex = roadTexture();
  textures.push(roadTex);
  roadTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const road = new THREE.Mesh(
    g(new THREE.PlaneGeometry(10.5, 700)),
    m(new THREE.MeshLambertMaterial({ map: roadTex })),
  );
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.025;
  scene.add(road);

  addRocks(scene, world, g, m);
  addCacti(scene, world, g, m);
  addBarrels(scene, world, g, m);
  addMesas(scene, world, g, m);

  const car = buildCar(g, m);
  scene.add(car.group);

  const dustGeo = g(new THREE.SphereGeometry(0.28, 6, 5));
  const dustMat = m(
    new THREE.MeshBasicMaterial({ color: 0xe4c79a, transparent: true, opacity: 0.45, depthWrite: false }),
  );
  const DUST = 36;
  const dust = new THREE.InstancedMesh(dustGeo, dustMat, DUST);
  dust.frustumCulled = false;
  scene.add(dust);
  const puffs: Puff[] = Array.from({ length: DUST }, () => ({
    life: 0,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
  }));
  let puffCursor = 0;

  const camPos = new THREE.Vector3(sim.x, 3.1, sim.z + 8);
  const look = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const dummy = new THREE.Object3D();
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const keys = new Set<string>();
  let injected: string[] | null = null;
  let injectedSteer: number | null = null;

  const probe = {
    getYaw: () => sim.yaw,
    getSpeed: () => sim.speed,
    setKeys: (codes: string[]) => {
      injected = codes;
    },
    setSteer: (v: number) => {
      injectedSteer = v;
    },
  };
  window.__controlsTest = probe;

  const onKeyDown = (e: KeyboardEvent) => {
    if (
      e.code === "ArrowUp" ||
      e.code === "ArrowDown" ||
      e.code === "ArrowLeft" ||
      e.code === "ArrowRight" ||
      e.code === "Space"
    ) {
      e.preventDefault();
    }
    keys.add(e.code);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    keys.delete(e.code);
  };
  const clearKeys = () => {
    keys.clear();
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", clearKeys);
  document.addEventListener("visibilitychange", clearKeys);

  const engine = createEngine();
  let acc = 0;
  let last = performance.now();
  let spin = 0;
  let alive = true;
  let frame = 0;

  const resize = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w < 2 || h < 2) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  const placeCamera = (snap: boolean, dt: number) => {
    const fx = -Math.sin(sim.yaw);
    const fz = -Math.cos(sim.yaw);
    const follow = 7.4;
    const height = 2.85;
    desired.set(sim.x - fx * follow, height, sim.z - fz * follow);
    if (snap) camPos.copy(desired);
    else camPos.lerp(desired, 1 - Math.exp(-5.2 * dt));
    camera.position.copy(camPos);
    if (!reduced) {
      camera.position.y += Math.sin(performance.now() * 0.012) * Math.min(0.035, Math.abs(sim.speed) * 0.0014);
    }
    look.set(sim.x + fx * 6.5, 1.05, sim.z + fz * 6.5);
    camera.lookAt(look);
    sky.position.copy(camera.position);
  };

  const syncCar = (dt: number) => {
    car.group.position.set(sim.x, 0, sim.z);
    car.group.rotation.y = sim.yaw;
    const steerVis = sampleInput().steer;
    car.fl.rotation.y = steerVis * 0.38;
    car.fr.rotation.y = steerVis * 0.38;
    spin += (sim.speed / 0.38) * dt;
    car.wheels.forEach((w) => {
      w.rotation.x = spin;
    });
  };

  const syncDust = (dt: number) => {
    frame += 1;
    if (Math.abs(sim.speed) > 4 && frame % 2 === 0) {
      spawnPuff(0.9);
      spawnPuff(-0.9);
    }
    for (let i = 0; i < DUST; i++) {
      const p = puffs[i];
      if (p.life <= 0) {
        dummy.position.set(0, -10, 0);
        dummy.scale.setScalar(0.001);
      } else {
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        dummy.position.set(p.x, p.y, p.z);
        const s = Math.max(0.001, p.life * 1.4);
        dummy.scale.setScalar(s);
      }
      dummy.updateMatrix();
      dust.setMatrixAt(i, dummy.matrix);
    }
    dust.instanceMatrix.needsUpdate = true;
  };

  function spawnPuff(side: number) {
    const yaw = sim.yaw;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const lx = side;
    const lz = 1.45;
    const p = puffs[puffCursor];
    puffCursor = (puffCursor + 1) % DUST;
    p.life = 0.55;
    p.x = sim.x + lx * cos + lz * sin;
    p.y = 0.25;
    p.z = sim.z - lx * sin + lz * cos;
    p.vx = Math.sin(yaw) * 1.4 + (Math.random() - 0.5) * 0.8;
    p.vy = 0.6 + Math.random() * 0.5;
    p.vz = Math.cos(yaw) * 1.4 + (Math.random() - 0.5) * 0.8;
  }

  function sampleInput(): DriveInput {
    const started = opts.isStarted() || injected !== null;
    if (!started) return { throttle: 0, steer: 0 };
    const has = (code: string) => (injected ? injected.includes(code) : keys.has(code));
    let throttle = 0;
    let steer = 0;
    if (has("KeyW") || has("ArrowUp") || opts.touch.gas) throttle += 1;
    if (has("KeyS") || has("ArrowDown") || opts.touch.brake) throttle -= 1;
    if (has("KeyA") || has("ArrowLeft") || opts.touch.left) steer += 1;
    if (has("KeyD") || has("ArrowRight") || opts.touch.right) steer -= 1;
    if (injectedSteer !== null) steer = injectedSteer;
    return {
      throttle: Math.max(-1, Math.min(1, throttle)),
      steer: Math.max(-1, Math.min(1, steer)),
    };
  }

  const paintHud = () => {
    if (opts.speedEl) opts.speedEl.textContent = String(Math.round(Math.abs(sim.speed) * 3.6));
    if (opts.gearEl) opts.gearEl.textContent = sim.speed < -0.4 ? "R" : "D";
  };

  const loop = (now: number) => {
    if (!alive) return;
    const dt = Math.min(0.1, (now - last) / 1000 || 0);
    last = now;
    acc += dt;
    const input = sampleInput();
    let steps = 0;
    while (acc >= STEP && steps < 5) {
      stepDrive(sim, input, STEP, world.obstacles);
      acc -= STEP;
      steps += 1;
    }
    syncCar(dt);
    syncDust(dt);
    placeCamera(false, dt);
    engine.update(sim.speed, input.throttle);
    paintHud();
    renderer.render(scene, camera);
  };

  placeCamera(true, 0);
  syncCar(0);
  paintHud();
  renderer.setAnimationLoop(loop);

  return {
    unlock: () => engine.unlock(),
    reset: () => {
      resetDrive(sim);
      acc = 0;
      placeCamera(true, 0);
      syncCar(0);
      paintHud();
    },
    dispose: () => {
      alive = false;
      renderer.setAnimationLoop(null);
      ro.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clearKeys);
      document.removeEventListener("visibilitychange", clearKeys);
      if (window.__controlsTest === probe) delete window.__controlsTest;
      engine.close();
      geos.forEach((geo) => geo.dispose());
      mats.forEach((mat) => mat.dispose());
      textures.forEach((tex) => tex.dispose());
      renderer.dispose();
    },
  };
}

function sandTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(c);
  ctx.fillStyle = "#e6c48a";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1600; i++) {
    const x = (Math.random() * 256) | 0;
    const y = (Math.random() * 256) | 0;
    const a = Math.random() * 0.18;
    ctx.fillStyle = Math.random() > 0.5 ? `rgba(120,78,40,${a})` : `rgba(255,236,196,${a})`;
    ctx.fillRect(x, y, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(48, 48);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function roadTexture() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 512;
  const ctx = c.getContext("2d");
  const tex = new THREE.CanvasTexture(c);
  if (!ctx) return tex;
  ctx.fillStyle = "#3a3834";
  ctx.fillRect(0, 0, 128, 512);
  ctx.fillStyle = "#ead7b0";
  ctx.fillRect(6, 0, 5, 512);
  ctx.fillRect(117, 0, 5, 512);
  ctx.fillStyle = "#f4e7c8";
  for (let y = 16; y < 512; y += 72) ctx.fillRect(58, y, 12, 36);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 42);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function addRocks(
  scene: THREE.Scene,
  world: ReturnType<typeof createWorld>,
  g: <T extends THREE.BufferGeometry>(geo: T) => T,
  mat: <T extends THREE.Material>(m: T) => T,
) {
  if (world.rocks.length === 0) return;
  const mesh = new THREE.InstancedMesh(
    g(new THREE.DodecahedronGeometry(1, 0)),
    mat(new THREE.MeshLambertMaterial({ color: 0xffffff })),
    world.rocks.length,
  );
  mesh.frustumCulled = false;
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  world.rocks.forEach((rock, i) => {
    dummy.position.set(rock.x, rock.y * 0.35, rock.z);
    dummy.scale.set(rock.xz, rock.y, rock.xz * (0.75 + (i % 5) * 0.05));
    dummy.rotation.set(0.2, rock.rot, 0.15);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, color.setHex(rock.color));
  });
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);
}

function addCacti(
  scene: THREE.Scene,
  world: ReturnType<typeof createWorld>,
  g: <T extends THREE.BufferGeometry>(geo: T) => T,
  mat: <T extends THREE.Material>(m: T) => T,
) {
  const list = world.cacti;
  if (list.length === 0) return;
  const trunkMat = mat(new THREE.MeshLambertMaterial({ color: 0x3c6b42 }));
  const trunks = new THREE.InstancedMesh(g(new THREE.CylinderGeometry(0.22, 0.28, 1, 7)), trunkMat, list.length);
  trunks.frustumCulled = false;
  const armCount = list.reduce((n, c) => n + c.arms, 0);
  const arms =
    armCount > 0
      ? new THREE.InstancedMesh(g(new THREE.CylinderGeometry(0.1, 0.13, 1, 6)), trunkMat, armCount)
      : null;
  if (arms) arms.frustumCulled = false;

  const dummy = new THREE.Object3D();
  const qYaw = new THREE.Quaternion();
  const qTilt = new THREE.Quaternion();
  const q = new THREE.Quaternion();
  const offset = new THREE.Vector3();
  const tiltAxis = new THREE.Vector3(0, 0, 1);
  let armIndex = 0;

  list.forEach((cactus, i) => {
    dummy.position.set(cactus.x, cactus.h * 0.5, cactus.z);
    dummy.scale.set(1, cactus.h, 1);
    dummy.rotation.set(0, cactus.rot, 0);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);

    const sides = cactus.arms === 2 ? [-1, 1] : cactus.arms === 1 ? [cactus.armSide] : [];
    qYaw.setFromAxisAngle(UP, cactus.rot);
    sides.forEach((side) => {
      if (!arms) return;
      const tilt = side * 0.95;
      qTilt.setFromAxisAngle(tiltAxis, tilt);
      q.copy(qYaw).multiply(qTilt);
      offset.set(side * 0.28, cactus.h * 0.62, 0).applyQuaternion(qYaw);
      dummy.position.set(cactus.x + offset.x, offset.y, cactus.z + offset.z);
      dummy.quaternion.copy(q);
      dummy.scale.set(1, 0.85, 1);
      dummy.updateMatrix();
      arms.setMatrixAt(armIndex, dummy.matrix);
      armIndex += 1;
    });
  });
  scene.add(trunks);
  if (arms) scene.add(arms);
}

function addBarrels(
  scene: THREE.Scene,
  world: ReturnType<typeof createWorld>,
  g: <T extends THREE.BufferGeometry>(geo: T) => T,
  mat: <T extends THREE.Material>(m: T) => T,
) {
  if (world.barrels.length === 0) return;
  const mesh = new THREE.InstancedMesh(
    g(new THREE.SphereGeometry(0.55, 8, 6)),
    mat(new THREE.MeshLambertMaterial({ color: 0x2f5a38 })),
    world.barrels.length,
  );
  mesh.frustumCulled = false;
  const dummy = new THREE.Object3D();
  world.barrels.forEach((barrel, i) => {
    dummy.position.set(barrel.x, 0.4 * barrel.s, barrel.z);
    dummy.scale.set(barrel.s, barrel.s * 0.72, barrel.s);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  scene.add(mesh);
}

function addMesas(
  scene: THREE.Scene,
  world: ReturnType<typeof createWorld>,
  g: <T extends THREE.BufferGeometry>(geo: T) => T,
  mat: <T extends THREE.Material>(m: T) => T,
) {
  if (world.mesas.length === 0) return;
  const mesh = new THREE.InstancedMesh(
    g(new THREE.CylinderGeometry(1, 1.18, 1, 6)),
    mat(new THREE.MeshLambertMaterial({ color: 0xffffff })),
    world.mesas.length,
  );
  mesh.frustumCulled = false;
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  world.mesas.forEach((mesa, i) => {
    dummy.position.set(mesa.x, mesa.h * 0.5, mesa.z);
    dummy.scale.set(mesa.r, mesa.h, mesa.r);
    dummy.rotation.set(0, mesa.rot, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, color.setHex(mesa.color));
  });
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);
}

function buildCar(
  g: <T extends THREE.BufferGeometry>(geo: T) => T,
  mat: <T extends THREE.Material>(m: T) => T,
) {
  const group = new THREE.Group();
  const bodyMat = mat(
    new THREE.MeshStandardMaterial({ color: 0xd4652f, roughness: 0.58, metalness: 0.05 }),
  );
  const darkMat = mat(new THREE.MeshStandardMaterial({ color: 0x241c16, roughness: 0.7, metalness: 0.08 }));
  const glassMat = mat(
    new THREE.MeshStandardMaterial({ color: 0x1b2830, roughness: 0.18, metalness: 0.45 }),
  );
  const lampMat = mat(
    new THREE.MeshStandardMaterial({
      color: 0xfff4d0,
      emissive: 0xfff1c4,
      emissiveIntensity: 0.9,
      roughness: 0.4,
    }),
  );
  const tailMat = mat(
    new THREE.MeshStandardMaterial({
      color: 0x8e241c,
      emissive: 0xc4382a,
      emissiveIntensity: 0.6,
      roughness: 0.45,
    }),
  );

  const body = new THREE.Mesh(g(new THREE.BoxGeometry(1.55, 0.46, 4.15)), bodyMat);
  body.position.set(0, 0.68, 0);
  group.add(body);

  const cabin = new THREE.Mesh(g(new THREE.BoxGeometry(1.38, 0.52, 1.55)), glassMat);
  cabin.position.set(0, 1.12, 0.28);
  group.add(cabin);

  const bed = new THREE.Mesh(g(new THREE.BoxGeometry(1.5, 0.28, 1.15)), darkMat);
  bed.position.set(0, 0.86, 1.35);
  group.add(bed);

  const nose = new THREE.Mesh(g(new THREE.BoxGeometry(1.48, 0.16, 0.7)), darkMat);
  nose.position.set(0, 0.5, -1.7);
  group.add(nose);

  const addLamp = (x: number, z: number, material: THREE.Material, w: number) => {
    const lamp = new THREE.Mesh(g(new THREE.BoxGeometry(w, 0.14, 0.08)), material);
    lamp.position.set(x, 0.72, z);
    group.add(lamp);
  };
  addLamp(-0.48, -2.08, lampMat, 0.32);
  addLamp(0.48, -2.08, lampMat, 0.32);
  addLamp(-0.5, 2.08, tailMat, 0.28);
  addLamp(0.5, 2.08, tailMat, 0.28);

  const shadow = new THREE.Mesh(
    g(new THREE.CircleGeometry(2.1, 18)),
    mat(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false })),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  group.add(shadow);

  const wheelGeo = g(new THREE.CylinderGeometry(0.38, 0.38, 0.28, 12));
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = mat(new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.85 }));
  const hubGeo = g(new THREE.CylinderGeometry(0.16, 0.16, 0.3, 8));
  hubGeo.rotateZ(Math.PI / 2);
  const hubMat = mat(new THREE.MeshStandardMaterial({ color: 0xcbb892, roughness: 0.45, metalness: 0.35 }));

  const wheels: THREE.Object3D[] = [];
  const makeWheel = (x: number, z: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.38, z);
    const spinner = new THREE.Group();
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    const hub = new THREE.Mesh(hubGeo, hubMat);
    spinner.add(wheel);
    spinner.add(hub);
    pivot.add(spinner);
    group.add(pivot);
    wheels.push(spinner);
    return pivot;
  };

  const fl = makeWheel(-0.86, -1.28);
  const fr = makeWheel(0.86, -1.28);
  makeWheel(-0.86, 1.28);
  makeWheel(0.86, 1.28);

  return { group, wheels, fl, fr };
}

function createEngine() {
  let ctx: AudioContext | null = null;
  let osc: OscillatorNode | null = null;
  let gain: GainNode | null = null;
  let filter: BiquadFilterNode | null = null;
  return {
    unlock() {
      if (ctx) {
        void ctx.resume();
        return;
      }
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      osc = ctx.createOscillator();
      osc.type = "triangle";
      filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 220;
      gain = ctx.createGain();
      gain.gain.value = 0.0001;
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      void ctx.resume();
    },
    update(speed: number, throttle: number) {
      if (!ctx || !osc || !gain || !filter) return;
      const spd = Math.abs(speed);
      osc.frequency.setTargetAtTime(46 + spd * 2.2 + (throttle > 0 ? 18 : 0), ctx.currentTime, 0.08);
      filter.frequency.setTargetAtTime(170 + spd * 16, ctx.currentTime, 0.1);
      const vol = 0.01 + Math.min(0.04, spd * 0.0015) + (throttle !== 0 ? 0.008 : 0);
      gain.gain.setTargetAtTime(vol, ctx.currentTime, 0.08);
    },
    close() {
      void ctx?.close();
      ctx = null;
    },
  };
}

declare global {
  interface Window {
    __controlsTest?: {
      getYaw: () => number;
      getSpeed: () => number;
      setKeys?: (codes: string[]) => void;
      setSteer?: (v: number) => void;
    };
  }
}
