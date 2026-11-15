// Bots. Each bot is a low-poly crew member: torso, head, visor, gun and a floating
// name + health bar sprite. The AI is a small state machine: push along the waypoint
// graph toward its objective, fight when it sees an enemy, plant the Igniter if it is
// an attacker in a site, defuse if it is a defender and the Igniter is live.
import * as THREE from 'three';
import { hasLOS, nearestWaypoint, findPath, resolveCircle } from './world.js';
import { WEAPONS } from './weapons.js';

const NAMES = {
  ember: ['Ash', 'Cinder', 'Flint', 'Soot'],
  volt: ['Surge', 'Amp', 'Relay', 'Fuse'],
};
const COLORS = { ember: 0xff7a1a, volt: 0x19c2d8 };

function nameSprite(name, team) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(3.2, 0.8, 1);
  const draw = (hp) => {
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 256, 64);
    ctx.font = 'bold 26px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = team === 'ember' ? '#ffb37a' : '#8fe3f0';
    ctx.fillText(name, 128, 26);
    ctx.fillStyle = '#22262c'; ctx.fillRect(53, 38, 150, 10);
    ctx.fillStyle = hp > 50 ? '#7dd069' : hp > 25 ? '#f0b429' : '#ff4d4d';
    ctx.fillRect(53, 38, 150 * Math.max(0, hp) / 100, 10);
    tex.needsUpdate = true;
  };
  draw(100);
  return { sprite, draw };
}

