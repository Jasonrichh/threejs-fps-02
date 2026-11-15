// Cinderworks Yard — the map. A 64 x 44 m industrial yard at dusk: two plant sites
// (A west, B east), a mid foundry hall, shipping containers, crates, barrels and a
// perimeter wall. Everything is built from boxes/cylinders with procedural canvas
// textures, so the game needs no asset files and no network. Colliders are 2D AABBs
// (walls are tall enough that every shot is blocked the same way); the waypoint graph
// is what the bots walk.
import * as THREE from 'three';

export const MAP = { w: 64, h: 44, boundX: 31, boundZ: 21 };

function canvasTexture(size, draw, repeatX = 1, repeatY = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function noise(ctx, s, n, alpha, light, dark) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? light : dark;
    ctx.globalAlpha = Math.random() * alpha;
    const r = 1 + Math.random() * 3;
    ctx.fillRect(Math.random() * s, Math.random() * s, r, r);
  }
  ctx.globalAlpha = 1;
}
function concreteTex(base, line) {
  return canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = base; ctx.fillRect(0, 0, s, s);
    noise(ctx, s, 900, 0.16, '#ffffff', '#000000');
    ctx.strokeStyle = line; ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, s - 2, s - 2);
    ctx.beginPath(); ctx.moveTo(0, s / 2); ctx.lineTo(s, s / 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s / 2, 0); ctx.lineTo(s / 2, s); ctx.stroke();
  }, 8, 6);
}
function metalTex(base, stripe) {
  return canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = base; ctx.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 16) { ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(x, 0, 4, s); }
    noise(ctx, s, 500, 0.12, '#ffffff', '#000000');
    ctx.fillStyle = stripe; ctx.fillRect(0, s - 10, s, 10);
  }, 2, 1);
}
function hazardTex() {
  return canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#e8a91c'; ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#15161a';
    for (let i = -s; i < s * 2; i += 32) {
      ctx.beginPath(); ctx.moveTo(i, s); ctx.lineTo(i + 16, 0); ctx.lineTo(i + 32, 0); ctx.lineTo(i + 16, s); ctx.fill();
    }
  }, 4, 1);
}

