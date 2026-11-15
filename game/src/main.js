// EMBERLINE — a round-based tactical FPS (three.js, static files, no network).
// 5v5: you + 4 EMBER bots vs 5 VOLT bots on the Cinderworks Yard. Plant the Igniter
// at Site A or B, or eliminate the other crew. Win rounds, earn credits, buy steel.
// First to 5 rounds takes the yard. ?shot=start|play|buy|end&seed=N stages a
// deterministic frame for screenshots and sets window.__shotReady.
import * as THREE from 'three';
import { buildWorld, resolveCircle, rayWallDist, hasLOS, MAP } from './world.js';
import { Bot } from './bots.js';
import { WEAPONS, SHOP_ORDER, ARMOR_PRICE } from './weapons.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { sfx } from './audio.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot');
const NOFREEZE = params.get('nofreeze') === '1';
const SEED = Number(params.get('seed') || 7);
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);

const statusEl = document.getElementById('debug-status');
window.__errors = [];
window.onerror = (msg, src, line) => {
  window.__errors.push(`${msg} @${line}`);
  statusEl.textContent = `ERROR: ${msg}`;
};

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.08, 500);
camera.rotation.order = 'YXZ';
scene.add(camera);

const world = buildWorld(scene);
const hud = createHud();
const input = createInput(renderer.domElement, (locked) => {
  if (!locked && phase === 'live' && player.alive && !SHOT) hud.showOverlay('paused');
});

// ---- actors ---------------------------------------------------------------
const EMBER_NAMES = ['Ash', 'Cinder', 'Flint', 'Soot'];
const VOLT_NAMES = ['Surge', 'Amp', 'Relay', 'Fuse', 'Coil'];
const bots = [];
for (let i = 0; i < 4; i++) bots.push(new Bot(scene, 'ember', EMBER_NAMES[i], [0, 0], rng));
for (let i = 0; i < 5; i++) bots.push(new Bot(scene, 'volt', VOLT_NAMES[i], [0, 0], rng));
const botMeshes = [];
for (const b of bots) botMeshes.push(b.bodyMesh, b.headMesh);

const player = {
  name: 'You', team: 'ember', isPlayer: true,
  pos: new THREE.Vector3(0, 0, 19), vel: new THREE.Vector3(),
  yaw: Math.PI, pitch: 0, hp: 100, armor: 0, alive: true,
  money: 800, kills: 0, deaths: 0,
  weapon: WEAPONS.p9, mag: WEAPONS.p9.mag, reserve: WEAPONS.p9.reserve,
  owned: ['p9'], spreadBloom: 0, lastShotAt: -10, nextShotAt: 0,
  reloading: false, reloadEndAt: 0, onGround: true, crouched: false,
  actionProgress: 0, actionKind: null, spectateIdx: 0,
};

// ---- game state ------------------------------------------------------------
let phase = 'menu'; // menu | buy | live | roundEnd | matchEnd
let round = 1, scoreE = 0, scoreV = 0, lossStreak = 0;
let phaseT = 0; // seconds left in current phase
let planted = null; // {site, timer}
let shotFrozen = false;
let elapsed = 0;
const ROUND_TARGET = 5, BUY_TIME = 12, ROUND_TIME = 100, PLANT_TIME = 35;

// ---- view model + effects ---------------------------------------------------
const gunGroup = new THREE.Group();
{
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.35, metalness: 0.75 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.5, metalness: 0.4 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.55), dark);
  gunGroup.add(body);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 8), dark);
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -0.4); gunGroup.add(barrel);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.08), accent);
  sight.position.set(0, 0.09, -0.1); gunGroup.add(sight);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.1), dark);
  grip.position.set(0, -0.13, 0.16); grip.rotation.x = 0.35; gunGroup.add(grip);
  gunGroup.position.set(0.3, -0.26, -0.55);
  gunGroup.scale.setScalar(0.62);
  camera.add(gunGroup);
}
const muzzle = new THREE.PointLight(0xffc266, 0, 9, 2);
muzzle.position.set(0.28, -0.2, -1.0); camera.add(muzzle);
const flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffd27a, transparent: true, opacity: 0, depthWrite: false }));
flashSprite.scale.set(0.5, 0.5, 1); flashSprite.position.set(0.28, -0.2, -0.9); camera.add(flashSprite);