export class Bot {
  constructor(scene, team, name, spawn, rng) {
    this.team = team; this.name = name; this.rng = rng;
    this.pos = new THREE.Vector3(spawn[0], 0, spawn[1]);
    this.yaw = team === 'ember' ? Math.PI : 0;
    this.hp = 100; this.armor = 0; this.alive = true;
    this.kills = 0; this.deaths = 0; this.money = 800;
    this.weapon = WEAPONS.longshot;
    this.mag = this.weapon.mag; this.reserve = this.weapon.reserve;
    this.state = 'push'; this.path = []; this.pathIdx = 0;
    this.targetSite = rng() < 0.5 ? 'A' : 'B';
    this.reactAt = 0; this.nextShotAt = 0; this.burstLeft = 0;
    this.strafeDir = 1; this.strafeUntil = 0; this.repathAt = 0;
    this.actionProgress = 0; this.actionKind = null;
    this.spreadBloom = 0; this.lastShotAt = -10;
    this.group = new THREE.Group();
    const color = COLORS[team];
    const suit = new THREE.MeshStandardMaterial({ color: 0x2a2e35, roughness: 0.85 });
    const accent = new THREE.MeshStandardMaterial({ color, roughness: 0.6, emissive: color, emissiveIntensity: 0.25 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.85, 0.36), suit);
    body.position.y = 1.05; this.group.add(body);
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.4, 0.4), accent);
    vest.position.y = 1.15; this.group.add(vest);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.36), suit);
    head.position.y = 1.72; this.group.add(head);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.06), accent);
    visor.position.set(0, 1.74, 0.19); this.group.add(visor);
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.62, 0.26), suit);
    legL.position.set(-0.16, 0.31, 0); this.group.add(legL);
    const legR = legL.clone(); legR.position.x = 0.16; this.group.add(legR);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.85), new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.4, metalness: 0.7 }));
    gun.position.set(0.28, 1.28, 0.3); this.group.add(gun);
    this.bodyMesh = body; this.headMesh = head;
    body.userData.bot = this; body.userData.part = 'body';
    head.userData.bot = this; head.userData.part = 'head';
    const { sprite, draw } = nameSprite(name, team);
    sprite.position.y = 2.25; this.group.add(sprite);
    this.nameDraw = draw;
    this.group.position.copy(this.pos);
    scene.add(this.group);
  }

  reset(spawn, rng) {
    this.pos.set(spawn[0], 0, spawn[1]);
    this.yaw = this.team === 'ember' ? Math.PI : 0;
    this.hp = 100; this.alive = true; this.state = 'push';
    this.weapon = WEAPONS.longshot; this.mag = this.weapon.mag; this.reserve = this.weapon.reserve;
    this.targetSite = rng() < 0.5 ? 'A' : 'B';
    this.path = []; this.actionProgress = 0; this.actionKind = null;
    this.group.visible = true; this.group.rotation.set(0, 0, 0);
    this.group.position.copy(this.pos); this.nameDraw(100);
  }

  damage(amount, isHead) {
    if (!this.alive) return 0;
    let dmg = amount;
    if (this.armor > 0) { const absorbed = Math.min(this.armor, dmg * 0.5); this.armor -= absorbed; dmg -= absorbed; }
    this.hp -= dmg;
    this.nameDraw(Math.max(0, this.hp));
    if (this.hp <= 0) { this.alive = false; this.deaths++; this.group.rotation.z = Math.PI / 2; this.group.position.y = 0.35; }
    return dmg;
  }

  eyePos(out) { return out.set(this.pos.x, 1.62, this.pos.z); }

  nearestEnemy(enemies) {
    let best = null, bd = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = (e.pos.x - this.pos.x) ** 2 + (e.pos.z - this.pos.z) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  canSee(enemy, colliders) {
    const d = Math.hypot(enemy.pos.x - this.pos.x, enemy.pos.z - this.pos.z);
    if (d > 48) return false;
    return hasLOS(this.pos.x, this.pos.z, enemy.pos.x, enemy.pos.z, colliders);
  }

  setPathTo(wp, x, z) {
    const from = nearestWaypoint(wp, this.pos.x, this.pos.z);
    const to = nearestWaypoint(wp, x, z);
    this.path = findPath(wp, from, to);
    this.pathIdx = 0;
  }

  update(dt, t, ctx) {
    if (!this.alive) return;
    const { world, enemies, player, sites, planted, phase } = ctx;
    const colliders = world.colliders;
    const enemy = this.nearestEnemy(enemies);
    const sees = enemy && this.canSee(enemy, colliders);
    const dist = enemy ? Math.hypot(enemy.pos.x - this.pos.x, enemy.pos.z - this.pos.z) : Infinity;

    // Objective overrides: plant / defuse when in the right place.
    if (phase === 'live') {
      if (this.team === 'ember' && !planted) {
        const s = sites[this.targetSite];
        if (Math.hypot(s.x - this.pos.x, s.z - this.pos.z) < s.r - 0.4 && !sees) {
          this.actionKind = 'plant'; this.actionProgress += dt / 3;
          if (this.actionProgress >= 1) { ctx.onPlant(this, this.targetSite); this.actionProgress = 0; this.actionKind = null; }
          this.face(s.x, s.z); this.group.position.copy(this.pos); this.group.rotation.y = this.yaw;
          return;
        }
      }
      if (this.team === 'volt' && planted) {
        const s = sites[planted.site];
        if (Math.hypot(s.x - this.pos.x, s.z - this.pos.z) < s.r - 0.4 && !sees) {
          this.actionKind = 'defuse'; this.actionProgress += dt / 5;
          if (this.actionProgress >= 1) { ctx.onDefuse(this); this.actionProgress = 0; this.actionKind = null; }
          this.face(s.x, s.z); this.group.position.copy(this.pos); this.group.rotation.y = this.yaw;
          return;
        }
      }
    }
    this.actionKind = null; this.actionProgress = 0;

    // Combat: face the enemy, strafe, fire in bursts with reaction time and error.
    if (sees && phase === 'live') {
      this.face(enemy.pos.x, enemy.pos.z);
      if (this.reactAt === 0) this.reactAt = t + 0.35 + this.rng() * 0.45;
      if (t >= this.reactAt) {
        if (t > this.strafeUntil) { this.strafeDir = this.rng() < 0.5 ? -1 : 1; this.strafeUntil = t + 0.5 + this.rng() * 0.8; }
        const side = Math.cos(this.yaw) * this.strafeDir;
        const fwd = Math.sin(this.yaw) * this.strafeDir;
        const strafeSpeed = dist < 8 ? 2.6 : 1.4;
        this.pos.x += side * strafeSpeed * dt * 0.4;
        this.pos.z += fwd * strafeSpeed * dt * 0.4;
        if (this.burstLeft <= 0 && t >= this.nextShotAt) this.burstLeft = 3 + Math.floor(this.rng() * 4);
        if (this.burstLeft > 0 && t >= this.nextShotAt) {
          this.nextShotAt = t + this.weapon.interval / 1000;
          this.burstLeft--;
          if (this.mag > 0) { this.mag--; this.lastShotAt = t; ctx.botShoot(this, enemy, dist); }
          else { this.mag = this.weapon.mag; this.reserve = Math.max(0, this.reserve - this.weapon.mag); this.nextShotAt = t + 1.6; }
        }
      }
      resolveCircle(this.pos, 0.45, colliders);
      this.group.position.copy(this.pos); this.group.rotation.y = this.yaw;
      return;
    }
    this.reactAt = 0; this.burstLeft = 0;

    // Push: pick a destination and walk the waypoint graph.
    if (phase === 'live' || phase === 'buy') {
      let dest = null;
      if (this.team === 'ember') dest = planted ? null : sites[this.targetSite];
      else dest = planted ? sites[planted.site] : (this.rng() < 0.001 ? null : null);
      if (this.team === 'volt' && !planted) {
        // Defenders hold near their assigned site, shuffling between nearby nodes.
        const s = sites[this.targetSite];
        dest = { x: s.x + (this.rng() - 0.5) * 6, z: s.z + 5 + this.rng() * 4 };
        if (t > this.repathAt) { this.repathAt = t + 6 + this.rng() * 6; this.setPathTo(world.waypoints, dest.x, dest.z); }
      } else if (dest && t > this.repathAt) {
        this.repathAt = t + 1.2; this.setPathTo(world.waypoints, dest.x, dest.z);
      }
      if (this.path.length) {
        const node = world.waypoints[this.path[this.pathIdx]];
        const dx = node.x - this.pos.x, dz = node.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.6) { this.pathIdx = Math.min(this.pathIdx + 1, this.path.length - 1); }
        else {
          const speed = 4.6;
          this.pos.x += (dx / d) * speed * dt; this.pos.z += (dz / d) * speed * dt;
          this.face(this.pos.x + dx, this.pos.z + dz);
        }
        resolveCircle(this.pos, 0.45, colliders);
      }
    }
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
  }

  face(x, z) {
    const target = Math.atan2(x - this.pos.x, z - this.pos.z);
    let diff = target - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += diff * 0.25;
  }
}

export function makeBots(scene, rng) {
  const bots = [];
  for (const team of ['ember', 'volt']) {
    NAMES[team].forEach((name, i) => {
      bots.push(new Bot(scene, team, name, [0, 0], rng));
    });
  }
  return bots;
}