export function buildWorld(scene) {
  const colliders = []; // {x0,z0,x1,z1,h}
  const groundTex = concreteTex('#565a61', '#43464c');
  const wallTex = concreteTex('#5d6167', '#484b51');
  const rustTex = metalTex('#6b4a2f', '#8a5a33');
  const tealTex = metalTex('#2e5f66', '#3d7d86');
  const orangeTex = metalTex('#7a4a1e', '#c97a26');
  const hazard = hazardTex();

  // Dusk sky: big gradient dome + fog + low orange sun + cool fill.
  const skyGeo = new THREE.SphereGeometry(220, 24, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, fog: false, depthWrite: false,
    uniforms: { top: { value: new THREE.Color(0x2a3560) }, mid: { value: new THREE.Color(0xe07038) }, bot: { value: new THREE.Color(0x4a3226) } },
    vertexShader: 'varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 bot; void main(){ float h=normalize(vP).y; vec3 c = h>0.12 ? mix(mid, top, smoothstep(0.12,0.65,h)) : mix(bot, mid, smoothstep(-0.08,0.12,h)); gl_FragColor=vec4(c,1.0); }',
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
  scene.fog = new THREE.Fog(0x3a2a20, 55, 190);
  const sun = new THREE.DirectionalLight(0xffb070, 2.4);
  sun.position.set(-40, 26, 30); scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xa89ab5, 0x4a3828, 1.5));
  scene.add(new THREE.AmbientLight(0x8a6a50, 0.55));
  const moon = new THREE.DirectionalLight(0x5a7bd8, 0.35);
  moon.position.set(30, 40, -30); scene.add(moon);

  // Distant skyline silhouettes (outside the wall, purely visual).
  const skylineMat = new THREE.MeshBasicMaterial({ color: 0x1a1410, fog: true });
  const skyline = [[-70, -40, 18, 26], [-45, -55, 12, 34], [-10, -60, 22, 22], [25, -58, 14, 40], [55, -50, 20, 26], [75, -30, 12, 30], [-75, 20, 14, 22], [78, 25, 16, 24], [-60, 55, 20, 20], [60, 58, 18, 28]];
  for (const [x, z, w, h] of skyline) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 4), skylineMat);
    m.position.set(x, h / 2 - 1, z); scene.add(m);
  }
  // Chimney stacks with blinking beacons.
  const stackMat = new THREE.MeshStandardMaterial({ color: 0x3a2e26, roughness: 0.95 });
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
  const beacons = [];
  for (const [x, z] of [[-58, -30], [58, -32], [52, 30]]) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.4, 30, 10), stackMat);
    s.position.set(x, 14, z); scene.add(s);
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 8), beaconMat.clone());
    b.position.set(x, 29.6, z); scene.add(b); beacons.push(b);
  }

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(MAP.w + 16, MAP.h + 16), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

  const box = (x, z, w, h, d, mat, collide = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, h / 2, z); scene.add(m);
    if (collide) colliders.push({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2, h });
    return m;
  };
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9 });
  // Perimeter walls.
  box(0, -MAP.h / 2 - 0.5, MAP.w + 2, 4.5, 1, wallMat);
  box(0, MAP.h / 2 + 0.5, MAP.w + 2, 4.5, 1, wallMat);
  box(-MAP.w / 2 - 0.5, 0, 1, 4.5, MAP.h + 2, wallMat);
  box(MAP.w / 2 + 0.5, 0, 1, 4.5, MAP.h + 2, wallMat);

  // Mid foundry hall: two long walls with a gap each side, roof beams, furnace glow.
  const hallMat = new THREE.MeshStandardMaterial({ map: rustTex, roughness: 0.85 });
  box(-8, -3, 16, 5, 1.2, hallMat);          // north wall of hall (gap at x>0)
  box(8, 3, 16, 5, 1.2, hallMat);            // south wall (gap at x<0)
  box(-16.6, 0, 1.2, 5, 7.2, hallMat);       // west end
  box(16.6, 0, 1.2, 5, 7.2, hallMat);        // east end
  const beamMat = new THREE.MeshStandardMaterial({ color: 0x2e2a26, roughness: 0.7, metalness: 0.5 });
  for (const bx of [-12, -4, 4, 12]) box(bx, 0, 0.8, 0.8, 7.2, beamMat, false).position.y = 5.4;
  const furnace = new THREE.Mesh(new THREE.BoxGeometry(3, 2.2, 1), new THREE.MeshStandardMaterial({ color: 0x1c1a18, emissive: 0xff5a00, emissiveIntensity: 1.4 }));
  furnace.position.set(-14.5, 1.1, 0); scene.add(furnace);
  const furnaceLight = new THREE.PointLight(0xff6a1a, 18, 16, 1.8);
  furnaceLight.position.set(-13, 2, 0); scene.add(furnaceLight);

  // Shipping containers (cover + colour blocks).
  const cont = (x, z, w, d, mat, ry = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 2.6, d), mat);
    m.position.set(x, 1.3, z); m.rotation.y = ry; scene.add(m);
    const c = Math.cos(ry), s = Math.sin(ry);
    const hw = w / 2, hd = d / 2;
    const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([a, b]) => [x + a * c - b * s, z + a * s + b * c]);
    colliders.push({ x0: Math.min(...corners.map(p => p[0])), z0: Math.min(...corners.map(p => p[1])), x1: Math.max(...corners.map(p => p[0])), z1: Math.max(...corners.map(p => p[1])), h: 2.6 });
    return m;
  };
  const teal = new THREE.MeshStandardMaterial({ map: tealTex, roughness: 0.8, metalness: 0.25 });
  const orange = new THREE.MeshStandardMaterial({ map: orangeTex, roughness: 0.8, metalness: 0.25 });
  const grey = new THREE.MeshStandardMaterial({ map: metalTex('#565b61', '#6a6f76'), roughness: 0.8, metalness: 0.3 });
  cont(-24, 6, 7, 2.6, teal); cont(-24, 9.4, 7, 2.6, orange);
  cont(24, 6, 7, 2.6, orange); cont(24, 9.4, 7, 2.6, teal);
  cont(-10, -14, 6, 2.6, grey, 0.5); cont(10, -14, 6, 2.6, grey, -0.5);
  cont(-26, -14, 2.6, 6, teal, 0.35); cont(26, -14, 2.6, 6, orange, -0.35);
  cont(0, -18.5, 8, 2.6, teal); cont(0, 14, 6, 2.6, grey);

  // Crates (low cover you can shoot over while standing? no — 1.2 m, blocks crouch shots).
  const crateMat = new THREE.MeshStandardMaterial({ map: metalTex('#7a6a42', '#8f7d4e'), roughness: 0.9 });
  const crate = (x, z, s = 1.4) => box(x, z, s, 1.25, s, crateMat);
  crate(-6, 8, 1.4); crate(-4.4, 8, 1.1); crate(6, 8, 1.4); crate(4.4, 8, 1.1);
  crate(-6, -8, 1.4); crate(6, -8, 1.4); crate(0, 8, 1.2);
  crate(-18, 0, 1.5); crate(18, 0, 1.5); crate(-18, -6, 1.2); crate(18, -6, 1.2);
  crate(-12, 16, 1.3); crate(12, 16, 1.3); crate(-12, -18, 1.3); crate(12, -18, 1.3);

  // Barrels (cylinders, low cover).
  const barrelMats = [new THREE.MeshStandardMaterial({ color: 0x8a2f23, roughness: 0.7, metalness: 0.4 }), new THREE.MeshStandardMaterial({ color: 0x2f5d3a, roughness: 0.7, metalness: 0.4 })];
  const barrel = (x, z, i) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.1, 12), barrelMats[i % 2]);
    m.position.set(x, 0.55, z); scene.add(m);
    colliders.push({ x0: x - 0.55, z0: z - 0.55, x1: x + 0.55, z1: z + 0.55, h: 1.1 });
  };
  barrel(-20, 12, 0); barrel(-19, 12.6, 1); barrel(20, 12, 1); barrel(19, 12.6, 0);
  barrel(-28, -6, 0); barrel(28, -6, 1); barrel(-2, -12, 0); barrel(2, -12, 1);

  // Plant sites: hazard ring + glowing beacon column + floating letter.
  function siteLetter(text) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f0b429'; ctx.font = 'bold 84px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 64, 68);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
    s.scale.set(3.4, 3.4, 1); return s;
  }
  const sites = {};
  for (const [key, sx, sz, color] of [['A', -25, -13, 0xff7a1a], ['B', 25, -13, 0xff7a1a]]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.2, 4, 40), new THREE.MeshBasicMaterial({ map: hazard, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(sx, 0.03, sz); scene.add(ring);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.6, 9, 12, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
    beam.position.set(sx, 4.5, sz); scene.add(beam);
    const letter = siteLetter(key); letter.position.set(sx, 6.4, sz); scene.add(letter);
    const pl = new THREE.PointLight(color, 8, 14, 1.8); pl.position.set(sx, 3, sz); scene.add(pl);
    sites[key] = { x: sx, z: sz, r: 3.6, ring, beam, light: pl };
  }

  // Floodlight poles.
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x22242a, roughness: 0.6, metalness: 0.6 });
  for (const [x, z] of [[-28, 18], [28, 18], [-28, -18], [28, -18], [0, 0]]) {
    if (x === 0) continue;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 7, 8), poleMat);
    p.position.set(x, 3.5, z); scene.add(p);
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.4, 0.5), poleMat);
    head.position.set(x, 7, z); scene.add(head);
    const l = new THREE.PointLight(0xffe0b0, 10, 22, 1.8); l.position.set(x, 6.6, z); scene.add(l);
  }

  // Waypoint graph for bots (nodes + links). Lanes: spawn -> mid -> sites.
  const wp = [
    [-27, 17], [-14, 17], [0, 17], [14, 17], [27, 17],           // 0-4 south lane
    [-27, 8], [-14, 8], [0, 8], [14, 8], [27, 8],               // 5-9
    [-27, 0], [-14, 0], [0, 0], [14, 0], [27, 0],               // 10-14 mid
    [-27, -8], [-14, -8], [0, -8], [14, -8], [27, -8],          // 15-19
    [-25, -13], [25, -13], [-27, -17], [0, -17], [27, -17],     // 20-24 sites + north
    [-20, -13], [20, -13], [-6, -13], [6, -13],                 // 25-28 site approaches
  ].map(([x, z]) => ({ x, z, links: [] }));
  const link = (a, b) => { wp[a].links.push(b); wp[b].links.push(a); };
  [[0, 1], [1, 2], [2, 3], [3, 4], [5, 6], [6, 7], [7, 8], [8, 9], [10, 11], [11, 12], [12, 13], [13, 14], [15, 16], [16, 17], [17, 18], [18, 19],
   [0, 5], [1, 6], [2, 7], [3, 8], [4, 9], [5, 10], [6, 11], [7, 12], [8, 13], [9, 14], [10, 15], [11, 16], [12, 17], [13, 18], [14, 19],
   [15, 20], [19, 21], [20, 25], [21, 26], [16, 25], [18, 26], [16, 27], [18, 28], [17, 27], [17, 28],
   [22, 15], [23, 17], [24, 19], [22, 23], [23, 24], [20, 22], [21, 24], [25, 22], [26, 24], [7, 2], [12, 7], [12, 17], [2, 12]
  ].forEach(([a, b]) => link(a, b));

  return {
    colliders, sites, waypoints: wp, beacons,
    spawns: {
      ember: [[-16, 18.5], [-8, 19], [0, 19], [8, 19], [16, 18.5]],
      volt: [[-16, -18.5], [-8, -19], [0, -19], [8, -19], [16, -18.5]],
    },
  };
}