// Tracers: a small pool of fading lines.
const tracers = [];
for (let i = 0; i < 24; i++) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffc266, transparent: true, opacity: 0 }));
  line.frustumCulled = false; scene.add(line);
  tracers.push({ line, life: 0 });
}
function spawnTracer(a, b, color = 0xffc266) {
  const t = tracers.find((x) => x.life <= 0) || tracers[0];
  t.line.geometry.attributes.position.setXYZ(0, a.x, a.y, a.z);
  t.line.geometry.attributes.position.setXYZ(1, b.x, b.y, b.z);
  t.line.geometry.attributes.position.needsUpdate = true;
  t.line.material.color.setHex(color); t.line.material.opacity = 0.9; t.life = 0.07;
}
// Impact sparks: tiny pooled point bursts.
const sparks = [];
for (let i = 0; i < 10; i++) {
  const pts = new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(24), 3)),
    new THREE.PointsMaterial({ color: 0xffd27a, size: 0.12, transparent: true, opacity: 0 }),
  );
  pts.frustumCulled = false; scene.add(pts);
  sparks.push({ pts, life: 0, vel: [] });
}
function spawnSparks(p) {
  const s = sparks.find((x) => x.life <= 0) || sparks[0];
  const pos = s.pts.geometry.attributes.position;
  s.vel = [];
  for (let i = 0; i < 8; i++) {
    pos.setXYZ(i, p.x, p.y, p.z);
    s.vel.push(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3));
  }
  pos.needsUpdate = true; s.pts.material.opacity = 1; s.life = 0.3;
}

