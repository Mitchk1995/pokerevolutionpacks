/**
 * Interactive holographic card.
 *
 * A vanilla port of the Svelte component in simeydotme/pokemon-cards-css: the
 * DOM shape, the CSS custom properties and the pointer maths are the same, but
 * the springs are a small rAF lerp instead of svelte/motion.
 */

const clamp = (v, min = 0, max = 100) => Math.min(Math.max(v, min), max);
const round = (v, p = 3) => parseFloat(v.toFixed(p));
const adjust = (v, fromMin, fromMax, toMin, toMax) =>
  round(toMin + ((toMax - toMin) * (v - fromMin)) / (fromMax - fromMin));

const REST = { rx: 0, ry: 0, gx: 50, gy: 50, o: 0, bx: 50, by: 50 };

/** Cards a pack can contain that deserve the full 3D treatment. */
const FLAT = new Set(['none']);

export function createCard(pull, { interactive = true, assetBase = '../../assets' } = {}) {
  const el = document.createElement('div');
  el.className = 'card';
  const type = (pull.types && pull.types[0]) ? pull.types[0].toLowerCase() : '';
  if (type) el.classList.add(type);
  if (interactive) el.classList.add('interactive');

  el.dataset.foil = pull.foilStyle || pull.foil || 'none';
  el.dataset.supertype = (pull.supertype || '').toLowerCase().replace('é', 'e');
  el.dataset.subtypes = (pull.subtypes || []).join(' ').toLowerCase();
  el.dataset.number = String(pull.n);
  el.dataset.rarity = pull.rarity;

  el.innerHTML = `
    <div class="card__translater">
      <div class="card__rotator" tabindex="0" role="button"
           aria-label="${escapeAttr(pull.name)}, ${escapeAttr(pull.rarityLabel || pull.rarity)}">
        <img class="card__back" src="${assetBase}/holo/card-back.webp" alt="" draggable="false">
        <div class="card__front">
          <img class="card__img" src="${assetBase}/${pull.image}" alt="${escapeAttr(pull.name)}" draggable="false">
          <div class="card__shine"></div>
          <div class="card__glare"></div>
        </div>
      </div>
    </div>`;

  const rotator = el.querySelector('.card__rotator');
  const state = { ...REST };
  const target = { ...REST };
  let raf = null;
  let settleAt = 0;

  const apply = () => {
    el.style.setProperty('--pointer-x', `${state.gx}%`);
    el.style.setProperty('--pointer-y', `${state.gy}%`);
    el.style.setProperty('--card-opacity', state.o);
    el.style.setProperty('--rotate-x', `${state.rx}deg`);
    el.style.setProperty('--rotate-y', `${state.ry}deg`);
    el.style.setProperty('--background-x', `${state.bx}%`);
    el.style.setProperty('--background-y', `${state.by}%`);
    el.style.setProperty('--pointer-from-center',
      clamp(Math.hypot(state.gy - 50, state.gx - 50) / 50, 0, 1));
    el.style.setProperty('--pointer-from-top', state.gy / 100);
    el.style.setProperty('--pointer-from-left', state.gx / 100);
  };

  const tick = () => {
    // Snappy while the pointer drives it, slow and soft on the way back.
    const k = Date.now() < settleAt ? 0.33 : 0.09;
    let moving = false;
    for (const key of Object.keys(target)) {
      const delta = target[key] - state[key];
      if (Math.abs(delta) > 0.01) { state[key] += delta * k; moving = true; }
      else state[key] = target[key];
    }
    apply();
    raf = moving ? requestAnimationFrame(tick) : null;
  };

  const kick = () => { if (raf === null) raf = requestAnimationFrame(tick); };

  /**
   * Sweep the light across the card on its own.
   *
   * The upstream effect is entirely pointer-driven, which is right for a
   * gallery you browse but wrong for a pack reveal - you would never see the
   * foil unless you happened to mouse over the card. This walks the virtual
   * pointer along a slow ellipse so the holo actually plays, and yields the
   * moment a real pointer arrives.
   */
  let showcaseRaf = null;
  const stopShowcase = () => {
    if (showcaseRaf !== null) cancelAnimationFrame(showcaseRaf);
    showcaseRaf = null;
  };
  el.showcase = (duration = 3600) => {
    stopShowcase();
    const started = performance.now();
    const step = (now) => {
      const t = (now - started) / duration;
      if (t >= 1) {
        showcaseRaf = null;
        Object.assign(target, REST);
        el.classList.remove('interacting');
        kick();
        return;
      }
      // One full pass of the light, easing in and out at the edges.
      const a = t * Math.PI * 2;
      const px = 50 + Math.cos(a) * 42;
      const py = 50 + Math.sin(a * 1.6) * 34;
      const fade = Math.min(1, Math.sin(Math.PI * t) * 2.2);

      target.bx = adjust(px, 0, 100, 37, 63);
      target.by = adjust(py, 0, 100, 33, 67);
      target.rx = round(-((px - 50) / 4.5));
      target.ry = round((py - 50) / 4.5);
      target.gx = px;
      target.gy = py;
      target.o = fade;

      settleAt = now + 120;
      el.classList.add('interacting');
      kick();
      showcaseRaf = requestAnimationFrame(step);
    };
    showcaseRaf = requestAnimationFrame(step);
  };

  const onMove = (e) => {
    stopShowcase();
    const rect = rotator.getBoundingClientRect();
    const px = clamp(round((100 / rect.width) * (e.clientX - rect.left)));
    const py = clamp(round((100 / rect.height) * (e.clientY - rect.top)));
    const cx = px - 50;
    const cy = py - 50;

    target.bx = adjust(px, 0, 100, 37, 63);
    target.by = adjust(py, 0, 100, 33, 67);
    target.rx = round(-(cx / 3.5));
    target.ry = round(cy / 3.5);
    target.gx = px;
    target.gy = py;
    target.o = 1;

    settleAt = Date.now() + 120;
    el.classList.add('interacting');
    kick();
  };

  const onLeave = () => {
    Object.assign(target, REST);
    settleAt = 0;
    el.classList.remove('interacting');
    kick();
  };

  if (interactive && !FLAT.has(el.dataset.foil)) {
    rotator.addEventListener('pointermove', onMove);
    rotator.addEventListener('pointerleave', onLeave);
    rotator.addEventListener('pointercancel', onLeave);
  } else if (interactive) {
    // Non-foil cards still tilt; they just have no shine layers to drive.
    rotator.addEventListener('pointermove', onMove);
    rotator.addEventListener('pointerleave', onLeave);
  }

  apply();

  el.destroy = () => {
    stopShowcase();
    if (raf !== null) cancelAnimationFrame(raf);
    rotator.removeEventListener('pointermove', onMove);
    rotator.removeEventListener('pointerleave', onLeave);
    rotator.removeEventListener('pointercancel', onLeave);
  };
  return el;
}

function escapeAttr(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export default createCard;
