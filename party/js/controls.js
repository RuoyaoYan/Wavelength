// The phone gamepad: a floating thumb-stick on the left, big round buttons on the right.
// Keyboard works too (WASD/arrows, Space/J and K) for laptops and testing.
const DEAD = 0.15, RADIUS = 56;
const KEYS = { ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0], ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1] };

export function mountControls(el, { stick = true, buttons = [] }, onChange = () => {}) {
  const st = { x: 0, y: 0, b: Object.fromEntries(buttons.map(l => [l, 0])) };
  el.innerHTML = `<div class="pad${stick ? '' : ' no-stick'}">
      ${stick ? '<div class="stick-zone"><div class="stick-base"><div class="stick-knob"></div></div><span class="pad-hint">Drag to move</span></div>' : ''}
      <div class="btn-zone">${buttons.map((l, i) => `<button class="pad-btn b${i}" data-l="${l}" type="button">${l}</button>`).join('')}</div>
    </div>`;
  const zone = el.querySelector('.stick-zone'), base = el.querySelector('.stick-base'), knob = el.querySelector('.stick-knob');
  let stickId = null, cx = 0, cy = 0, keyX = 0, keyY = 0;
  const held = new Set();

  const setStick = (dx, dy) => {
    let x = dx / RADIUS, y = dy / RADIUS;
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    knob.style.transform = `translate(${x * RADIUS}px,${y * RADIUS}px)`;
    const mm = Math.min(1, m);
    if (mm < DEAD) { st.x = 0; st.y = 0; } else { st.x = Math.round(x * 100) / 100; st.y = Math.round(y * 100) / 100; }
  };
  const press = label => {
    st.b[label]++;
    navigator.vibrate?.(15);
    const b = el.querySelector(`.pad-btn[data-l="${label}"]`);
    if (b) { b.classList.add('down'); setTimeout(() => b.classList.remove('down'), 120); }
    onChange(st);
  };

  if (zone) {
    zone.addEventListener('pointerdown', e => {
      if (stickId !== null) return;
      e.preventDefault();
      stickId = e.pointerId;
      try { zone.setPointerCapture(e.pointerId); } catch (_) {}
      const r = zone.getBoundingClientRect();
      cx = e.clientX; cy = e.clientY;
      base.style.left = (cx - r.left) + 'px'; base.style.top = (cy - r.top) + 'px';
      zone.classList.add('active');
      setStick(0, 0);
    });
    zone.addEventListener('pointermove', e => { if (e.pointerId === stickId) setStick(e.clientX - cx, e.clientY - cy); });
    const end = e => {
      if (e.pointerId !== stickId) return;
      stickId = null; zone.classList.remove('active');
      base.style.left = ''; base.style.top = '';
      setStick(0, 0); onChange(st);
    };
    zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);
  }
  el.querySelectorAll('.pad-btn').forEach(b => {
    b.addEventListener('pointerdown', e => { e.preventDefault(); press(b.dataset.l); });
    b.addEventListener('contextmenu', e => e.preventDefault());
  });

  const keyStick = () => {
    if (stickId !== null || !zone) return;
    const m = Math.hypot(keyX, keyY) || 1;
    st.x = keyX / m; st.y = keyY / m;
    knob.style.transform = `translate(${st.x * RADIUS * 0.8}px,${st.y * RADIUS * 0.8}px)`;
  };
  const onKey = (e, down) => {
    if (e.target.closest?.('input,textarea')) return;
    if (KEYS[e.code]) {
      e.preventDefault();
      if (down) held.add(e.code); else held.delete(e.code);
      keyX = 0; keyY = 0;
      for (const k of held) { keyX += KEYS[k][0]; keyY += KEYS[k][1]; }
      keyX = Math.sign(keyX); keyY = Math.sign(keyY);
      keyStick();
    } else if (down && !e.repeat) {
      const i = e.code === 'Space' || e.code === 'KeyJ' ? 0 : e.code === 'KeyK' ? 1 : -1;
      if (buttons[i]) { e.preventDefault(); press(buttons[i]); }
    }
  };
  const kd = e => onKey(e, true), ku = e => onKey(e, false);
  addEventListener('keydown', kd); addEventListener('keyup', ku);

  return {
    state: () => ({ x: st.x, y: st.y, b: { ...st.b } }),
    destroy() { removeEventListener('keydown', kd); removeEventListener('keyup', ku); el.innerHTML = ''; },
  };
}
