// The armoury. Five original weapons, tuned so accuracy beats spray: the first
// shot is true, spread blooms while firing or moving, and damage falls off with range.
export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 Sidearm', price: 0, damage: 34, headMult: 2.2,
    interval: 150, auto: false, mag: 12, reserve: 48, reloadMs: 1400,
    spread: 0.011, moveSpread: 0.02, bloom: 0.004, range: 42,
    kick: 0.011, tracer: 0xffd27a, desc: 'Free sidearm. Light, honest, always yours.',
  },
  rasp: {
    id: 'rasp', name: 'RASP SMG', price: 1500, damage: 24, headMult: 2.0,
    interval: 78, auto: true, mag: 28, reserve: 112, reloadMs: 1700,
    spread: 0.02, moveSpread: 0.028, bloom: 0.005, range: 30,
    kick: 0.008, tracer: 0xffb84d, desc: 'Fast close-range shredder. Wild past 20 m.',
  },
  longshot: {
    id: 'longshot', name: 'LONGSHOT AR', price: 2700, damage: 36, headMult: 2.4,
    interval: 105, auto: true, mag: 30, reserve: 90, reloadMs: 2100,
    spread: 0.008, moveSpread: 0.016, bloom: 0.0035, range: 55,
    kick: 0.013, tracer: 0xffc266, desc: 'The workhorse. Tap-fire and it rewards you.',
  },
  breacher: {
    id: 'breacher', name: 'BREACHER 12', price: 2000, damage: 14, headMult: 1.8,
    interval: 750, auto: false, mag: 6, reserve: 24, reloadMs: 2600,
    spread: 0.05, moveSpread: 0.06, bloom: 0.002, range: 16, pellets: 8,
    kick: 0.05, tracer: 0xff8c42, desc: 'Eight pellets. Devastating in a doorway.',
  },
  railspike: {
    id: 'railspike', name: 'RAILSPIKE DMR', price: 4750, damage: 92, headMult: 2.6,
    interval: 1100, auto: false, mag: 5, reserve: 20, reloadMs: 2800,
    spread: 0.002, moveSpread: 0.03, bloom: 0.001, range: 90, scoped: true,
    kick: 0.04, tracer: 0x9fe8ff, desc: 'One round, one problem solved. Right-click to scope.',
  },
};
export const SHOP_ORDER = ['rasp', 'longshot', 'breacher', 'railspike'];
export const ARMOR_PRICE = 650;
