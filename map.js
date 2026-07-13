/* ============================================================
   GrandTourMap — interactive Europe map with multi-leg routes
   Inspired by the 21st.dev "Flight Multi Route" component.
   ============================================================ */

const GrandTourMap = (() => {
  const NS = 'http://www.w3.org/2000/svg';

  // ---- Mercator projection over a Europe window ----------------
  const LON_MIN = -12.5, LON_MAX = 18.5, LAT_MIN = 35.6, LAT_MAX = 59.5;
  const W = 1000;
  const rad = d => (d * Math.PI) / 180;
  const mercY = lat => Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2));
  const SCALE = W / rad(LON_MAX - LON_MIN);
  const H = Math.round(SCALE * (mercY(LAT_MAX) - mercY(LAT_MIN)));

  function proj(lat, lon) {
    return {
      x: SCALE * rad(lon - LON_MIN),
      y: SCALE * (mercY(LAT_MAX) - mercY(lat)),
    };
  }

  function el(tag, attrs = {}, parent) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  }

  // ---- Land rendering -------------------------------------------
  let landPathData = null;

  async function loadLand() {
    if (landPathData) return landPathData;
    const res = await fetch('data/europe.geojson');
    const gj = await res.json();
    const parts = [];
    const inWindow = ring => ring.some(([lon, lat]) =>
      lon > LON_MIN - 6 && lon < LON_MAX + 6 && lat > LAT_MIN - 5 && lat < LAT_MAX + 5);

    const ringToPath = ring => {
      let d = '', step = ring.length > 400 ? Math.ceil(ring.length / 400) : 1;
      for (let i = 0; i < ring.length; i += step) {
        const [lon, lat] = ring[i];
        const p = proj(Math.max(-85, Math.min(85, lat)), lon);
        d += (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ' ' + p.y.toFixed(1);
      }
      return d + 'Z';
    };

    for (const f of gj.features) {
      const g = f.geometry;
      if (!g) continue;
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      for (const poly of polys) {
        const outer = poly[0];
        if (!outer || outer.length < 8 || !inWindow(outer)) continue;
        parts.push(ringToPath(outer));
      }
    }
    landPathData = parts.join('');
    return landPathData;
  }

  // ---- Curved leg path ------------------------------------------
  function legPath(a, b, curvature = 0.22) {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    // perpendicular, biased to always arc "upward" (screen-north) for elegance
    let nx = -dy / (dist || 1), ny = dx / (dist || 1);
    if (ny > 0) { nx = -nx; ny = -ny; }
    const k = Math.min(dist * curvature, 90);
    return { d: `M ${a.x} ${a.y} Q ${mx + nx * k} ${my + ny * k} ${b.x} ${b.y}` };
  }

  // ---- Main map factory ------------------------------------------
  let instanceCount = 0;
  async function create(container, opts = {}) {
    const journeyId = `gt-journey-${++instanceCount}`;
    const state = {
      route: null,
      onStopClick: opts.onStopClick || (() => {}),
      travelerRAF: null, travelerT: 0, playing: true, visible: true,
      legs: [], stopsPx: [],
    };

    // pause all motion while the map is off-screen
    new IntersectionObserver(([en]) => { state.visible = en.isIntersecting; syncMotion(); },
      { threshold: 0.05 }).observe(container);

    container.classList.add('gt-map');
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'gt-map-svg', preserveAspectRatio: 'xMidYMid meet' }, container);

    // layers
    const gLand = el('g', { class: 'gt-land' }, svg);
    const gGrid = el('g', { class: 'gt-grid' }, svg);
    const gRoutes = el('g', { class: 'gt-routes' }, svg);
    const gArrows = el('g', { class: 'gt-arrows' }, svg);
    const gTraveler = el('g', { class: 'gt-traveler' }, svg);
    const gMarkers = el('g', { class: 'gt-markers' }, svg);

    // graticule
    for (let lon = -10; lon <= 15; lon += 5) {
      const a = proj(LAT_MIN, lon), b = proj(LAT_MAX, lon);
      el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y }, gGrid);
    }
    for (let lat = 40; lat <= 55; lat += 5) {
      const a = proj(lat, LON_MIN), b = proj(lat, LON_MAX);
      el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y }, gGrid);
    }

    // land
    el('path', { d: await loadLand(), class: 'gt-landpath' }, gLand);

    // tooltip (HTML overlay)
    const tip = document.createElement('div');
    tip.className = 'gt-tip';
    container.appendChild(tip);

    function showTip(evtOrPt, html) {
      tip.innerHTML = html;
      tip.classList.add('on');
      const r = container.getBoundingClientRect();
      const x = evtOrPt.clientX - r.left, y = evtOrPt.clientY - r.top;
      tip.style.left = Math.min(x + 14, r.width - 230) + 'px';
      tip.style.top = Math.max(y - 14, 10) + 'px';
    }
    const hideTip = () => tip.classList.remove('on');

    // ---- render a route -----------------------------------------
    function setRoute(route, { animate = true } = {}) {
      state.route = route;
      cancelAnimationFrame(state.travelerRAF);
      gRoutes.innerHTML = ''; gArrows.innerHTML = ''; gMarkers.innerHTML = ''; gTraveler.innerHTML = '';
      state.legs = []; state.stopsPx = [];

      const stops = route.stops.map(s => {
        const pl = window.PLACES[s.place];
        return { ...s, pl, px: proj(pl.lat, pl.lon) };
      });
      state.stopsPx = stops;

      // legs
      let totalLen = 0;
      for (let i = 0; i < stops.length - 1; i++) {
        const a = stops[i], b = stops[i + 1];
        if (a.px.x === b.px.x && a.px.y === b.px.y) continue;
        const { d } = legPath(a.px, b.px);
        const under = el('path', { d, class: 'gt-leg-under', stroke: route.color }, gRoutes);
        const line = el('path', {
          d, class: 'gt-leg ' + (a.mode === 'rail' ? 'rail' : a.mode === 'drive' ? 'drive' : 'fly'),
          stroke: route.color,
        }, gRoutes);
        const len = line.getTotalLength();
        if (animate) {
          line.style.strokeDasharray = a.mode === 'fly' ? '7 7' : a.mode === 'drive' ? '2 6' : '1.5 5';
          under.style.strokeDasharray = len;
          under.style.strokeDashoffset = len;
          under.style.transition = `stroke-dashoffset .9s ${i * 0.14}s ease-out`;
          requestAnimationFrame(() => { under.style.strokeDashoffset = 0; });
        }
        // directional arrow at 55% of leg
        const mid = line.getPointAtLength(len * 0.55);
        const ahead = line.getPointAtLength(Math.min(len, len * 0.55 + 4));
        const ang = Math.atan2(ahead.y - mid.y, ahead.x - mid.x) * 180 / Math.PI;
        el('path', {
          d: 'M -5 -3.6 L 5 0 L -5 3.6 L -2.4 0 Z',
          class: 'gt-arrow', fill: route.accent,
          transform: `translate(${mid.x} ${mid.y}) rotate(${ang})`,
          opacity: animate ? 0 : 1, style: animate ? `transition: opacity .4s ${0.5 + i * 0.14}s; ` : '',
        }, gArrows);
        state.legs.push({ line, len, from: a, to: b, offset: totalLen });
        totalLen += len;
      }
      if (animate) requestAnimationFrame(() => gArrows.querySelectorAll('.gt-arrow').forEach(a => a.setAttribute('opacity', 1)));
      state.totalLen = totalLen;

      // markers (home first so its label wins collision checks)
      const seen = new Set();
      const labelBoxes = [];
      const ordered = [...stops].sort((a, b) => (b.pl.type === 'home') - (a.pl.type === 'home'));
      ordered.forEach((s, idx) => {
        const key = s.place;
        if (seen.has(key)) return;
        seen.add(key);
        const isHome = s.pl.type === 'home';
        const g = el('g', { class: 'gt-stop' + (isHome ? ' home' : ''), transform: `translate(${s.px.x} ${s.px.y})`, style: `--d:${idx * 0.1}s` }, gMarkers);
        el('circle', { r: isHome ? 16 : 11, class: 'gt-pulse', stroke: route.color }, g);
        el('circle', { r: isHome ? 6.5 : 4.6, class: 'gt-dot', fill: isHome ? '#1c1a17' : route.color }, g);
        if (isHome) el('circle', { r: 2, fill: '#fff' }, g);
        const label = el('text', { y: -14, class: 'gt-label' }, g);
        label.textContent = s.pl.name;
        // collision: hide labels that would overlap an already-placed one
        const lx = s.px.x, ly = s.px.y - 14;
        const clash = labelBoxes.some(b => Math.abs(b.x - lx) < 74 && Math.abs(b.y - ly) < 22);
        if (clash && !isHome) label.classList.add('clash');
        else labelBoxes.push({ x: lx, y: ly });
        // gather all stops at this place for the tooltip
        const here = stops.filter(x => x.place === key);
        const ev = here.map(x => x.eventId && window.EVENTS.find(e => e.id === x.eventId)).filter(Boolean);
        const tipHtml = `
          <div class="t-city">${s.pl.name}</div>
          ${ev.map(e => `<div class="t-ev">${e.name} · <span>${e.month}</span></div>`).join('') ||
            (s.label ? `<div class="t-ev">${s.label}</div>` : '')}
          ${ev.length ? '<div class="t-cta">Click to open event page →</div>' : ''}`;
        g.addEventListener('mousemove', e => showTip(e, tipHtml));
        g.addEventListener('mouseleave', hideTip);
        g.addEventListener('click', () => {
          hideTip();
          if (ev.length) state.onStopClick(ev[0].id);
          else if (isHome && window.revealFrances) window.revealFrances();
        });
      });

      // traveler: a plane following the whole journey via native SMIL
      // (compositor-driven — no per-frame JavaScript)
      if (totalLen > 0) {
        const journey = el('path', {
          id: journeyId, d: state.legs.map(L => L.line.getAttribute('d')).join(' '),
          fill: 'none', stroke: 'none',
        }, gTraveler);
        const trav = el('g', { class: 'gt-plane' }, gTraveler);
        el('circle', { r: 10, fill: route.color, opacity: 0.14 }, trav);
        el('path', {
          d: 'M 8 0 L -5 -5 L -2.4 -0.8 L -6.5 -0.8 L -8 -3 L -9.5 -3 L -8.6 0 L -9.5 3 L -8 3 L -6.5 0.8 L -2.4 0.8 L -5 5 Z',
          fill: '#1c1a17',
        }, trav);
        const motion = el('animateMotion', { dur: '30s', repeatCount: 'indefinite', rotate: 'auto' }, trav);
        el('mpath', { href: `#${journeyId}` }, motion);
        void journey;
      }
      syncMotion();
    }

    function syncMotion() {
      const run = state.playing && state.visible;
      try { run ? svg.unpauseAnimations() : svg.pauseAnimations(); } catch { /* SMIL unsupported */ }
    }

    return {
      setRoute,
      pause: () => { state.playing = false; syncMotion(); },
      play: () => { state.playing = true; syncMotion(); },
      isPlaying: () => state.playing,
      destroy: () => {},
    };
  }

  // ---- Mini map (detail pages): Zürich → event ------------------
  async function mini(container, placeKey, color = '#9c4b2f') {
    container.classList.add('gt-map', 'mini');
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'gt-map-svg', preserveAspectRatio: 'xMidYMid meet' }, container);
    const gLand = el('g', { class: 'gt-land' }, svg);
    el('path', { d: await loadLand(), class: 'gt-landpath' }, gLand);

    const zh = window.PLACES.zurich, pl = window.PLACES[placeKey] || zh;
    const a = proj(zh.lat, zh.lon), b = proj(pl.lat, pl.lon);
    if (placeKey !== 'zurich') {
      const { d } = legPath(a, b, 0.2);
      const line = el('path', { d, class: 'gt-leg fly', stroke: color, style: 'stroke-dasharray:7 7' }, svg);
      const len = line.getTotalLength();
      const under = el('path', { d, class: 'gt-leg-under', stroke: color }, svg);
      under.style.strokeDasharray = len; under.style.strokeDashoffset = len;
      under.style.transition = 'stroke-dashoffset 1.2s .3s ease-out';
      requestAnimationFrame(() => { under.style.strokeDashoffset = 0; });
    }
    for (const [pt, isHome] of [[a, true], [b, false]]) {
      const g = el('g', { class: 'gt-stop' + (isHome ? ' home' : ''), transform: `translate(${pt.x} ${pt.y})` }, svg);
      el('circle', { r: isHome ? 12 : 14, class: 'gt-pulse', stroke: color }, g);
      el('circle', { r: isHome ? 5 : 6.5, class: 'gt-dot', fill: isHome ? '#1c1a17' : color }, g);
      const t = el('text', { y: -16, class: 'gt-label big' }, g);
      t.textContent = isHome ? 'Zürich' : pl.name;
      if (placeKey === 'zurich' && isHome) break;
    }
  }

  return { create, mini };
})();