// ---- helpers ----------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const tmpV = new THREE.Vector3();
function eyePos() { return tmpV.set(player.pos.x, player.pos.y + (player.crouched ? 1.15 : 1.62), player.pos.z); }
function spreadNow(moving, aiming) {
  const w = player.weapon;
  let s = w.spread + player.spreadBloom + (moving ? w.moveSpread : 0);
  if (aiming) s *= 0.45;
  if (player.crouched) s *= 0.7;
  return s;
}
function aliveCount(team) {
  let n = team === 'ember' ? (player.alive ? 1 : 0) : 0;
  for (const b of bots) if (b.team === team && b.alive) n++;
  return n;
}
function allActors() {
  return [player, ...bots];
}
function damageActor(target, amount, isHead, attacker, weaponName) {
  if (!target.alive) return;
  let dealt = amount;
  if (target === player) {
    if (player.armor > 0) { const ab = Math.min(player.armor, dealt * 0.5); player.armor -= ab; dealt -= ab; }
    player.hp -= dealt;
    hud.damageFlash(); sfx.hurt();
    if (player.hp <= 0) { player.alive = false; player.deaths++; onDeath(player, attacker, weaponName); }
  } else {
    target.damage(dealt, isHead);
    if (!target.alive) onDeath(target, attacker, weaponName);
  }
}
function onDeath(victim, killer, weaponName) {
  if (killer) {
    killer.kills++;
    if (killer === player) { player.money += 300; hud.toast(`+ $300 — eliminated ${victim.name}`); }
    if (killer !== player && killer.money !== undefined) killer.money += 300;
  }
  hud.killfeedAdd(killer ? killer.name : '—', victim.name, weaponName || '—', killer ? killer.team : 'ember', victim.team);
  checkRoundEnd();
}
function checkRoundEnd() {
  if (phase !== 'live') return;
  const e = aliveCount('ember'), v = aliveCount('volt');
  if (planted) {
    if (v === 0) endRound('ember', 'VOLT crew wiped — the Igniter will blow.');
    else if (e === 0) { /* defenders must still defuse; fuse decides */ }
    return;
  }
  if (e === 0) endRound('volt', 'EMBER crew eliminated.');
  else if (v === 0) endRound('ember', 'VOLT crew eliminated.');
}
function endRound(winner, reason) {
  if (phase !== 'live') return;
  phase = 'roundEnd'; phaseT = 5;
  if (winner === 'ember') { scoreE++; lossStreak = 0; } else { scoreV++; lossStreak++; }
  const won = winner === 'ember';
  for (const a of allActors()) {
    if (a.team === 'ember') a.money += won ? 3250 : 1900 + Math.min(1000, (lossStreak - 1) * 500);
    else a.money += won ? 1900 : 3250;
  }
  player.money = Math.min(16000, player.money);
  hud.banner(won ? 'ROUND WON' : 'ROUND LOST', reason, 4200);
  if (won) sfx.roundWin(); else sfx.roundLose();
  if (planted) { planted = null; }
  hud.hideInteract();
}
function startBuy() {
  phase = 'buy'; phaseT = BUY_TIME; planted = null;
  // Reset positions and health; survivors keep their loadout, the dead get a pistol.
  const eSpawns = world.spawns.ember, vSpawns = world.spawns.volt;
  player.pos.set(eSpawns[2][0], 0, eSpawns[2][1]); player.yaw = 0; player.pitch = 0;
  player.hp = 100; player.alive = true; player.vel.set(0, 0, 0);
  if (!player.owned.includes('p9')) player.owned = ['p9'];
  if (!player.owned.includes(player.weapon.id)) { player.weapon = WEAPONS.p9; }
  player.mag = player.weapon.mag; player.reserve = player.weapon.reserve;
  player.actionProgress = 0; player.actionKind = null;
  let ei = 0, vi = 0;
  bots.forEach((b) => {
    const spawn = b.team === 'ember' ? eSpawns[ei++ % 5] : vSpawns[vi++ % 5];
    b.reset(spawn, rng);
    // Bots "buy": better guns in later rounds.
    const roll = rng();
    b.weapon = round >= 3 && roll < 0.25 ? WEAPONS.railspike : roll < 0.55 ? WEAPONS.longshot : roll < 0.8 ? WEAPONS.rasp : WEAPONS.breacher;
    b.mag = b.weapon.mag; b.reserve = b.weapon.reserve;
    b.armor = round >= 2 && rng() < 0.5 ? 50 : 0;
    b.targetSite = rng() < 0.5 ? 'A' : 'B';
  });
  hud.showBuy(player.money, phaseT, player.owned, buyItem);
  hud.setObjective(player.team === 'ember'
    ? `You carry the <b>Igniter</b>. Plant it at <b>Site A</b> or <b>Site B</b> — hold <b>E</b> in the zone — or eliminate VOLT.`
    : `Defend <b>Sites A &amp; B</b>. Stop the plant, or defuse it.`);
  hud.banner(`ROUND ${round}`, 'Buy phase — gear up, then fight.', 2200);
}
function startLive() {
  phase = 'live'; phaseT = ROUND_TIME;
  hud.hideBuy();
  hud.banner(`ROUND ${round} — FIGHT`, 'Plant the Igniter or eliminate VOLT.', 1800);
}
function startMatch() {
  round = 1; scoreE = 0; scoreV = 0; lossStreak = 0;
  player.money = 800; player.kills = 0; player.deaths = 0; player.owned = ['p9'];
  player.weapon = WEAPONS.p9; player.armor = 0;
  for (const b of bots) { b.kills = 0; b.deaths = 0; b.money = 800; }
  startBuy();
}
function buyItem(id) {
  if (phase !== 'buy') return;
  if (id === 'armor') {
    if (player.armor >= 50) { sfx.denied(); return; }
    if (player.money < ARMOR_PRICE) { sfx.denied(); hud.toast('Not enough credits.'); return; }
    player.money -= ARMOR_PRICE; player.armor = 50; sfx.buy();
  } else {
    const w = WEAPONS[id];
    if (player.owned.includes(id)) { equipWeapon(id); sfx.buy(); }
    else {
      if (player.money < w.price) { sfx.denied(); hud.toast('Not enough credits.'); return; }
      player.money -= w.price; player.owned.push(id); equipWeapon(id); sfx.buy();
    }
  }
  hud.showBuy(player.money, phaseT, player.owned, buyItem);
  hud.setMoney(player.money);
}
function equipWeapon(id) {
  const w = WEAPONS[id];
  // Keep the old primary's ammo in its slot is overkill; fresh mags on swap.
  player.weapon = w; player.mag = w.mag; player.reserve = w.reserve;
  player.reloading = false;
  hud.setWeapon(w.name); hud.setAmmo(player.mag, player.reserve, false);
}

