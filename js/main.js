/* MXP Filmz · prototype interactions (vanilla JS, no dependencies) */
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
  const mqHover = matchMedia('(hover: hover) and (pointer: fine)');
  let reduce = mqReduce.matches;
  mqReduce.addEventListener?.('change', (e) => { reduce = e.matches; });
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ── Film grain texture (generated once, tiny) ── */
  (() => {
    const c = document.createElement('canvas'); c.width = c.height = 180;
    const ctx = c.getContext('2d'); const img = ctx.createImageData(180, 180);
    for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    ctx.putImageData(img, 0, 0);
    document.documentElement.style.setProperty('--grain', `url(${c.toDataURL('image/png')})`);
  })();

  /* ── Sound: soft glass chimes, OFF by default ── */
  const Sound = (() => {
    let ctx = null, master = null, on = false, last = 0;
    const scale = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22]; // minor pentatonic
    const btn = $('#sound');
    function init() {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = 0.16;
      const delay = ctx.createDelay(); delay.delayTime.value = 0.28;
      const fb = ctx.createGain(); fb.gain.value = 0.35;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
      master.connect(lp); lp.connect(ctx.destination); lp.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(ctx.destination);
    }
    function chime(pos = Math.random(), vel = 0.6) {
      if (!on || !ctx) return;
      const now = ctx.currentTime; if (now - last < 0.12) return; last = now;
      const note = scale[Math.floor(clamp(pos, 0, 0.999) * scale.length)];
      const f = 523.25 * Math.pow(2, note / 12);
      [[1, 1], [2.76, 0.18], [5.4, 0.06]].forEach(([m, a]) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = f * m;
        g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(a * vel, now + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 1.8 / m + 0.4);
        o.connect(g); g.connect(master); o.start(now); o.stop(now + 2.4);
      });
    }
    btn?.addEventListener('click', () => {
      on = !on;
      if (on && !ctx) init();
      if (ctx?.state === 'suspended') ctx.resume();
      btn.setAttribute('aria-pressed', String(on));
      btn.setAttribute('aria-label', on ? 'Sound on. Turn off interface chimes' : 'Sound off. Turn on interface chimes');
      if (on) chime(0.5, 0.5);
    });
    return { chime };
  })();

  const fine = mqHover.matches;
  const mqDesk = matchMedia('(min-width: 901px)');

  /* ── One scroll engine: every scroll-linked effect runs in a single rAF per frame ── */
  const scrollFns = [];
  let sTick = false;
  const onScroll = (fn) => { scrollFns.push(fn); };
  const runScroll = () => { sTick = false; const y = scrollY, vh = innerHeight; for (const fn of scrollFns) fn(y, vh); };
  const reqScroll = () => { if (!sTick) { sTick = true; requestAnimationFrame(runScroll); } };
  addEventListener('scroll', reqScroll, { passive: true });
  addEventListener('resize', reqScroll, { passive: true });

  /* ── Thin scroll progress bar ── */
  const bar = document.createElement('div');
  bar.className = 'progress'; bar.setAttribute('aria-hidden', 'true');
  document.body.appendChild(bar);
  onScroll((y, vh) => { const max = document.documentElement.scrollHeight - vh; bar.style.transform = `scaleX(${max > 0 ? clamp(y / max, 0, 1).toFixed(4) : 0})`; });

  /* ── Nav background after scroll ── */
  const nav = $('#nav');
  onScroll((y) => nav?.classList.toggle('is-scrolled', y > 40));

  /* ── Headlines reveal line by line: words wrapped in masks, staggered per visual line ── */
  function splitLines(el) {
    if (el.classList.contains('split')) return;
    const words = [];
    const walk = (node) => [...node.childNodes].forEach((n) => {
      if (n.nodeType === 3) {
        const frag = document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
          const w = document.createElement('span'); w.className = 'w';
          const i = document.createElement('span'); i.textContent = part; w.appendChild(i);
          frag.appendChild(w); words.push(w);
        });
        n.replaceWith(frag);
      } else if (n.nodeType === 1 && n.tagName !== 'BR') walk(n);
    });
    walk(el);
    el.classList.add('split');
    const lines = () => { let top = null, l = -1; words.forEach((w) => { const t = w.offsetTop; if (top === null || Math.abs(t - top) > 4) { l++; top = t; } w.style.setProperty('--l', l); }); };
    lines(); document.fonts?.ready.then(lines);
  }
  $$('[data-split]').forEach(splitLines);

  /* ── HERO spotlight ── */
  const hero = $('.hero');
  const stage = $('#heroStage');
  if (hero && stage) {
    const parse = (k) => { try { return JSON.parse(stage.dataset[k] || '[]'); } catch (e) { return []; } };
    const lists = { wide: parse('stills'), tall: parse('portraits') };
    if (!lists.tall.length) lists.tall = lists.wide;
    const mqPortrait = matchMedia(stage.dataset.portraitMq || '(orientation: portrait) and (max-width: 900px)');
    const mode = () => (mqPortrait.matches ? 'tall' : 'wide');
    let stills = lists[mode()];
    const interval = Math.max(4, Number(stage.dataset.interval) || 9) * 1000;
    const basePics = $$('.hero__base picture', stage), litPics = $$('.hero__lit picture', stage);
    const img = (pic) => $('img', pic);
    let idx = 0, active = 0, swapping = false, sourcesStripped = false;

    const W = () => hero.clientWidth, H = () => hero.clientHeight;
    const pct = (s, d) => { const m = String(s || d).match(/([\d.]+)%\s+([\d.]+)%/); return m ? [m[1] / 100, m[2] / 100] : [0.5, 0.45]; };
    let lightPt = pct(stills[0]?.light, '50% 45%');
    // initial focus (object-position) for whichever list is showing
    [basePics[0], litPics[0]].forEach((p) => { img(p).style.objectPosition = stills[0]?.focus || '50% 50%'; });
    if (mode() === 'tall' && stills[0]) img(litPics[0]).alt = stills[0].alt;

    const st = { x: W() * lightPt[0], y: H() * lightPt[1], tx: 0, ty: 0, r: 300, i: 1, lastInput: -1e9, inView: true, dip: 0, off: 0 };
    st.tx = st.x; st.ty = st.y;
    const radius = () => { const w = W(), h = H(); return w < 640 ? Math.max(w, h) * 0.30 : Math.max(w, h) * 0.24; };

    const setTarget = (cx, cy, kind) => {
      const r = hero.getBoundingClientRect();
      st.tx = cx - r.left; st.ty = cy - r.top; st.lastInput = performance.now();
      if (reduce) { st.x = st.tx; st.y = st.ty; }
      if (kind === 'touch') hero.classList.add('touched');
    };
    let lastMove = { x: 0, y: 0, t: 0 };
    hero.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      setTarget(e.clientX, e.clientY, 'mouse');
      const dt = e.timeStamp - lastMove.t, d = Math.hypot(e.clientX - lastMove.x, e.clientY - lastMove.y);
      if (dt > 0 && d / dt > 1.6) Sound.chime(e.clientX / innerWidth, clamp(d / dt / 6, 0.2, 0.8));
      lastMove = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    });
    // Finger = flashlight (light sits a little above the fingertip). Passive so scrolling is never blocked.
    const onTouch = (e) => { const t = e.touches[0]; if (t) setTarget(t.clientX, t.clientY - 60, 'touch'); };
    hero.addEventListener('touchstart', onTouch, { passive: true });
    hero.addEventListener('touchmove', onTouch, { passive: true });

    // Stills crossfade
    const counter = $('#heroIndex'), total = $('#heroTotal'), caption = $('#heroCaption'), nextBtn = $('#heroNext');
    const syncUI = () => {
      if (counter) counter.textContent = String(idx + 1).padStart(2, '0');
      if (total) total.textContent = String(stills.length).padStart(2, '0');
      if (caption) caption.textContent = stills[idx]?.caption || '';
      if (nextBtn) nextBtn.hidden = stills.length < 2;
    };
    syncUI();
    const stripSources = () => { if (sourcesStripped) return; $$('source', stage).forEach((s) => s.remove()); sourcesStripped = true; };
    async function show(n, force) {
      if ((swapping && !force) || (!force && stills.length < 2)) return;
      swapping = true; stripSources();
      idx = (n + stills.length) % stills.length;
      const s = stills[idx], nxt = force ? active : 1 - active;
      const pre = new Image(); pre.src = s.src;
      try { await pre.decode(); } catch (e) { /* show anyway */ }
      [basePics[nxt], litPics[nxt]].forEach((p) => { img(p).src = s.src; img(p).style.objectPosition = s.focus || '50% 50%'; });
      img(litPics[nxt]).alt = s.alt || '';
      if (nxt !== active) {
        img(litPics[active]).alt = '';
        basePics[nxt].classList.add('is-active'); litPics[nxt].classList.add('is-active');
        basePics[active].classList.remove('is-active'); litPics[active].classList.remove('is-active');
        active = nxt;
      }
      lightPt = pct(s.light, '50% 45%');
      syncUI();
      if (!force) Sound.chime(idx / stills.length, 0.5);
      setTimeout(() => { swapping = false; }, reduce || force ? 50 : 1600);
    }
    // Rotating a phone / resizing across the breakpoint switches between the wide and vertical lists
    mqPortrait.addEventListener?.('change', () => { stills = lists[mode()]; idx = Math.min(idx, stills.length - 1); show(idx, true); });
    let timer = 0;
    const schedule = () => { clearTimeout(timer); if (!reduce && stills.length > 1) timer = setTimeout(() => { if (st.inView && !document.hidden) show(idx + 1); schedule(); }, interval); };
    nextBtn?.addEventListener('click', () => { show(idx + 1); schedule(); });
    hero.addEventListener('click', (e) => { if (e.pointerType === 'mouse' && !e.target.closest('a,button')) { show(idx + 1); schedule(); } });
    schedule();
    // Preload the other stills once the page is idle
    setTimeout(() => stills.slice(1).forEach((s) => { const i = new Image(); i.src = s.src; }), 2500); // current list only

    new IntersectionObserver(([en]) => { st.inView = en.isIntersecting; }).observe(hero);

    // Smooth noise for flicker
    const noise = (t) => Math.sin(t * 1.7) * 0.5 + Math.sin(t * 3.1 + 1.3) * 0.3 + Math.sin(t * 7.3 + 2.1) * 0.2;
    let t0 = performance.now();
    function frame(now) {
      const t = (now - t0) / 1000;
      if (st.inView) {
        const idle = now - st.lastInput > (hero.classList.contains('touched') ? 2600 : 3200);
        if (idle && !reduce) {
          // auto-drift: slow lissajous around the still's light point
          const w = W(), h = H(), ax = Math.min(w * 0.22, 320), ay = Math.min(h * 0.16, 180);
          st.tx = w * lightPt[0] + Math.sin(t * 0.33) * ax;
          st.ty = h * lightPt[1] + Math.sin(t * 0.51 + 1.2) * ay;
        } else if (idle && reduce) {
          st.tx = W() * lightPt[0]; st.ty = H() * lightPt[1];
        }
        const k = reduce ? 1 : (idle ? 0.022 : 0.09); // pointer: soft trailing ease; idle: slow drift
        st.x = lerp(st.x, st.tx, k); st.y = lerp(st.y, st.ty, k);
        st.r = lerp(st.r, radius(), 0.08);
        let i = 1, r = st.r;
        if (!reduce) {
          if (st.dip <= 0 && Math.random() < 0.004) st.dip = 0.12 + Math.random() * 0.18; // occasional practical-light stutter
          const dipping = st.dip > 0 ? (st.dip -= 1 / 60, 0.78 + Math.random() * 0.12) : 1;
          i = clamp((0.95 + noise(t) * 0.04) * dipping, 0, 1);
          r = st.r * (1 + noise(t * 0.6 + 4) * 0.025);
        }
        hero.style.setProperty('--x', st.x.toFixed(1) + 'px');
        hero.style.setProperty('--y', (st.y - st.off).toFixed(1) + 'px'); // stage is parallaxed by st.off
        hero.style.setProperty('--r', r.toFixed(1) + 'px');
        hero.style.setProperty('--i', i.toFixed(3));
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    addEventListener('resize', () => { if (now() - st.lastInput > 3000) { st.tx = W() * lightPt[0]; st.ty = H() * lightPt[1]; } }, { passive: true });
    function now() { return performance.now(); }

    // Scroll: the still sinks slower than the page (parallax) while the copy lifts and fades
    const copy = $('.hero__copy', hero), meta = $('.hero__meta', hero);
    onScroll((y) => {
      if (reduce) { st.off = 0; return; }
      const h = H(); if (y > h * 1.2) return;
      const p = clamp(y / h, 0, 1);
      st.off = y * 0.35;
      stage.style.transform = `translate3d(0, ${st.off.toFixed(1)}px, 0)`;
      if (copy) { copy.style.transform = y > 0 ? `translate3d(0, ${(-y * 0.12).toFixed(1)}px, 0)` : ''; copy.style.opacity = y > 0 ? (1 - p * 1.1).toFixed(3) : ''; }
      if (meta) meta.style.opacity = y > 0 ? clamp(1 - p * 1.6, 0, 1).toFixed(3) : '';
    });
    // Intro: headline lines rise in, then the rest of the copy
    requestAnimationFrame(() => requestAnimationFrame(() => { hero.classList.add('is-ready'); $('.hero__title', hero)?.classList.add('is-in'); }));

    // test/screenshot hook: window.__spot(xFrac, yFrac) pins the light
    window.__spot = (fx, fy) => { const r = hero.getBoundingClientRect(); setTarget(r.left + r.width * fx, r.top + r.height * fy, 'mouse'); st.x = st.tx; st.y = st.ty; st.lastInput = 1e12; };
  }

  /* ── Scroll reveals ── */
  const revealIO = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('is-in'); revealIO.unobserve(en.target); } });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
  $$('.reveal').forEach((el, i) => {
    const d = el.classList.contains('tile') ? ([...el.parentElement.children].indexOf(el) % 3) * 120 : (i % 3) * 80;
    el.style.transitionDelay = `${d}ms`;
    el.addEventListener('transitionend', () => { el.style.transitionDelay = ''; }, { once: true });
    revealIO.observe(el);
  });
  $$('.split').forEach((el) => { if (!el.closest('.reveal') && !el.closest('.hero')) revealIO.observe(el); });

  /* ── Work tiles: silent previews that autoplay in view (lazy) + lightbox ── */
  const tiles = $$('.tile');
  // Fallback when a tile has no preview.mp4: cycle through 2-3 frames (data-frames).
  const frameTimers = new WeakMap();
  function cycleFrames(tile) {
    const list = (tile.dataset.frames || '').split(',').filter(Boolean);
    if (list.length < 2) { tile.classList.add('is-playing'); return; }
    const btn = $('.tile__btn', tile);
    let layers = $$('.tile__frame', tile);
    if (!layers.length) {
      layers = [0, 1].map(() => { const im = document.createElement('img'); im.className = 'tile__frame'; im.alt = ''; im.decoding = 'async'; btn.insertBefore(im, $('.tile__video', tile)); return im; });
    }
    let n = 0, which = 0;
    const step = () => {
      n = (n + 1) % list.length; // frame 01 is usually the poster, so start on the next one
      const im = layers[which]; im.src = list[n];
      const go = () => { layers.forEach((l) => l.classList.toggle('is-on', l === im)); which = 1 - which; };
      im.complete ? go() : (im.onload = go);
    };
    step();
    frameTimers.set(tile, setInterval(step, 1100));
    tile.classList.add('is-playing');
  }
  const ensureSrc = (tile) => { const v = $('video', tile); if (!v.getAttribute('src') && tile.dataset.preview) { v.muted = true; v.preload = 'metadata'; v.src = tile.dataset.preview; } return v; };
  const play = (tile) => {
    if (reduce || tile.classList.contains('is-playing')) return;
    if (!tile.dataset.preview) return cycleFrames(tile);
    const v = ensureSrc(tile); v.muted = true; tile.classList.add('is-playing');
    if (!v.dataset.bound) { v.dataset.bound = '1'; v.addEventListener('playing', () => tile.classList.add('has-video')); }
    v.play()?.catch(() => tile.classList.remove('is-playing'));
  };
  const stop = (tile) => {
    const v = $('video', tile); if (v.getAttribute('src')) v.pause();
    clearInterval(frameTimers.get(tile)); $$('.tile__frame', tile).forEach((l) => l.classList.remove('is-on'));
    tile.classList.remove('is-playing', 'has-video');
  };
  tiles.forEach((tile, n) => {
    const btn = $('.tile__btn', tile);
    btn.dataset.cursor = 'Play';
    btn.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') Sound.chime(0.2 + n * 0.12, 0.45); });
    btn.addEventListener('click', () => openLightbox(tile));
    // Tilt toward the pointer + a soft glare that follows it (desktop only)
    if (fine && !reduce) {
      btn.addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'mouse') return;
        const r = btn.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
        btn.style.setProperty('--rx', ((0.5 - py) * 5).toFixed(2) + 'deg');
        btn.style.setProperty('--ry', ((px - 0.5) * 7).toFixed(2) + 'deg');
        btn.style.setProperty('--gx', (px * 100).toFixed(1) + '%');
        btn.style.setProperty('--gy', (py * 100).toFixed(1) + '%');
        tile.classList.add('is-hover');
      });
      btn.addEventListener('pointerleave', () => { btn.style.setProperty('--rx', '0deg'); btn.style.setProperty('--ry', '0deg'); tile.classList.remove('is-hover'); });
    }
  });
  // Previews autoplay (muted, looping, inline) while on screen and pause off screen.
  // The file is only attached once a tile is within ~300px of the viewport; reduced motion keeps the posters.
  const visible = new Set();
  let lightboxOpen = false;
  if (!reduce && tiles.length && 'IntersectionObserver' in window) {
    const nearIO = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (!en.isIntersecting) return;
      ensureSrc(en.target); nearIO.unobserve(en.target);
    }), { rootMargin: '300px 0px' });
    const viewIO = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (en.isIntersecting) { visible.add(en.target); if (!lightboxOpen && !document.hidden) play(en.target); }
      else { visible.delete(en.target); stop(en.target); }
    }), { threshold: 0.3 });
    tiles.forEach((t) => { nearIO.observe(t); viewIO.observe(t); });
    document.addEventListener('visibilitychange', () => visible.forEach((t) => (document.hidden ? stop(t) : play(t))));
  }
  /* ── /work category filter: chips (and ?cat= from the hero links) fade/scale tiles out, then FLIP the rest into place ── */
  const workGrid = $('#workGrid'), workChips = $$('.work__chips .chip');
  if (workGrid && workChips.length) {
    const items = $$('.tile', workGrid);
    const apply = (cat, animate = true) => {
      if (!workChips.some((c) => c.dataset.cat === cat)) cat = 'all';
      workChips.forEach((c) => { const on = c.dataset.cat === cat; c.classList.toggle('is-active', on); c.setAttribute('aria-pressed', String(on)); });
      const show = (t) => cat === 'all' || t.dataset.category === cat;
      const anim = animate && !reduce && 'animate' in Element.prototype;
      const first = new Map(items.map((t) => [t, t.getBoundingClientRect()]));
      const leaving = items.filter((t) => !t.classList.contains('is-filtered') && !show(t));
      const done = () => {
        items.forEach((t) => { t.classList.toggle('is-filtered', !show(t)); if (show(t)) t.classList.add('is-in'); });
        if (!anim) return;
        items.filter(show).forEach((t, i) => {
          const a = first.get(t), b = t.getBoundingClientRect(), was = a.width > 0;
          const from = was ? `translate(${a.left - b.left}px, ${a.top - b.top}px)` : 'translateY(24px) scale(.96)';
          t.animate([{ transform: from, opacity: was ? 1 : 0 }, { transform: 'none', opacity: 1 }], { duration: 560, delay: was ? 0 : 60 + i * 50, easing: 'cubic-bezier(.2,.7,.1,1)', fill: 'backwards' });
        });
      };
      if (anim && leaving.length) Promise.all(leaving.map((t) => t.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.94)' }], { duration: 220, easing: 'ease-in' }).finished)).then(() => { items.forEach((t) => first.set(t, t.getBoundingClientRect())); done(); });
      else done();
    };
    workChips.forEach((c) => c.addEventListener('click', () => {
      apply(c.dataset.cat);
      const u = new URL(location.href); c.dataset.cat === 'all' ? u.searchParams.delete('cat') : u.searchParams.set('cat', c.dataset.cat); history.replaceState(null, '', u);
    }));
    const q = new URLSearchParams(location.search).get('cat'); if (q) apply(q, false);
  }
  const pauseTiles = () => { lightboxOpen = true; visible.forEach(stop); };
  const resumeTiles = () => { lightboxOpen = false; visible.forEach(play); };

  /* ── Custom cursor: a 'Play' disc over video tiles, 'Drag' over the compare slider (mouse only) ── */
  if (fine && !reduce) {
    const cur = document.createElement('div');
    cur.className = 'cursor'; cur.setAttribute('aria-hidden', 'true');
    cur.innerHTML = '<span class="cursor__label"></span>';
    document.body.appendChild(cur);
    document.documentElement.classList.add('has-cursor');
    const lab = $('.cursor__label', cur);
    let x = -200, y = -200, tx = -200, ty = -200, sc = 0, ts = 0, raf = 0, label = '';
    const tick = () => {
      x = lerp(x, tx, 0.2); y = lerp(y, ty, 0.2); sc = lerp(sc, ts, 0.16);
      cur.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${sc.toFixed(3)})`;
      raf = (Math.abs(x - tx) + Math.abs(y - ty) > 0.3 || Math.abs(sc - ts) > 0.004) ? requestAnimationFrame(tick) : 0;
    };
    const target = (el) => {
      const t = el?.closest?.('[data-cursor]'), want = t && !lightboxOpen ? t.dataset.cursor : '';
      if (want !== label) { label = want; if (want) lab.textContent = want; cur.dataset.kind = want.toLowerCase(); }
      if (want && sc < 0.05) { x = tx; y = ty; } // appear in place, don't fly in from the last spot
      ts = want ? 1 : 0;
      if (!raf) raf = requestAnimationFrame(tick);
    };
    addEventListener('pointermove', (e) => { if (e.pointerType !== 'mouse') return; tx = e.clientX; ty = e.clientY; target(e.target); }, { passive: true });
    document.addEventListener('pointerleave', () => { ts = 0; if (!raf) raf = requestAnimationFrame(tick); });
    onScroll(() => { if (tx > -100) target(document.elementFromPoint(tx, ty)); }); // content moves under a still pointer
  }

  /* ── Lightbox: grows out of the tile you clicked (FLIP), fades back on close ── */
  const lb = $('#lightbox'), lbFrame = $('#lightboxFrame'), lbTabs = $('#lightboxTabs');
  const EASE = 'cubic-bezier(.2,.7,.1,1)';
  // Full videos are only requested here, on click (tiles never preload them).
  function playLocal(src, poster) {
    lbFrame.innerHTML = '';
    const v = document.createElement('video');
    v.src = src; v.controls = true; v.autoplay = true; v.playsInline = true; v.preload = 'auto';
    if (poster) v.poster = poster;
    lbFrame.appendChild(v);
    v.play()?.catch(() => {});
  }
  function openLightbox(tile) {
    if (!lb) return;
    const yt = (tile.dataset.youtube || '').trim();
    let videos = []; try { videos = JSON.parse(tile.dataset.videos || '[]'); } catch (e) { videos = []; }
    const poster = $('.tile__poster', tile)?.currentSrc || '';
    lbFrame.innerHTML = ''; lbTabs.innerHTML = ''; lbTabs.hidden = true;
    if (yt) {
      const f = document.createElement('iframe');
      f.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(yt)}?autoplay=1&rel=0&playsinline=1&modestbranding=1`;
      f.title = $('.tile__title', tile)?.textContent || 'Video';
      f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'; f.allowFullscreen = true;
      lbFrame.appendChild(f);
    } else if (videos.length > 1) { // several cuts (e.g. Pissed: two Reels) -> tabs
      videos.forEach((vd, i) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'chip' + (i ? '' : ' is-active');
        b.textContent = vd.label; b.setAttribute('aria-pressed', String(!i));
        b.addEventListener('click', () => { $$('.chip', lbTabs).forEach((c) => { c.classList.toggle('is-active', c === b); c.setAttribute('aria-pressed', String(c === b)); }); playLocal(vd.src, vd.poster); });
        lbTabs.appendChild(b);
      });
      lbTabs.hidden = false;
      playLocal(videos[0].src, videos[0].poster || poster);
    } else if (tile.dataset.full || tile.dataset.preview) {
      playLocal(tile.dataset.full || tile.dataset.preview, poster);
    } else { // no video yet: show the poster
      const im = document.createElement('img'); im.src = poster; im.alt = $('.tile__poster', tile).alt; im.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover';
      lbFrame.appendChild(im);
    }
    lb.classList.toggle('is-tall', tile.dataset.orient === 'tall');
    pauseTiles();
    document.documentElement.classList.add('lb-open');
    if (typeof lb.showModal === 'function') lb.showModal(); else lb.setAttribute('open', '');
    if (!reduce && lbFrame.animate) {
      const from = $('.tile__btn', tile).getBoundingClientRect(), to = lbFrame.getBoundingClientRect();
      if (to.width && to.height) {
        lbFrame.animate([
          { transformOrigin: '0 0', transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`, borderRadius: '14px', opacity: 0.4 },
          { transformOrigin: '0 0', transform: 'none', borderRadius: '10px', opacity: 1 },
        ], { duration: 620, easing: EASE });
        [$('#lightboxClose'), lbTabs].forEach((el) => el.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: 260, easing: EASE, fill: 'backwards' }));
      }
    }
  }
  let closing = false;
  const closeLightbox = () => {
    if (!lb || closing || !lb.open) return;
    const done = () => { closing = false; lb.close ? lb.close() : lb.removeAttribute('open'); };
    if (reduce || !lbFrame.animate) return done();
    closing = true; lb.classList.add('is-closing');
    let fin = false;
    const finish = () => { if (fin) return; fin = true; clearTimeout(safety); lb.classList.remove('is-closing'); done(); };
    const safety = setTimeout(finish, 450); // never leave the dialog stuck open if the animation is interrupted
    lbFrame.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.96)' }], { duration: 240, easing: 'ease-in' }).onfinish = finish;
  };
  if (lb) {
    $('#lightboxClose').addEventListener('click', closeLightbox);
    lb.addEventListener('click', (e) => { if (e.target === lb) closeLightbox(); });
    lb.addEventListener('cancel', (e) => { e.preventDefault(); closeLightbox(); }); // Esc: animate out too
    lb.addEventListener('close', () => { lbFrame.innerHTML = ''; lbTabs.innerHTML = ''; lbTabs.hidden = true; document.documentElement.classList.remove('lb-open'); resumeTiles(); });
  }

  /* ── Raw → final: scroll-driven until the user drags ── */
  const cmp = $('#compare'), range = $('#compareRange');
  if (cmp && range) {
    let userSet = false;
    cmp.dataset.cursor = 'Drag';
    const set = (v) => { cmp.style.setProperty('--pos', v + '%'); range.value = v; };
    range.addEventListener('input', () => { userSet = true; cmp.style.setProperty('--pos', range.value + '%'); });
    onScroll((y, vh) => {
      if (userSet || reduce) return;
      const r = cmp.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh) return;
      const p = clamp((vh - r.top) / (vh + r.height), 0, 1); // 0 entering → 1 leaving
      set((92 - clamp((p - 0.15) / 0.6, 0, 1) * 84).toFixed(1));
    });
    if (reduce) set(50);
  }

  /* ── Film strip ──
     Desktop (mouse, ≥901px): the section pins and vertical scrolling drives the strip sideways.
     Touch / small screens / reduced motion: native horizontal swipe (plus mouse drag), filter chips, buttons. */
  const strip = $('#strip'), stripSec = $('.strip-sec');
  if (strip && stripSec) {
    const track = $('.strip__track', strip), sbar = $('#stripBar');
    const pinMQ = matchMedia('(min-width: 901px) and (hover: hover) and (pointer: fine)');
    let pinned = false, maxX = 0, dist = 1, cx = 0, tx = 0, praf = 0, items = [];
    const setBar = (left) => { const sw = track.scrollWidth || strip.scrollWidth, cw = strip.clientWidth; if (!sbar || !sw) return; sbar.style.width = (cw / sw * 100) + '%'; sbar.style.left = (left / sw * 100) + '%'; };
    const nativeProgress = () => { if (!pinned) setBar(strip.scrollLeft); };
    const paint = () => {
      track.style.transform = `translate3d(${(-cx).toFixed(1)}px, 0, 0)`;
      setBar(cx);
      const vw = strip.clientWidth; // frames come into focus as they reach the middle
      for (const it of items) { const c = it.el.offsetLeft + it.el.offsetWidth / 2 - cx; const d = Math.min(1, Math.abs(c - vw / 2) / vw); it.el.style.opacity = (1 - d * 0.55).toFixed(3); }
    };
    const step = () => { cx = lerp(cx, tx, 0.14); if (Math.abs(cx - tx) < 0.4) cx = tx; paint(); praf = cx !== tx ? requestAnimationFrame(step) : 0; };
    const pinUpdate = () => {
      if (!pinned) return;
      const r = stripSec.getBoundingClientRect();
      tx = clamp(-r.top / dist, 0, 1) * maxX;
      if (!praf) praf = requestAnimationFrame(step);
    };
    const measure = () => {
      pinned = pinMQ.matches && !reduce;
      stripSec.classList.toggle('is-pinned', pinned);
      items = $$('.strip__item:not([hidden])', strip).map((el) => ({ el }));
      if (!pinned) { stripSec.style.height = ''; track.style.transform = ''; items.forEach((it) => { it.el.style.opacity = ''; }); nativeProgress(); return; }
      strip.scrollLeft = 0;
      maxX = Math.max(0, track.scrollWidth - strip.clientWidth);
      dist = Math.max(1, Math.min(maxX * 0.55, innerHeight * 4.5)); // cap the pinned run at ~4.5 screens of scrolling
      stripSec.style.height = (innerHeight + dist) + 'px';
      pinUpdate(); cx = tx; paint();
    };
    onScroll(pinUpdate);
    strip.addEventListener('scroll', nativeProgress, { passive: true });
    let rT = 0; addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(measure, 120); });
    pinMQ.addEventListener?.('change', measure);
    addEventListener('load', measure);
    measure();
    // mouse drag (non-pinned mode only)
    let down = false, sx = 0, sl = 0, moved = 0, vx = 0, lx = 0, lt = 0, raf = 0;
    strip.addEventListener('pointerdown', (e) => {
      if (pinned || e.pointerType !== 'mouse' || e.button !== 0) return;
      down = true; moved = 0; sx = lx = e.clientX; sl = strip.scrollLeft; lt = e.timeStamp; vx = 0; cancelAnimationFrame(raf);
      strip.setPointerCapture(e.pointerId);
    });
    strip.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - sx; moved = Math.max(moved, Math.abs(dx));
      if (moved > 4) strip.classList.add('is-dragging');
      strip.scrollLeft = sl - dx;
      const dt = e.timeStamp - lt; if (dt > 0) vx = (e.clientX - lx) / dt; lx = e.clientX; lt = e.timeStamp;
    });
    const release = () => {
      if (!down) return; down = false;
      let v = -vx * 16; // px per frame
      const glide = () => { if (Math.abs(v) < 0.5 || reduce) { strip.classList.remove('is-dragging'); return; } strip.scrollLeft += v; v *= 0.93; raf = requestAnimationFrame(glide); };
      glide();
    };
    strip.addEventListener('pointerup', release); strip.addEventListener('pointercancel', release);
    strip.addEventListener('click', (e) => { if (moved > 4) { e.preventDefault(); e.stopPropagation(); } }, true);
    const page = (dir) => {
      if (pinned) scrollBy({ top: dir * strip.clientWidth * 0.6 * dist / Math.max(1, maxX), behavior: 'smooth' });
      else strip.scrollBy({ left: dir * strip.clientWidth * 0.75, behavior: reduce ? 'auto' : 'smooth' });
    };
    $('#stripPrev')?.addEventListener('click', () => page(-1));
    $('#stripNext')?.addEventListener('click', () => page(1));
    strip.addEventListener('keydown', (e) => { if (!pinned) return; if (e.key === 'ArrowRight') { e.preventDefault(); page(1); } if (e.key === 'ArrowLeft') { e.preventDefault(); page(-1); } });
    $$('.chip', stripSec).forEach((chip) => chip.addEventListener('click', () => {
      const f = chip.dataset.filter;
      $$('.chip', stripSec).forEach((c) => { const on = c === chip; c.classList.toggle('is-active', on); c.setAttribute('aria-pressed', String(on)); });
      $$('.strip__item', strip).forEach((it) => { it.hidden = f !== 'all' && it.dataset.project !== f; });
      strip.scrollTo({ left: 0 }); measure();
      if (pinned) { const top = stripSec.getBoundingClientRect().top + scrollY; if (scrollY > top) scrollTo({ top, behavior: 'auto' }); cx = tx = 0; paint(); }
      Sound.chime(0.6, 0.4);
    }));
  }

  /* ── Scroll-linked parallax: interstitial stills, featured tiles (desktop), section backdrops ── */
  const inters = $$('.inter');
  onScroll((y, vh) => {
    if (reduce) return;
    inters.forEach((el) => {
      const r = el.getBoundingClientRect(); if (r.bottom < -100 || r.top > vh + 100) return;
      const p = clamp((r.top + r.height / 2 - vh / 2) / vh, -1, 1);
      $('.inter__media', el).style.setProperty('--py', (p * r.height * 0.12).toFixed(1) + 'px');
      const c = $('.inter__copy', el); if (c) c.style.translate = `0 ${(p * 40).toFixed(1)}px`;
    });
  });
  const para = [];
  $$('.work__grid--featured .tile').forEach((t, i) => para.push([t, t.parentElement, i === 1 ? -0.1 : 0.03]));
  $$('.section__bg').forEach((el) => para.push([el, el.parentElement, 0.18]));
  onScroll((y, vh) => {
    const on = !reduce && mqDesk.matches;
    for (const [el, ref, f] of para) {
      if (!on) { el.style.translate = ''; continue; }
      const r = ref.getBoundingClientRect(); if (r.bottom < -200 || r.top > vh + 200) continue;
      el.style.translate = `0 ${((r.top + r.height / 2 - vh / 2) * f).toFixed(1)}px`;
    }
  });

  /* ── Magnetic buttons + pointer-lit cards (desktop) ── */
  if (fine && !reduce) {
    $$('.btn, .more__link, .round, .hero__next').forEach((el) => {
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        el.style.translate = `${clamp(dx * 0.22, -10, 10).toFixed(1)}px ${clamp(dy * 0.3, -8, 8).toFixed(1)}px`;
      });
      el.addEventListener('pointerleave', () => { el.style.translate = ''; });
    });
    $$('.pkg, .oos, .lead__card').forEach((el) => el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
      el.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
    }));
  }

  /* ── Section heading backgrounds: lazy-load a still at low opacity ── */
  const bgIO = new IntersectionObserver((entries) => entries.forEach((en) => {
    if (!en.isIntersecting) return;
    const el = en.target, src = new URL(el.dataset.bg, document.baseURI).href; bgIO.unobserve(el); // absolute: url() in a custom property resolves against the stylesheet
    const im = new Image(); im.onload = () => { el.style.setProperty('--bgimg', `url("${src}")`); el.classList.add('is-loaded'); }; im.src = src;
  }), { rootMargin: '400px 0px' });
  $$('.section__bg[data-bg]').forEach((el) => bgIO.observe(el));

  /* ── Spotlight hover on images (team banner): same lighting language as the hero ── */
  $$('[data-spot]').forEach((el) => {
    if (!mqHover.matches) return;
    let tx = 50, ty = 38, x = 50, y = 38, raf = 0, over = false;
    const tick = () => {
      x = lerp(x, tx, reduce ? 1 : 0.12); y = lerp(y, ty, reduce ? 1 : 0.12);
      el.style.setProperty('--sx', x.toFixed(2) + '%'); el.style.setProperty('--sy', y.toFixed(2) + '%');
      raf = (Math.abs(x - tx) > 0.1 || Math.abs(y - ty) > 0.1) ? requestAnimationFrame(tick) : 0;
    };
    const go = () => { if (!raf) raf = requestAnimationFrame(tick); };
    el.addEventListener('pointermove', (e) => { const r = el.getBoundingClientRect(); tx = (e.clientX - r.left) / r.width * 100; ty = (e.clientY - r.top) / r.height * 100; over = true; el.style.setProperty('--sr', '34%'); go(); });
    el.addEventListener('pointerleave', () => { tx = 50; ty = 38; over = false; el.style.setProperty('--sr', '46%'); go(); });
  });

  /* ── Lead form: Netlify Forms via fetch, with in-page thank-you ── */
  const form = $('#leadForm');
  if (form) {
    const thanks = $('#formThanks'), err = $('#formError');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      const btn = $('button[type=submit]', form); btn.disabled = true; btn.textContent = 'Sending…'; err.hidden = true;
      try {
        const res = await fetch('/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(new FormData(form)).toString() });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        form.hidden = true; thanks.hidden = false; thanks.focus(); Sound.chime(0.8, 0.5);
      } catch (ex) {
        if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) { // local preview: simulate success so the flow can be checked
          form.hidden = true; thanks.hidden = false; thanks.insertAdjacentHTML('beforeend', '<p class="ph-note">Local preview: nothing was sent. Netlify Forms handles this once deployed.</p>'); thanks.focus(); return;
        }
        // Not on Netlify (e.g. local preview / other host) or network error: keep their input, offer a direct route.
        err.innerHTML = 'Couldn’t send that just now. Your details are still here. Try again, or DM <a href="https://instagram.com/mxpfilmz" target="_blank" rel="noopener">@mxpfilmz</a> on Instagram.';
        err.hidden = false; btn.disabled = false; btn.textContent = 'Send it';
      }
    });
  }
  runScroll();
})();