// Circle (player/bot, radius r) vs AABB colliders: push out, axis by axis.
export function resolveCircle(pos, r, colliders) {
  for (const c of colliders) {
    const nx = Math.max(c.x0, Math.min(pos.x, c.x1));
    const nz = Math.max(c.z0, Math.min(pos.z, c.z1));
    const dx = pos.x - nx, dz = pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r && d2 > 1e-8) {
      const d = Math.sqrt(d2);
      pos.x = nx + (dx / d) * r; pos.z = nz + (dz / d) * r;
    } else if (d2 <= 1e-8) {
      // Centre inside the box: push out along the smallest penetration axis.
      const pl = pos.x - c.x0, pr = c.x1 - pos.x, pt = pos.z - c.z0, pb = c.z1 - pos.z;
      const m = Math.min(pl, pr, pt, pb);
      if (m === pl) pos.x = c.x0 - r; else if (m === pr) pos.x = c.x1 + r;
      else if (m === pt) pos.z = c.z0 - r; else pos.z = c.z1 + r;
    }
  }
  pos.x = Math.max(-MAP.boundX, Math.min(MAP.boundX, pos.x));
  pos.z = Math.max(-MAP.boundZ, Math.min(MAP.boundZ, pos.z));
}

// 2D ray vs colliders (walls tall enough to block a shot at height y<=h). Returns distance or Infinity.
export function rayWallDist(ox, oz, dx, dz, maxDist, colliders) {
  let best = maxDist;
  for (const c of colliders) {
    if (c.h < 1.2) continue;
    let tmin = 0, tmax = best;
    if (Math.abs(dx) < 1e-9) { if (ox < c.x0 || ox > c.x1) continue; }
    else {
      let t1 = (c.x0 - ox) / dx, t2 = (c.x1 - ox) / dx;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    if (Math.abs(dz) < 1e-9) { if (oz < c.z0 || oz > c.z1) continue; }
    else {
      let t1 = (c.z0 - oz) / dz, t2 = (c.z1 - oz) / dz;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    if (tmin >= 0 && tmin < best) best = tmin;
  }
  return best;
}

// Line of sight between two points at eye height, blocked by any tall collider.
export function hasLOS(ax, az, bx, bz, colliders) {
  const dx = bx - ax, dz = bz - az;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.01) return true;
  return rayWallDist(ax, az, dx / dist, dz / dist, dist, colliders) >= dist - 0.05;
}

// BFS shortest path over the waypoint graph. Returns array of waypoint indices.
export function findPath(wp, fromIdx, toIdx) {
  if (fromIdx === toIdx) return [toIdx];
  const prev = new Array(wp.length).fill(-1);
  const q = [fromIdx]; prev[fromIdx] = fromIdx;
  while (q.length) {
    const cur = q.shift();
    for (const n of wp[cur].links) {
      if (prev[n] !== -1) continue;
      prev[n] = cur;
      if (n === toIdx) {
        const path = [n]; let p = cur;
        while (p !== fromIdx) { path.unshift(p); p = prev[p]; }
        return path;
      }
      q.push(n);
    }
  }
  return [toIdx];
}
export function nearestWaypoint(wp, x, z) {
  let best = 0, bd = Infinity;
  wp.forEach((w, i) => { const d = (w.x - x) ** 2 + (w.z - z) ** 2; if (d < bd) { bd = d; best = i; } });
  return best;
}