// ---- shooting -----------------------------------------------------------------
function fireShot(shooter, origin, dir, weapon, isPlayerShot) {
  // One hitscan pellet: wall distance first, then the nearest bot in the way.
  const ox = origin.x, oy = origin.y, oz = origin.z;
  const dxz = Math.hypot(dir.x, dir.z) || 1;
  const wallDist = rayWallDist(ox, oz, dir.x / dxz, dir.z / dxz, weapon.range, world.colliders);
  raycaster.set(origin, dir);
  raycaster.far = Math.min(weapon.range, wallDist);
  const hits = raycaster.intersectObjects(botMeshes, false);
  let end = new THREE.Vector3().copy(origin).addScaledVector(dir, Math.min(weapon.range, wallDist));
  if (hits.length) {
    const h = hits[0];
    const bot = h.object.userData.bot;
    const isHead = h.object.userData.part === 'head';
    const dist = h.distance;
    const falloff = Math.max(0.45, 1 - dist / (weapon.range * 1.6));
    const dmg = weapon.damage * (isHead ? weapon.headMult : 1) * falloff;
    end = h.point.clone();
    spawnSparks(h.point);
    if (shooter === player) {
      damageActor(bot, dmg, isHead, player, weapon.name);
      hud.hitMarker(!bot.alive);
      sfx.hit(!bot.alive);
    } else if (bot === player) { /* player is never in botMeshes */ }
    else damageActor(bot, dmg, isHead, shooter, weapon.name);
  } else if (wallDist < weapon.range) {
    spawnSparks(end);
  }
  spawnTracer(origin, end, weapon.tracer);
  return hits.length ? hits[0] : null;
}
function playerShoot() {
  const w = player.weapon;
  const now = elapsed;
  if (now < player.nextShotAt || player.reloading || phase !== 'live') return;
  if (player.mag <= 0) { sfx.dryClick(); player.nextShotAt = now + 0.3; startReload(); return; }
  player.nextShotAt = now + w.interval / 1000;
  player.mag--;
  const moving = player.vel.lengthSq() > 0.5;
  const spread = spreadNow(moving, input.state.aiming);
  const origin = eyePos().clone();
  const pellets = w.pellets || 1;
  for (let p = 0; p < pellets; p++) {
    const dir = new THREE.Vector3(
      (Math.random() - 0.5) * 2 * spread,
      (Math.random() - 0.5) * 2 * spread,
      -1,
    ).applyEuler(camera.rotation).normalize();
    fireShot(player, origin, dir, w, true);
  }
  player.spreadBloom = Math.min(0.03, player.spreadBloom + w.bloom);
  player.pitch += w.kick * (input.state.aiming ? 0.5 : 1);
  gunGroup.position.z = -0.55 + 0.07;
  muzzle.intensity = 26; flashSprite.material.opacity = 0.95;
  sfx.shot(w.id);
  hud.setAmmo(player.mag, player.reserve, false);
  if (player.mag === 0) startReload();
}
function startReload() {
  const w = player.weapon;
  if (player.reloading || player.reserve <= 0 || player.mag === w.mag) return;
  player.reloading = true; player.reloadEndAt = elapsed + w.reloadMs / 1000;
  sfx.reload(); hud.setAmmo(player.mag, player.reserve, true);
}
function botShoot(bot, enemy, dist) {
  // Bots aim at the enemy's chest with error that grows with distance and shrinks
  // when the target stands still; their shots can hit the player or another bot.
  const w = bot.weapon;
  const origin = bot.eyePos(new THREE.Vector3());
  const targetPos = enemy === player
    ? new THREE.Vector3(player.pos.x, player.pos.y + 1.3, player.pos.z)
    : new THREE.Vector3(enemy.pos.x, enemy.pos.y + 1.25, enemy.pos.z);
  const err = 0.55 + dist * 0.035;
  targetPos.x += (bot.rng() - 0.5) * err * 2;
  targetPos.y += (bot.rng() - 0.5) * err;
  targetPos.z += (bot.rng() - 0.5) * err * 2;
  const dir = targetPos.clone().sub(origin).normalize();
  const pellets = w.pellets || 1;
  let hitPlayer = false;
  for (let p = 0; p < pellets; p++) {
    const d2 = dir.clone();
    d2.x += (bot.rng() - 0.5) * 0.06; d2.y += (bot.rng() - 0.5) * 0.06; d2.z += (bot.rng() - 0.5) * 0.06;
    d2.normalize();
    // Wall check for the player shot path.
    const dxz = Math.hypot(d2.x, d2.z) || 1;
    const wallDist = rayWallDist(origin.x, origin.z, d2.x / dxz, d2.z / dxz, w.range, world.colliders);
    // Player hit test: closest approach of the ray to the player capsule.
    if (enemy === player && player.alive) {
      const toP = new THREE.Vector3(player.pos.x - origin.x, 0, player.pos.z - origin.z);
      const along = toP.dot(new THREE.Vector3(d2.x, 0, d2.z));
      const perp = Math.hypot(toP.x - d2.x * along, toP.z - d2.z * along);
      const eyeY = player.pos.y + 1.3;
      const dy = Math.abs((origin.y + d2.y * along) - eyeY);
      if (along > 0 && along < wallDist && along < w.range && perp < 0.55 && dy < 0.9) {
        const falloff = Math.max(0.45, 1 - along / (w.range * 1.6));
        damageActor(player, w.damage * falloff, false, bot, w.name);
        hitPlayer = true;
      }
    }
    const hit = fireShot(bot, origin, d2, w, false);
    void hit;
  }
  spawnTracer(origin, origin.clone().addScaledVector(dir, Math.min(30, dist + 4)), w.tracer);
  muzzleFlashAt(bot);
  sfx.shot(w.id, true);
  void hitPlayer;
}
const botMuzzles = new Map();
function muzzleFlashAt(bot) {
  let m = botMuzzles.get(bot);
  if (!m) {
    m = new THREE.PointLight(0xffc266, 0, 8, 2);
    scene.add(m); botMuzzles.set(bot, m);
  }
  const p = bot.eyePos(new THREE.Vector3());
  p.add(new THREE.Vector3(Math.sin(bot.yaw) * 0.7, -0.25, Math.cos(bot.yaw) * 0.7));
  m.position.copy(p); m.intensity = 14;
  setTimeout(() => { m.intensity = 0; }, 60);
}

