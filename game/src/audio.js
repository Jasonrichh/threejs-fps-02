// Synthesised sound: no audio files, no network. Every effect is built from noise
// buffers and oscillators the first time it is needed, after a user gesture.
let ctx = null;
let master = null;
function ac() {
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = 0.32; master.connect(ctx.destination);
    } catch { return null; }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
function noiseBurst(dur, filterFreq, gainVal, type = 'lowpass') {
  const c = ac(); if (!c) return;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = type; f.frequency.value = filterFreq;
  const g = c.createGain(); g.gain.value = gainVal;
  src.connect(f); f.connect(g); g.connect(master); src.start();
}
function tone(freq, dur, gainVal, type = 'sine', slideTo = null) {
  const c = ac(); if (!c) return;
  const o = c.createOscillator(); o.type = type; o.frequency.value = freq;
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gainVal, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
  o.connect(g); g.connect(master); o.start(); o.stop(c.currentTime + dur);
}
export const sfx = {
  unlock() { ac(); },
  shot(id, distant = false) {
    const v = distant ? 0.25 : 1;
    if (id === 'railspike') { noiseBurst(0.22, 900, 0.9 * v); tone(140, 0.18, 0.5 * v, 'sawtooth', 50); }
    else if (id === 'breacher') { noiseBurst(0.28, 700, 1.0 * v); tone(90, 0.2, 0.6 * v, 'sawtooth', 40); }
    else if (id === 'rasp') { noiseBurst(0.09, 1800, 0.55 * v, 'highpass'); tone(220, 0.06, 0.3 * v, 'square', 90); }
    else if (id === 'p9') { noiseBurst(0.12, 1400, 0.7 * v); tone(180, 0.08, 0.35 * v, 'square', 70); }
    else { noiseBurst(0.14, 1200, 0.8 * v); tone(160, 0.1, 0.4 * v, 'sawtooth', 60); }
  },
  dryClick() { tone(1200, 0.03, 0.25, 'square'); },
  reload() { tone(500, 0.05, 0.3, 'square'); setTimeout(() => tone(750, 0.05, 0.3, 'square'), 160); },
  hit(kill) { tone(kill ? 1400 : 1000, kill ? 0.12 : 0.06, 0.4, 'sine'); },
  hurt() { noiseBurst(0.15, 500, 0.5); tone(110, 0.15, 0.4, 'sawtooth', 60); },
  plantBeep(final = false) { tone(final ? 1600 : 880, 0.09, 0.35, 'sine'); },
  defuseBeep() { tone(660, 0.07, 0.3, 'sine'); },
  plantDone() { tone(523, 0.12, 0.4); setTimeout(() => tone(784, 0.18, 0.4), 120); },
  roundWin() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.22, 0.35), i * 110)); },
  roundLose() { [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.25, 0.3, 'triangle'), i * 130)); },
  buy() { tone(880, 0.07, 0.35); setTimeout(() => tone(1174, 0.1, 0.35), 70); },
  denied() { tone(220, 0.12, 0.3, 'square', 160); },
  step() { noiseBurst(0.05, 400, 0.12); },
  explode() { noiseBurst(1.1, 300, 1.0); tone(55, 0.9, 0.7, 'sine', 28); },
};
