// The DOM HUD: crosshair, hit marker, health/ammo/money, round timer, team scores,
// minimap, kill feed, objective line, buy shop, scoreboard and the overlay panels.
// It never touches the simulation; main.js pushes numbers in and reads callbacks out.
import { WEAPONS, SHOP_ORDER, ARMOR_PRICE } from './weapons.js';

const $ = (id) => document.getElementById(id);

export function createHud() {
  const el = {
    overlay: $('overlay'), title: $('overlay-title'), copy: $('overlay-copy'), play: $('play'),
    buyOverlay: $('buy-overlay'), buyMoney: $('buy-money'), buyTimer: $('buy-timer'), shopGrid: $('shop-grid'),
    scoreOverlay: $('score-overlay'), scoreSub: $('score-sub'), scoreRows: $('score-rows'),
    hpNum: $('hp-num'), hpFill: $('hp-fill'), armorNum: $('armor-num'),
    money: $('money'), weaponName: $('weapon-name'),
    ammo: $('ammo'), ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'), reloadHint: $('reload-hint'),
    timer: $('round-timer'), roundLabel: $('round-label'),
    scoreEmber: $('score-ember'), scoreVolt: $('score-volt'),
    pipsEmber: $('alive-pips-ember'), pipsVolt: $('alive-pips-volt'),
    crosshair: $('crosshair'), hitmarker: $('hitmarker'), vignette: $('dmg-vignette'),
    killfeed: $('killfeed'), objective: $('objective'), minimap: $('minimap'),
    interact: $('interact'), interactText: $('interact-text'), interactFill: $('interact-fill'),
    banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    toast: $('toast'),
  };
  const mm = el.minimap.getContext('2d');
  let hitTimer = 0, toastTimer = 0, bannerTimer = 0;
  let last = {};

  function setText(node, key, value) {
    if (last[key] === value) return; last[key] = value; node.textContent = value;
  }

  return {
    setHealth(hp, armor) {
      setText(el.hpNum, 'hp', String(Math.max(0, Math.ceil(hp))));
      el.hpFill.style.width = `${Math.max(0, hp)}%`;
      el.hpFill.style.background = hp > 50 ? '#7dd069' : hp > 25 ? '#f0b429' : '#ff4d4d';
      setText(el.armorNum, 'armor', String(armor));
    },
    setAmmo(mag, reserve, reloading) {
      setText(el.ammoMag, 'mag', String(mag));
      setText(el.ammoReserve, 'res', ` / ${reserve}`);
      el.ammo.classList.toggle('empty', mag === 0);
      setText(el.reloadHint, 'reload', reloading ? 'RELOADING…' : mag === 0 ? 'Press R to reload' : '');
    },
    setMoney(v) { setText(el.money, 'money', `$${v}`); },
    setWeapon(name) { setText(el.weaponName, 'wpn', name); },
    setTimer(sec, phase) {
      const s = Math.max(0, Math.ceil(sec));
      setText(el.timer, 'timer', `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
      el.timer.classList.toggle('low', s <= 10 && phase === 'live');
      if (!el.buyOverlay.hidden) setText(el.buyTimer, 'btimer', `${s}s left`);
    },
    setScores(e, v, round, target) {
      setText(el.scoreEmber, 'se', String(e)); setText(el.scoreVolt, 'sv', String(v));
      setText(el.roundLabel, 'rnum', `ROUND ${round} · FIRST TO ${target}`);
    },
    setAlive(emberAlive, voltAlive) {
      const key = `a${emberAlive}${voltAlive}`;
      if (last.alive === key) return; last.alive = key;
      el.pipsEmber.innerHTML = Array.from({ length: 5 }, (_, i) => `<i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${i < emberAlive ? '#ff7a1a' : '#3a3f46'}"></i>`).join('');
      el.pipsVolt.innerHTML = Array.from({ length: 5 }, (_, i) => `<i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${i < voltAlive ? '#19c2d8' : '#3a3f46'}"></i>`).join('');
    },
    setObjective(html) { if (last.obj !== html) { last.obj = html; el.objective.innerHTML = html; } },
    setSpread(px) {
      const g = Math.max(3, Math.min(16, px));
      el.crosshair.style.setProperty('--gap', `${g}px`);
      el.crosshair.querySelector('.t').style.top = `${-g - 2}px`;
      el.crosshair.querySelector('.b').style.bottom = `${-g - 2}px`;
      el.crosshair.querySelector('.l').style.left = `${-g - 2}px`;
      el.crosshair.querySelector('.r').style.right = `${-g - 2}px`;
    },
    hitMarker(killed) {
      el.hitmarker.classList.add('on'); el.hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => el.hitmarker.classList.remove('on'), 110);
    },
    damageFlash() {
      el.vignette.classList.add('on');
      setTimeout(() => el.vignette.classList.remove('on'), 130);
    },
    killfeedAdd(killer, victim, weapon, killerTeam, victimTeam) {
      const d = document.createElement('div');
      d.innerHTML = `<span class="${killerTeam}">${killer}</span> <span class="wpn">[${weapon}]</span> <span class="${victimTeam}">${victim}</span>`;
      el.killfeed.prepend(d);
      while (el.killfeed.children.length > 5) el.killfeed.lastChild.remove();
      setTimeout(() => d.remove(), 6000);
    },
    showInteract(text, progress) {
      el.interact.hidden = false;
      setText(el.interactText, 'it', text);
      el.interactFill.style.width = `${Math.round(progress * 100)}%`;
    },
    hideInteract() { el.interact.hidden = true; },
    banner(title, sub, ms = 2600) {
      el.bannerTitle.textContent = title; el.bannerSub.textContent = sub;
      el.banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => { el.banner.hidden = true; }, ms);
    },
    toast(text, ms = 2400) {
      el.toast.textContent = text; el.toast.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { el.toast.hidden = true; }, ms);
    },
    drawMinimap(world, actors, playerPos, playerYaw, plantedSite) {
      const W = el.minimap.width, H = el.minimap.height;
      const sx = (x) => ((x + 32) / 64) * W;
      const sz = (z) => ((z + 22) / 44) * H;
      mm.clearRect(0, 0, W, H);
      mm.fillStyle = 'rgba(40,44,50,0.9)'; mm.fillRect(0, 0, W, H);
      mm.fillStyle = '#2c323a';
      for (const c of world.colliders) mm.fillRect(sx(c.x0), sz(c.z0), sx(c.x1) - sx(c.x0), sz(c.z1) - sz(c.z0));
      for (const [key, s] of Object.entries(world.sites)) {
        mm.fillStyle = plantedSite === key ? '#ff4d4d' : '#f0b429';
        mm.beginPath(); mm.arc(sx(s.x), sz(s.z), 5, 0, 7); mm.fill();
        mm.fillStyle = '#101216'; mm.font = 'bold 8px sans-serif'; mm.textAlign = 'center'; mm.textBaseline = 'middle';
        mm.fillText(key, sx(s.x), sz(s.z));
      }
      for (const a of actors) {
        if (!a.alive) continue;
        mm.fillStyle = a.team === 'ember' ? '#ff7a1a' : '#19c2d8';
        mm.beginPath(); mm.arc(sx(a.pos.x), sz(a.pos.z), a.isPlayer ? 4 : 3, 0, 7); mm.fill();
      }
      if (playerPos) {
        mm.strokeStyle = '#fff'; mm.lineWidth = 1.5;
        mm.beginPath(); mm.moveTo(sx(playerPos.x), sz(playerPos.z));
        mm.lineTo(sx(playerPos.x) + Math.sin(playerYaw) * 10, sz(playerPos.z) - Math.cos(playerYaw) * 10); mm.stroke();
      }
    },
    showOverlay(mode, data = {}) {
      const copy = {
        start: ['<span class="e">EMBER</span>LINE', 'Two crews fight over the old Cinderworks yard at dusk. Plant the Igniter at Site A or Site B — or wipe the other crew out. Win rounds, earn credits, buy better steel. First crew to 5 rounds takes the yard.', 'Click to play'],
        paused: ['<span class="e">EMBER</span>LINE', 'Paused. Click to resume.', 'Click to resume'],
        end: ['EMBER takes the yard', `Final score ${data.e} – ${data.v}. ${data.e > data.v ? 'The yard is yours.' : 'VOLT holds the yard this time.'} Play again and run it back.`, 'Play again'],
      }[mode];
      el.title.innerHTML = copy[0]; el.copy.textContent = copy[1]; el.play.textContent = copy[2];
      el.overlay.hidden = false; el.play.focus();
    },
    hideOverlay() { el.overlay.hidden = true; },
    onPlay(handler) { el.play.addEventListener('click', handler); },
    showBuy(money, secondsLeft, owned, onBuy) {
      el.buyOverlay.hidden = false;
      setText(el.buyMoney, 'bmoney', `$${money}`);
      setText(el.buyTimer, 'btimer', `${Math.ceil(secondsLeft)}s left`);
      el.shopGrid.innerHTML = '';
      const items = [
        ...SHOP_ORDER.map((id) => ({ id, ...WEAPONS[id] })),
        { id: 'armor', name: 'Kevlar Vest', price: ARMOR_PRICE, desc: '+50 armor. Absorbs half of incoming damage until it breaks.' },
      ];
      items.forEach((it, i) => {
        const div = document.createElement('div');
        const isOwned = owned.includes(it.id);
        const cant = !isOwned && money < it.price;
        div.className = `shop-item${isOwned ? ' owned' : ''}${cant ? ' cant' : ''}`;
        div.innerHTML = `<span class="price">${isOwned ? 'OWNED' : '$' + it.price}</span><b>[${i + 1}] ${it.name}</b><small>${it.desc}</small>`;
        div.addEventListener('click', () => onBuy(it.id));
        el.shopGrid.appendChild(div);
      });
    },
    hideBuy() { el.buyOverlay.hidden = true; },
    showScore(rows, sub) {
      el.scoreSub.textContent = sub;
      el.scoreRows.innerHTML = rows.map((r) => `<tr class="${r.alive ? '' : 'dead'}"><td class="${r.team}">${r.name}${r.isPlayer ? ' (you)' : ''}</td><td class="${r.team}">${r.team.toUpperCase()}</td><td>${r.kills}</td><td>${r.deaths}</td><td>$${r.money}</td></tr>`).join('');
      el.scoreOverlay.hidden = false;
    },
    hideScore() { el.scoreOverlay.hidden = true; },
  };
}