// ---- plant / defuse -------------------------------------------------------------
function playerAction(dt) {
  player.actionProgress = 0; player.actionKind = null;
  if (phase !== 'live' || !player.alive) { hud.hideInteract(); return; }
  const keys = input.state.keys;
  const want = keys.has('KeyE');
  if (!want) { hud.hideInteract(); return; }
  if (!planted) {
    for (const [key, s] of Object.entries(world.sites)) {
      if (Math.hypot(s.x - player.pos.x, s.z - player.pos.z) < s.r) {
        player.actionKind = 'plant'; player.actionProgress += dt / 3;
        hud.showInteract(`Planting Igniter at Site ${key} — hold E`, Math.min(1, player.actionProgress));
        if (player.actionProgress >= 1) {
          planted = { site: key, timer: PLANT_TIME };
          player.money += 300; player.actionProgress = 0; player.actionKind = null;
          sfx.plantDone(); hud.toast('Igniter planted! Defend it.');
          hud.setObjective(`Igniter planted at <b>Site ${key}</b> — <b>${PLANT_TIME}s</b> to detonation. Hold the site!`);
        }
        return;
      }
    }
  } else {
    const s = world.sites[planted.site];
    if (Math.hypot(s.x - player.pos.x, s.z - player.pos.z) < s.r) {
      player.actionKind = 'defuse'; player.actionProgress += dt / 5;
      hud.showInteract('Defusing Igniter — hold E', Math.min(1, player.actionProgress));
      if (player.actionProgress >= 1) {
        planted = null; player.actionProgress = 0; player.actionKind = null;
        sfx.plantDone();
        endRound('volt', 'Igniter defused — VOLT holds the yard.');
      }
      return;
    }
  }
  hud.hideInteract();
}

// ---- bot context ------------------------------------------------------------------
const botCtx = {
  world, sites: world.sites, get planted() { return planted; }, get phase() { return phase; },
  enemies: null, player,
  botShoot,
  onPlant(bot, site) {
    if (planted || phase !== 'live') return;
    planted = { site, timer: PLANT_TIME };
    bot.money += 300;
    sfx.plantDone();
    hud.toast(`Igniter planted at Site ${site} by ${bot.name}!`);
    hud.setObjective(`Igniter planted at <b>Site ${site}</b> — defuse it! Hold <b>E</b> in the zone.`);
    hud.banner('IGNITER PLANTED', `Site ${site} — ${PLANT_TIME}s to detonation.`, 3000);
  },
  onDefuse(bot) {
    if (!planted) return;
    planted = null;
    hud.toast(`${bot.name} defused the Igniter.`);
    endRound('volt', 'Igniter defused — VOLT holds the yard.');
  },
};

