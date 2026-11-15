// Keyboard and mouse, and the pointer lock that turns the mouse into look.
// Plain browser APIs only. Also tracks single-press events (buy keys, E, Tab, B)
// so main.js can consume them once per press.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const pressed = new Set(); // codes pressed since last takePressed()
  const state = { keys, locked: false, firing: false, aiming: false, lookX: 0, lookY: 0 };

  function setKey(event, down) {
    if (down) { if (!keys.has(event.code)) pressed.add(event.code); keys.add(event.code); }
    else keys.delete(event.code);
    if (event.code === 'Space' || event.code === 'Tab') event.preventDefault();
  }
  window.addEventListener('keydown', (e) => setKey(e, true));
  window.addEventListener('keyup', (e) => setKey(e, false));
  window.addEventListener('blur', () => { keys.clear(); state.firing = false; state.aiming = false; });
  window.addEventListener('mousemove', (e) => {
    if (!state.locked) return;
    state.lookX += e.movementX; state.lookY += e.movementY;
  });
  window.addEventListener('mousedown', (e) => {
    if (!state.locked) return;
    if (e.button === 0) state.firing = true;
    if (e.button === 2) state.aiming = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) state.firing = false;
    if (e.button === 2) state.aiming = false;
  });
  window.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) { keys.clear(); state.firing = false; state.aiming = false; }
    onLockChange(state.locked);
  });

  return {
    state,
    requestLock() { try { canvas.requestPointerLock(); } catch { /* headless / denied */ } },
    takeLook() { const x = state.lookX, y = state.lookY; state.lookX = 0; state.lookY = 0; return { x, y }; },
    takePressed() { const out = [...pressed]; pressed.clear(); return out; },
    consume(code) { return pressed.delete(code); },
  };
}