// ---- input wiring -------------------------------------------------------------------
hud.onPlay(() => {
  sfx.unlock();
  hud.hideOverlay();
  if (phase === 'menu' || phase === 'matchEnd') startMatch();
  else input.requestLock();
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---- per-frame update -----------------------------------------------------------------
const clock = new THREE.Clock();
let stepAcc = 0;
let beepAcc = 0;
let menuAngle = 0;

function updatePlayer(dt) {
  const keys = input.state.keys;
  const look = input.takeLook();
  player.yaw -= look.x * 0.0022 * (input.state.aiming ? 0.55 : 1);
  player.pitch -= look.y * 0.0022 * (input.state.aiming ? 0.55 : 1);
  player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch));

  const crouch = keys.has('ControlLeft') || keys.has('ControlRight');
  player.crouched = crouch && player.onGround;
  let speed = 5.4;
  if (keys.has('ShiftLeft') || keys.has('ShiftRight')) speed = 3.1;
  if (player.crouched) speed = 2.6;
  if (input.state.aiming) speed *= 0.6;

  const fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
  const mx = (-sin * fwd + cos * strafe);
  const mz = (-cos * fwd - sin * strafe);
  const ml = Math.hypot(mx, mz) || 1;
  const accel = player.onGround ? 14 : 4;
  player.vel.x += (mx / ml) * speed * accel * dt * (fwd || strafe ? 1 : 0);
  player.vel.z += (mz / ml) * speed * accel * dt * (fwd || strafe ? 1 : 0);
  // Friction.
  const fr = player.onGround ? Math.max(0, 1 - 10 * dt) : Math.max(0, 1 - 0.4 * dt);
  if (!fwd && !strafe) { player.vel.x *= fr; player.vel.z *= fr; }
  const hs = Math.hypot(player.vel.x, player.vel.z);
  const maxSp = speed * 1.05;
  if (hs > maxSp) { player.vel.x *= maxSp / hs; player.vel.z *= maxSp / hs; }

  // Gravity + jump.
  player.vel.y -= 22 * dt;
  if (keys.has('Space') && player.onGround) { player.vel.y = 7.6; player.onGround = false; }
  player.pos.x += player.vel.x * dt;
  player.pos.z += player.vel.z * dt;
  player.pos.y += player.vel.y * dt;
  if (player.pos.y <= 0) { player.pos.y = 0; player.vel.y = 0; player.onGround = true; }
  resolveCircle(player.pos, 0.45, world.colliders);

  // Footsteps.
  if (hs > 2 && player.onGround) {
    stepAcc += dt * hs;
    if (stepAcc > 3.4) { stepAcc = 0; sfx.step(); }
  }
  // Spread bloom decay.
  player.spreadBloom = Math.max(0, player.spreadBloom - dt * 0.02);
  // Reload finish.
  if (player.reloading && elapsed >= player.reloadEndAt) {
    const w = player.weapon;
    const need = w.mag - player.mag;
    const take = Math.min(need, player.reserve);
    player.mag += take; player.reserve -= take;
    player.reloading = false;
    hud.setAmmo(player.mag, player.reserve, false);
  }
  // Firing.
  if (input.state.firing) {
    if (player.weapon.auto) playerShoot();
    else if (!player._semiLatch) { playerShoot(); player._semiLatch = true; }
  } else player._semiLatch = false;
  // Aim FOV.
  const targetFov = input.state.aiming && player.weapon.scoped ? 30 : input.state.aiming ? 62 : 78;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
  camera.updateProjectionMatrix();
  gunGroup.visible = !(input.state.aiming && player.weapon.scoped);
}

function updateCamera(dt) {
  if (!player.alive && phase === 'live') {
    // Spectate a living EMBER bot from behind.
    const allies = bots.filter((b) => b.team === 'ember' && b.alive);
    if (allies.length) {
      const b = allies[player.spectateIdx % allies.length];
      const back = 4.2, up = 2.6;
      camera.position.set(
        b.pos.x - Math.sin(b.yaw) * back,
        up,
        b.pos.z - Math.cos(b.yaw) * back,
      );
      camera.lookAt(b.pos.x, 1.4, b.pos.z);
      return;
    }
  }
  const eyeH = player.crouched ? 1.15 : 1.62;
  // Head bob.
  const hs = Math.hypot(player.vel.x, player.vel.z);
  const bob = player.onGround && hs > 1 ? Math.sin(elapsed * 11) * 0.035 * Math.min(1, hs / 5) : 0;
  camera.position.set(player.pos.x, player.pos.y + eyeH + bob, player.pos.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
  // View-model recoil recovery.
  gunGroup.position.z += (-0.55 - gunGroup.position.z) * Math.min(1, dt * 14);
  gunGroup.position.y = -0.26 + bob * 0.4;
  gunGroup.position.x = 0.3 + Math.sin(elapsed * 5.5) * 0.004 * Math.min(1, hs / 5);
  muzzle.intensity = Math.max(0, muzzle.intensity - dt * 260);
  flashSprite.material.opacity = Math.max(0, flashSprite.material.opacity - dt * 9);
}

function updateHud() {
  hud.setHealth(player.hp, player.armor);
  hud.setMoney(player.money);
  hud.setScores(scoreE, scoreV, round, ROUND_TARGET);
  hud.setAlive(aliveCount('ember'), aliveCount('volt'));
  hud.setTimer(phaseT, phase === 'live' && planted ? 'planted' : phase);
  const moving = Math.hypot(player.vel.x, player.vel.z) > 0.5;
  hud.setSpread(6 + spreadNow(moving, input.state.aiming) * 900);
  const actors = allActors();
  hud.drawMinimap(world, actors, player.pos, player.yaw, planted ? planted.site : null);
  const st = `phase=${phase} score=${scoreE}-${scoreV} round=${round} aliveE=${aliveCount('ember')} aliveV=${aliveCount('volt')} planted=${planted ? planted.site + ':' + Math.ceil(planted.timer) : '-'} errors=${window.__errors.length}`;
  if (statusEl.textContent !== st) statusEl.textContent = st;
}

function tick(dt) {
  elapsed += dt;
  // Phase timers.
  if (phase === 'buy') {
    phaseT -= dt;
    hud.setTimer(Math.max(0, phaseT), 'buy');
    if (phaseT <= 0) startLive();
  } else if (phase === 'live') {
    phaseT -= dt;
    if (planted) {
      planted.timer -= dt;
      beepAcc += dt;
      const interval = planted.timer < 10 ? 0.5 : planted.timer < 20 ? 0.8 : 1.2;
      if (beepAcc > interval) { beepAcc = 0; sfx.plantBeep(planted.timer < 10); }
      if (planted.timer <= 0) {
        sfx.explode();
        hud.banner('IGNITER DETONATED', 'Site ' + planted.site + ' is gone.', 4000);
        planted = null;
        endRound('ember', 'Igniter detonated.');
      }
    }
    if (phase === 'live' && phaseT <= 0 && !planted) endRound('volt', 'Time expired — VOLT holds the yard.');
  } else if (phase === 'roundEnd') {
    phaseT -= dt;
    if (phaseT <= 0) {
      if (scoreE >= ROUND_TARGET || scoreV >= ROUND_TARGET || round >= 9) {
        phase = 'matchEnd';
        hud.showOverlay('end', { e: scoreE, v: scoreV });
        if (scoreE > scoreV) sfx.roundWin(); else sfx.roundLose();
      } else { round++; startBuy(); }
    }
  }

  if (phase === 'live' || phase === 'buy') {
    if (player.alive) updatePlayer(dt);
    playerAction(dt);
    for (const b of bots) {
      botCtx.enemies = b.team === 'ember'
        ? [...bots.filter((x) => x.team === 'volt'), player].filter((x) => x !== b)
        : [...bots.filter((x) => x.team === 'ember'), player].filter((x) => x !== b);
      // Player counts as an enemy for volt bots; for ember bots the player is an ally.
      if (b.team === 'ember') botCtx.enemies = bots.filter((x) => x.team === 'volt');
      b.update(dt, elapsed, botCtx);
    }
  }
  updateCamera(dt);
  updateHud();
  // Tracers / sparks decay.
  for (const t of tracers) if (t.life > 0) { t.life -= dt; t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.9; }
  for (const s of sparks) {
    if (s.life > 0) {
      s.life -= dt;
      const pos = s.pts.geometry.attributes.position;
      for (let i = 0; i < 8; i++) {
        pos.setXYZ(i, pos.getX(i) + s.vel[i].x * dt, Math.max(0.02, pos.getY(i) + s.vel[i].y * dt), pos.getZ(i) + s.vel[i].z * dt);
        s.vel[i].y -= 9 * dt;
      }
      pos.needsUpdate = true; s.pts.material.opacity = Math.max(0, s.life / 0.3);
    }
  }
  // Beacon blink.
  const blink = (Math.sin(elapsed * 2.4) > 0) ? 1 : 0.15;
  for (const b of world.beacons) b.material.opacity = blink;
  // Site beam pulse when planted.
  if (planted) {
    const s = world.sites[planted.site];
    s.beam.material.opacity = 0.16 + 0.12 * Math.sin(elapsed * 6);
    s.light.intensity = 8 + 6 * Math.sin(elapsed * 6);
  }
}

function handlePressed() {
  for (const code of input.takePressed()) {
    if (code === 'KeyR') startReload();
    if (code === 'KeyB' && phase === 'buy') {
      if (document.getElementById('buy-overlay').hidden) hud.showBuy(player.money, phaseT, player.owned, buyItem);
      else hud.hideBuy();
    }
    if (code === 'Escape' && phase === 'buy') hud.hideBuy();
    if (code === 'KeyQ' && phase !== 'menu') {
      const idx = player.owned.indexOf(player.weapon.id);
      equipWeapon(player.owned[(idx + 1) % player.owned.length]);
    }
    if (code === 'Tab') {
      const rows = allActors().map((a) => ({ name: a.name, team: a.team, kills: a.kills, deaths: a.deaths, money: a.money, alive: a.alive, isPlayer: a.isPlayer }));
      rows.sort((a, b) => b.kills - a.kills);
      hud.showScore(rows, `EMBER ${scoreE} — ${scoreV} VOLT · Round ${round} · First to ${ROUND_TARGET}`);
    }
    if (phase === 'buy') {
      const shopIdx = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(code);
      if (shopIdx >= 0) {
        const id = [...SHOP_ORDER, 'armor'][shopIdx];
        if (id) buyItem(id);
      }
    }
    if (code === 'Tab') { /* shown above; hide on keyup handled below */ }
  }
  if (!input.state.keys.has('Tab')) hud.hideScore();
}

// ---- shot staging -------------------------------------------------------------------
function stageShot() {
  if (!SHOT) return;
  if (SHOT === 'start') {
    // Menu overlay over a slow orbit of the yard; stage the crews at their spawns.
    let ei = 0, vi = 0;
    for (const b of bots) {
      const s = b.team === 'ember' ? world.spawns.ember[ei++ % 5] : world.spawns.volt[vi++ % 5];
      b.pos.set(s[0], 0, s[1]); b.group.position.copy(b.pos);
      b.yaw = b.team === 'ember' ? Math.PI : 0; b.group.rotation.y = b.yaw;
    }
    camera.position.set(26, 15, 26);
    camera.lookAt(0, 1, 0);
    hud.showOverlay('start');
    setTimeout(() => { shotFrozen = true; window.__shotReady = true; }, 2600);
  } else if (SHOT === 'buy') {
    hud.hideOverlay();
    startMatch();
    player.money = 3200;
    hud.showBuy(player.money, phaseT, player.owned, buyItem);
    setTimeout(() => { shotFrozen = true; window.__shotReady = true; }, 1800);
  } else if (SHOT === 'play') {
    hud.hideOverlay();
    startMatch();
    startLive();
    phaseT = 83;
    equipWeapon('longshot');
    player.money = 3200;
    player.pos.set(-6, 0, 13); player.yaw = -0.1;
    // Stage a fight: two VOLT bots in view through the hall gaps, one EMBER ally beside you.
    const volt = bots.filter((b) => b.team === 'volt');
    volt[0].pos.set(-4, 0, -1); volt[0].yaw = Math.PI; volt[0].group.position.copy(volt[0].pos); volt[0].group.rotation.y = volt[0].yaw;
    volt[1].pos.set(6, 0, -6); volt[1].yaw = Math.PI - 0.4; volt[1].group.position.copy(volt[1].pos); volt[1].group.rotation.y = volt[1].yaw;
    volt[1].hp = 42; volt[1].nameDraw(42);
    const ally = bots.find((b) => b.team === 'ember');
    ally.pos.set(-1, 0, 9); ally.group.position.copy(ally.pos);
    hud.killfeedAdd('Ash', 'Surge', 'LONGSHOT AR', 'ember', 'volt');
    hud.setObjective('You carry the <b>Igniter</b>. Plant it at <b>Site A</b> or <b>Site B</b> — hold <b>E</b> in the zone.');
    setTimeout(() => { if (!NOFREEZE) { shotFrozen = true; window.__shotReady = true; } }, 3000);
  } else if (SHOT === 'end') {
    hud.hideOverlay();
    startMatch();
    startLive();
    scoreE = 3; scoreV = 2; round = 6;
    endRound('ember', 'Site A secured — VOLT crew eliminated.');
    player.pos.set(-20, 0, -6); player.yaw = 0.62;
    setTimeout(() => { shotFrozen = true; window.__shotReady = true; }, 1800);
    // Re-show the banner just before capture: virtual time would have expired
    // its original timer by then, and the sim is frozen so nothing hides it again.
    setTimeout(() => {
      document.getElementById('banner-title').textContent = 'ROUND WON';
      document.getElementById('banner-sub').textContent = 'Site A secured — VOLT crew eliminated.';
      document.getElementById('banner').hidden = false;
    }, 11000);
  }
}

// ---- main loop ------------------------------------------------------------------------
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  if (SHOT === 'start' && !shotFrozen) {
    menuAngle += dt * 0.08;
    camera.position.set(Math.sin(menuAngle) * 26, 20, Math.cos(menuAngle) * 26);
    camera.lookAt(0, 1, 0);
    for (const b of bots) b.group.visible = true;
    renderer.render(scene, camera);
    return;
  }
  if (!shotFrozen) {
    handlePressed();
    tick(dt);
  }
  renderer.render(scene, camera);
  if (!window.__firstFrame) { window.__firstFrame = true; statusEl.textContent = 'ready'; }
}

hud.setHealth(100, 0);
hud.setAmmo(player.mag, player.reserve, false);
hud.setMoney(800);
hud.setWeapon('P9 Sidearm');
hud.setObjective('Click to play — then plant the Igniter or eliminate VOLT.');
hud.showOverlay('start');
stageShot();
window.__game = {
  get phase() { return phase; },
  get scores() { return [scoreE, scoreV]; },
  get round() { return round; },
  get planted() { return planted; },
  player, bots,
};
requestAnimationFrame(frame);
