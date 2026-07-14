/* ============================================================
   App: multi-page router, home, map, calendar (+grid view),
   routes, route builder, collection, playbook, event detail
   ============================================================ */

const DOSSIERS = {};   // id -> rich dossier json (or undefined if missing)
let mainMap = null;
let builderMap = null;
let currentRouteId = 'greatest-hits';
let calMode = 'editorial';

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* events + mountain destinations share detail pages, the builder and dossiers */
const ITEMS = window.EVENTS.concat(window.ADVENTURES.map(a =>
  ({ id: a.id, name: a.name, place: a.place, month: a.season, kind: a.activity, adventure: true })));
const eventById = id => ITEMS.find(e => e.id === id);
const photoOf = (id, i = 0) => DOSSIERS[id]?.photos?.[i]?.url || null;
const eventColor = id => window.EVENT_COLORS[Math.max(0, ITEMS.findIndex(e => e.id === id)) % window.EVENT_COLORS.length];

const KIND_LABEL = { arts: 'Arts & Music', festival: 'Festival', food: 'Food & Wine', sport: 'Sport',
  hiking: 'Hiking', skiing: 'Skiing', cycling: 'Road Cycling' };
const MODE_LABEL = { rail: 'Rail', fly: 'Fly', drive: 'Drive' };

/* ---------- date helpers & trip links ---------- */
const isoAdd = (iso, n) => {
  const d = parseISO(iso); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function planLinks(e, d) {
  const pl = window.PLACES[e.place];
  const span = window.CAL_DATES[e.id]?.[0] || null;
  const air = window.AIRPORTS[e.place];
  const links = [];
  if (air) {
    const q = `Flights from ZRH to ${air}` + (span ? ` on ${isoAdd(span[0], -1)} through ${isoAdd(span[1], 1)}` : '');
    links.push({ label: `Flights ZRH → ${air} (Google Flights)`, url: `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}` });
  }
  links.push({ label: 'Trains from Zürich (SBB)', url: `https://www.sbb.ch/en/timetable?von=${encodeURIComponent('Zürich HB')}&nach=${encodeURIComponent(pl.name)}${span ? `&datum=${span[0]}` : ''}` });
  const hotelQ = `${pl.name}${d?.country ? ', ' + d.country : ''}`;
  let hotelDates = '';
  if (span) {
    const nights = Math.min(3, Math.max(1, (parseISO(span[1]) - parseISO(span[0])) / 86400000 + 1));
    hotelDates = `&checkin=${span[0]}&checkout=${isoAdd(span[0], nights)}`;
  }
  links.push({ label: 'Hotels (Booking.com)', url: `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(hotelQ)}${hotelDates}&group_adults=2` });
  return links;
}

/* ---------- calendar export (.ics) ---------- */
function buildICS(entries) {
  const fmt = iso => iso.replace(/-/g, '');
  const escT = s => String(s).replace(/([,;])/g, '\\$1');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//A Year from Zurich//EN', 'CALSCALE:GREGORIAN'];
  for (const en of entries) {
    lines.push('BEGIN:VEVENT',
      `UID:${en.id}@ayearfromzurich`,
      `DTSTAMP:${fmt(en.start)}T000000Z`,
      `DTSTART;VALUE=DATE:${fmt(en.start)}`,
      `DTEND;VALUE=DATE:${fmt(isoAdd(en.end, 1))}`,
      `SUMMARY:${escT(en.title)}`,
      en.location ? `LOCATION:${escT(en.location)}` : '',
      en.desc ? `DESCRIPTION:${escT(en.desc)}` : '',
      'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.filter(Boolean).join('\r\n');
}
function downloadICS(filename, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/calendar' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------- live data: Swiss rail connections + weather ---------- */
async function loadTrains(el, e) {
  const pl = window.PLACES[e.place];
  const station = window.RAIL_STATIONS[e.place];
  if (!station || e.place === 'zurich') { el.remove(); return; }
  try {
    const r = await fetch(`https://transport.opendata.ch/v1/connections?from=${encodeURIComponent('Zürich HB')}&to=${encodeURIComponent(station)}&limit=3`);
    if (!r.ok) throw new Error();
    const j = await r.json();
    const cons = (j.connections || []).filter(c => c.duration && c.from?.departure);
    if (!cons.length) throw new Error();
    const hhmm = iso => iso.slice(11, 16);
    const dur = s => { const m = s.match(/(\d+)d(\d+):(\d+)/); if (!m) return s; const h = +m[1] * 24 + +m[2]; return `${h}h${m[3]}`; };
    // the page may have re-rendered while fetching — write to the live panel
    el = document.querySelector('#d-trains') || el;
    el.innerHTML = `<h3>Next trains, Zürich HB → ${esc(pl.name)}</h3>` + cons.map(c => `
      <div class="train-row">
        <span class="train-time">${hhmm(c.from.departure)} → ${hhmm(c.to.arrival)}</span>
        <span class="train-meta">${dur(c.duration)} · ${c.transfers === 0 ? 'direct' : c.transfers + ' change' + (c.transfers > 1 ? 's' : '')}</span>
      </div>`).join('') + '<div class="live-src">Live from transport.opendata.ch</div>';
  } catch { (document.querySelector('#d-trains') || el).remove(); }
}

async function loadForecast(el, e) {
  const pl = window.PLACES[e.place];
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${pl.lat}&longitude=${pl.lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=7`);
    if (!r.ok) throw new Error();
    const j = await r.json();
    const d = j.daily;
    if (!d?.time?.length) throw new Error();
    const day = iso => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][parseISO(iso).getDay()];
    el = document.querySelector('#d-weather-live') || el;
    el.innerHTML = '<h3>This week on the ground</h3><div class="wx-strip">' + d.time.map((t, i) => `
      <div class="wx-day">
        <span class="wx-name">${day(t)}</span>
        <span class="wx-hi">${Math.round(d.temperature_2m_max[i])}°</span>
        <span class="wx-lo">${Math.round(d.temperature_2m_min[i])}°</span>
        <span class="wx-rain">${d.precipitation_probability_max[i] ?? 0}%</span>
      </div>`).join('') + '</div><div class="live-src">Live from Open-Meteo · max / min °C / rain</div>';
  } catch { (document.querySelector('#d-weather-live') || el).remove(); }
}

/* researched date strings can be long sentences — trim for compact display */
function shortDates(s, max = 52) {
  if (!s) return '';
  let t = String(s).split(/[;(]/)[0].trim().replace(/[.,\s]+$/, '');
  if (t.length > max) t = t.slice(0, max).replace(/\s+\S*$/, '') + '…';
  return t;
}

/* ---------- data loading ---------- */
async function loadDossiers() {
  await Promise.allSettled(ITEMS.map(async e => {
    try {
      const r = await fetch(`data/events/${e.id}.json`);
      if (r.ok) DOSSIERS[e.id] = await r.json();
    } catch { /* dossier not written yet */ }
  }));
}

/* ---------- hero slideshow (home only) ---------- */
const HERO_PICKS = [
  { id: 'venice-carnival', i: 0 }, { id: 'keukenhof', i: 1 }, { id: 'white-turf', i: 1 },
  { id: 'semana-santa', i: 0 }, { id: 'palio-siena', i: 0 }, { id: 'strasbourg-christmas', i: 0 },
];
let heroTimer = null;
function startHero() {
  const slides = HERO_PICKS
    .map(p => ({ ...p, url: photoOf(p.id, p.i), ev: eventById(p.id) }))
    .filter(p => p.url);
  if (!slides.length) return;
  const box = $('#hero-slides'), cap = $('#hero-caption');
  box.innerHTML = slides.map(s => `<div class="hero-slide" style="background-image:url('${s.url}')"></div>`).join('');
  const els = [...box.children];
  let k = 0;
  const show = () => {
    els.forEach((el, j) => el.classList.toggle('on', j === k));
    const s = slides[k];
    cap.innerHTML = `<b>${esc(s.ev.name)}</b>${esc(window.PLACES[s.ev.place].name)} · ${esc(s.ev.month)}`;
    k = (k + 1) % els.length;
  };
  show();
  clearInterval(heroTimer);
  heroTimer = setInterval(show, 7000);
}
const stopHero = () => clearInterval(heroTimer);

/* ---------- hidden dedication ---------- */
function revealFrances() {
  const box = $('#frances-box');
  box.hidden = false;
  void box.offsetWidth; // flush styles so the fade-in still animates
  box.classList.add('on');
}
window.revealFrances = revealFrances;
function bindFrances() {
  $('#frances-box').addEventListener('click', () => {
    const box = $('#frances-box');
    box.classList.remove('on');
    setTimeout(() => { box.hidden = true; }, 350);
  });
  $('#frances-footer').addEventListener('click', revealFrances);
  $('#hero-dedication').addEventListener('click', revealFrances);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#frances-box').classList.remove('on'); });
}

/* ---------- reveal on scroll ---------- */
let revealObserver = null;
function observeReveals() {
  if (!revealObserver) {
    revealObserver = new IntersectionObserver(entries => {
      entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); revealObserver.unobserve(en.target); } });
    }, { threshold: 0.12 });
  }
  document.querySelectorAll('.rv:not(.in)').forEach(n => revealObserver.observe(n));
}

/* ---------- home ---------- */
const CHAPTERS = [
  { href: '#/map', title: 'The Map', sub: 'Three journeys drawn across Europe', photo: ['monaco-gp', 0] },
  { href: '#/calendar', title: 'The Calendar', sub: 'Thirteen months, headline by headline', photo: ['strasbourg-christmas', 0] },
  { href: '#/routes', title: 'The Routes', sub: 'Greatest Hits, Thrifty, Bucket-List', photo: ['alba-truffle', 0] },
  { href: '#/builder', title: 'Build a Route', sub: 'Compose your own year, stop by stop', photo: ['keukenhof', 0] },
  { href: '#/collection', title: 'The Collection', sub: 'Every dossier, one index', photo: ['las-fallas', 0] },
  { href: '#/playbook', title: 'The Playbook', sub: 'Clusters, savings and booking windows', photo: ['oktoberfest', 2] },
  { href: '#/outdoors', title: 'Mountains & Trails', sub: 'Hiking, skiing and road cycling — the Alps on your doorstep', photo: ['eiger-grindelwald', 0], wide: true },
];

function renderHome() {
  $('#chapter-grid').innerHTML = CHAPTERS.map(c => {
    const img = photoOf(c.photo[0], c.photo[1]) || photoOf(c.photo[0], 0);
    return `
    <a class="chapter rv ${c.wide ? 'wide' : ''}" href="${c.href}">
      ${img ? `<div class="chapter-img" style="background-image:url('${img}')"></div>` : ''}
      <div class="chapter-shade"></div>
      <div class="chapter-txt">
        <span class="chapter-title">${esc(c.title)}</span>
        <span class="chapter-sub">${esc(c.sub)}</span>
      </div>
    </a>`;
  }).join('');
  $('#home-months').innerHTML = window.MONTHS.slice(0, 3).map(monthCard).join('');
  observeReveals();
}

/* ---------- map page ---------- */
function renderRouteTabs() {
  const wrap = $('#route-tabs');
  wrap.innerHTML = window.ROUTES.map(r => `
    <button class="route-tab ${r.id === currentRouteId ? 'on' : ''}" data-route="${r.id}" style="--rc:${r.color}">
      <span class="dot"></span>${esc(r.name)}
    </button>`).join('');
  wrap.querySelectorAll('.route-tab').forEach(b => b.addEventListener('click', () => {
    currentRouteId = b.dataset.route;
    renderRouteTabs();
    applyRoute(true);
  }));
}

function applyRoute(animate) {
  const route = window.ROUTES.find(r => r.id === currentRouteId);
  if (mainMap) mainMap.setRoute(route, { animate });

  $('#route-meta').innerHTML = `
    <div class="rm-name">${esc(route.name)}</div>
    <div class="rm-tag">${esc(route.tag)}</div>
    <div class="rm-price" style="--rc:${route.color}">${esc(route.price)}</div>
    <p class="rm-blurb">${esc(route.blurb)}</p>`;

  const legs = $('#route-legs');
  legs.innerHTML = route.stops.map((s, i) => {
    const pl = window.PLACES[s.place];
    const ev = s.eventId && eventById(s.eventId);
    const next = route.stops[i + 1];
    return `
      <div class="leg ${ev ? 'clickable' : ''}" ${ev ? `data-ev="${ev.id}"` : ''} style="--rc:${route.color}">
        <div class="leg-rail">
          <span class="leg-node ${pl.type === 'home' ? 'home' : ''}"></span>
          ${next ? `<span class="leg-line"></span><span class="leg-mode">${MODE_LABEL[s.mode] || ''}</span>` : ''}
        </div>
        <div class="leg-body">
          <div class="leg-city">${esc(pl.name)}${pl.type === 'home' ? '<span class="home-chip">Home</span>' : ''}</div>
          <div class="leg-what">${ev ? esc(ev.name) : esc(s.label || '')}</div>
          <div class="leg-month">${esc(s.month || '')}</div>
        </div>
        ${ev ? '<div class="leg-go">→</div>' : ''}
      </div>`;
  }).join('');
  legs.querySelectorAll('.leg.clickable').forEach(n =>
    n.addEventListener('click', () => { location.hash = `#/event/${n.dataset.ev}`; }));
}

async function ensureMainMap() {
  if (!mainMap) {
    mainMap = await GrandTourMap.create($('#map-canvas'), {
      onStopClick: id => { location.hash = `#/event/${id}`; },
    });
    $('#play-toggle').addEventListener('click', () => {
      if (mainMap.isPlaying()) { mainMap.pause(); $('#play-toggle').textContent = 'Resume journey'; }
      else { mainMap.play(); $('#play-toggle').textContent = 'Pause journey'; }
    });
    applyRoute(true);
  }
}

/* ---------- calendar: editorial cards ---------- */
function monthCard(mo) {
  const head = eventById(mo.headline);
  const d = DOSSIERS[mo.headline];
  const img = photoOf(mo.headline);
  const alts = mo.alts.map(id => eventById(id)).filter(Boolean);
  return `
  <article class="mcard rv">
    <a class="mcard-hero" href="#/event/${head.id}">
      ${img ? `<div class="mcard-img" style="background-image:url('${img}')"></div>` : ''}
      <div class="mcard-shade"></div>
      <div class="mcard-onimg">
        <span class="mo-eyebrow">${esc(mo.label)} ${esc(mo.year)}${mo.note ? ' · ' + esc(mo.note) : ''}</span>
        <h3>${esc(head.name)}</h3>
      </div>
    </a>
    <div class="mcard-body">
      <div class="mcard-meta">
        <span class="badge">${esc(mo.badge)}</span>
        <span>${esc(shortDates(d?.dates) || head.month)}</span>
        <span>${esc(window.PLACES[head.place].name)}</span>
      </div>
      <p class="mcard-desc">${esc(mo.desc)}</p>
      ${alts.length ? `
      <div class="mcard-alts">
        <div class="lbl">Also this month</div>
        ${alts.map(a => `<a class="alt-link" href="#/event/${a.id}">${esc(a.name)} — ${esc(window.PLACES[a.place].name)} <span>→</span></a>`).join('')}
      </div>` : ''}
      ${mo.extraAlts?.length ? `<div class="mcard-extra">${mo.extraAlts.map(x => esc(x)).join('<br>')}</div>` : ''}
      ${mo.cluster ? `<div class="mcard-cluster"><b>Cluster tip</b> — ${esc(mo.cluster)}</div>` : ''}
      <div class="mcard-foot">
        ${mo.chips.map(c => `<span class="chip ${c.t}">${esc(c.v)}</span>`).join('')}
      </div>
    </div>
  </article>`;
}

function renderCalendar() {
  $('#months-grid').innerHTML = window.MONTHS.map(monthCard).join('');
  observeReveals();
}

/* ---------- calendar: grid view ---------- */
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const sameMonth = (dt, y, m) => dt.getFullYear() === y && dt.getMonth() === m;

function eventsInMonth(y, m) {
  const first = new Date(y, m, 1), last = new Date(y, m + 1, 0);
  const out = [];
  for (const [id, spans] of Object.entries(window.CAL_DATES)) {
    for (const [a, b] of spans) {
      const s = parseISO(a), e = parseISO(b);
      if (e >= first && s <= last) { out.push({ id, s, e }); break; }
    }
  }
  return out;
}

function renderCalGrid() {
  const months = window.MONTHS.map(mo => {
    const [y, m] = mo.key.split('-').map(Number);
    return { ...mo, y, m: m - 1 };
  });
  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  $('#cal-grid').innerHTML = months.map(mo => {
    const evs = eventsInMonth(mo.y, mo.m);
    const firstDow = (new Date(mo.y, mo.m, 1).getDay() + 6) % 7; // Monday start
    const days = new Date(mo.y, mo.m + 1, 0).getDate();
    let cells = '';
    for (let i = 0; i < firstDow; i++) cells += '<div class="cal-day empty"></div>';
    for (let d = 1; d <= days; d++) {
      const dt = new Date(mo.y, mo.m, d);
      const hits = evs.filter(x => {
        return window.CAL_DATES[x.id].some(([a, b]) => dt >= parseISO(a) && dt <= parseISO(b));
      });
      const bars = hits.slice(0, 3).map(h =>
        `<i style="background:${eventColor(h.id)}"></i>`).join('');
      const names = hits.map(h => eventById(h.id).name).join(' · ');
      const isMoveIn = mo.y === 2026 && mo.m === 7 && d === 9; // Aug 9, 2026 — the year begins
      cells += `
        <div class="cal-day${hits.length ? ' has' : ''}${isMoveIn ? ' frances-day' : ''}" ${hits.length ? `data-ev="${hits[0].id}" title="${esc(names)}"` : isMoveIn ? 'title="The year begins"' : ''}>
          <span>${d}</span>${bars ? `<div class="cal-bars">${bars}</div>` : isMoveIn ? '<div class="cal-bars"><i class="frances-dot"></i></div>' : ''}
        </div>`;
    }
    return `
    <div class="cal-month">
      <div class="cal-month-head">
        <h3>${esc(mo.label)} <span>${esc(mo.year)}</span></h3>
      </div>
      <div class="cal-days-head">${DOW.map(d => `<div>${d}</div>`).join('')}</div>
      <div class="cal-days">${cells}</div>
      ${evs.length ? `<div class="cal-legend">
        ${evs.map(x => `<a href="#/event/${x.id}"><i style="background:${eventColor(x.id)}"></i>${esc(eventById(x.id).name)}</a>`).join('')}
      </div>` : '<div class="cal-legend quiet">A quiet month — explore Switzerland</div>'}
    </div>`;
  }).join('');
  document.querySelectorAll('.cal-day.has').forEach(n =>
    n.addEventListener('click', () => { location.hash = `#/event/${n.dataset.ev}`; }));
  document.querySelectorAll('.cal-day.frances-day:not(.has)').forEach(n =>
    n.addEventListener('click', revealFrances));
}

function bindCalToggle() {
  $('#cal-toggle').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    calMode = b.dataset.mode;
    $('#cal-toggle').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    $('#months-grid').style.display = calMode === 'editorial' ? '' : 'none';
    $('#cal-grid').style.display = calMode === 'grid' ? '' : 'none';
    if (calMode === 'grid') renderCalGrid();
  }));
}

/* ---------- routes page ---------- */
function renderRoutesPage() {
  $('#route-cards').innerHTML = window.ROUTES.map((r, i) => `
    <div class="rcard" style="--rc:${r.color}">
      <div class="rcard-num">Route ${['One', 'Two', 'Three'][i]}</div>
      <h3>${esc(r.name)}</h3>
      <div class="tag">${esc(r.tag)}</div>
      <p>${esc(r.blurb)}</p>
      <div class="price">${esc(r.price)}</div>
      <ul>${r.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>
      <button class="rcard-btn" data-route="${r.id}">View on the map</button>
    </div>`).join('');
  document.querySelectorAll('.rcard-btn').forEach(b => b.addEventListener('click', () => {
    currentRouteId = b.dataset.route;
    location.hash = '#/map';
  }));
}

/* ---------- builder ---------- */
const BUILDER_KEY = 'gt-builder-route';
let builderStops = [];
try { builderStops = JSON.parse(localStorage.getItem(BUILDER_KEY) || '[]').filter(id => eventById(id)); } catch { builderStops = []; }

const havKm = (a, b) => {
  const R = 6371, toR = x => x * Math.PI / 180;
  const dLat = toR(b.lat - a.lat), dLon = toR(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const legMode = km => km < 420 ? 'rail' : 'fly';
const legCost = km => legMode(km) === 'rail' ? Math.round(km * 0.16) : Math.round(60 + km * 0.09);
const legTime = km => legMode(km) === 'rail' ? km / 105 : 1.6 + km / 700;
const fmtH = h => { const H = Math.floor(h), M = Math.round((h - H) * 60); return H ? `${H}h${M ? String(M).padStart(2, '0') : ''}` : `${M}m`; };

function builderRoute() {
  const stops = [{ place: 'zurich', label: 'Home base', month: '', mode: 'rail' }];
  builderStops.forEach(id => {
    const e = eventById(id);
    stops.push({ place: e.place, eventId: id, month: e.month, mode: 'fly' });
  });
  stops.push({ place: 'zurich', label: 'Home', month: '', mode: null });
  // set real modes by distance
  for (let i = 0; i < stops.length - 1; i++) {
    const a = window.PLACES[stops[i].place], b = window.PLACES[stops[i + 1].place];
    stops[i].mode = legMode(havKm(a, b));
  }
  return { id: 'custom', name: 'Your route', color: '#9c4b2f', accent: '#c98a6e', stops };
}

function saveBuilder() { localStorage.setItem(BUILDER_KEY, JSON.stringify(builderStops)); }

function renderBuilder() {
  // catalog grouped by month, plus mountains & trails
  const groups = window.MONTHS.map(mo => ({
    label: `${mo.label} ${mo.year}`,
    evs: window.EVENTS.filter(e => e.month === `${mo.label.slice(0, 3)} ${mo.year}`),
  })).filter(g => g.evs.length);
  groups.push({ label: 'Mountains & Trails', evs: ITEMS.filter(e => e.adventure) });
  $('#builder-catalog').innerHTML = groups.map(g => `
    <div class="bcat-group">
      <div class="bcat-month">${esc(g.label)}</div>
      ${g.evs.map(e => {
        const added = builderStops.includes(e.id);
        return `
        <div class="bcat-row ${added ? 'added' : ''}">
          <div class="bcat-txt">
            <span class="bcat-name">${esc(e.name)}</span>
            <span class="bcat-place">${esc(window.PLACES[e.place].name)}</span>
          </div>
          <button class="bcat-btn" data-id="${e.id}">${added ? 'Added' : 'Add'}</button>
        </div>`;
      }).join('')}
    </div>`).join('');
  $('#builder-catalog').querySelectorAll('.bcat-btn').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.id;
    if (!builderStops.includes(id)) { builderStops.push(id); saveBuilder(); refreshBuilder(); }
  }));

  // route list
  const route = builderRoute();
  const rows = [];
  route.stops.forEach((s, i) => {
    const pl = window.PLACES[s.place];
    const ev = s.eventId && eventById(s.eventId);
    const next = route.stops[i + 1];
    let legInfo = '';
    if (next) {
      const km = havKm(pl, window.PLACES[next.place]);
      if (km > 1) legInfo = `<div class="bleg-info">${MODE_LABEL[s.mode]} · ${Math.round(km)} km · ~${fmtH(legTime(km))} · ~€${legCost(km)}</div>`;
    }
    const k = ev ? builderStops.indexOf(s.eventId) : -1;
    rows.push(`
      <div class="bleg">
        <div class="leg-rail">
          <span class="leg-node ${pl.type === 'home' ? 'home' : ''}" style="--rc:#9c4b2f"></span>
          ${next ? '<span class="leg-line"></span>' : ''}
        </div>
        <div class="leg-body">
          <div class="leg-city">${esc(pl.name)}${pl.type === 'home' ? '<span class="home-chip">Home</span>' : ''}</div>
          ${ev ? `<a class="leg-what" href="#/event/${ev.id}">${esc(ev.name)} · ${esc(ev.month)}</a>` : `<div class="leg-what">${esc(s.label || '')}</div>`}
          ${legInfo}
        </div>
        ${ev ? `
        <div class="bleg-ctl">
          <button data-act="up" data-i="${k}" ${k === 0 ? 'disabled' : ''}>↑</button>
          <button data-act="down" data-i="${k}" ${k === builderStops.length - 1 ? 'disabled' : ''}>↓</button>
          <button data-act="rm" data-i="${k}">×</button>
        </div>` : ''}
      </div>`);
  });
  $('#builder-legs').innerHTML = builderStops.length
    ? rows.join('')
    : '<p class="builder-empty">No stops yet — add events from the list to draw your journey.</p>';
  $('#builder-legs').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    const i = Number(b.dataset.i), act = b.dataset.act;
    if (act === 'rm') builderStops.splice(i, 1);
    if (act === 'up' && i > 0) [builderStops[i - 1], builderStops[i]] = [builderStops[i], builderStops[i - 1]];
    if (act === 'down' && i < builderStops.length - 1) [builderStops[i + 1], builderStops[i]] = [builderStops[i], builderStops[i + 1]];
    saveBuilder(); refreshBuilder();
  }));

  // stats
  let km = 0, cost = 0;
  for (let i = 0; i < route.stops.length - 1; i++) {
    const d = havKm(window.PLACES[route.stops[i].place], window.PLACES[route.stops[i + 1].place]);
    if (d > 1) { km += d; cost += legCost(d); }
  }
  $('#builder-stats').textContent = builderStops.length
    ? `${builderStops.length} stop${builderStops.length > 1 ? 's' : ''} · ${Math.round(km).toLocaleString('en')} km · ~€${cost.toLocaleString('en')} transport, rough`
    : 'Add stops to see distance & cost';

  if (builderMap) builderMap.setRoute(builderRoute(), { animate: true });
}

function refreshBuilder() { renderBuilder(); }

async function ensureBuilderMap() {
  if (!builderMap) {
    builderMap = await GrandTourMap.create($('#builder-map'), {
      onStopClick: id => { location.hash = `#/event/${id}`; },
    });
  }
  renderBuilder();
}

$('#builder-clear').addEventListener('click', () => {
  builderStops = []; saveBuilder(); refreshBuilder();
});
$('#builder-share').addEventListener('click', () => {
  const url = `${location.origin}${location.pathname}#/builder/${builderStops.join(',')}`;
  const done = () => {
    $('#builder-share').textContent = 'Link copied';
    setTimeout(() => { $('#builder-share').textContent = 'Share route'; }, 1800);
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done, () => prompt('Copy this link:', url));
  else prompt('Copy this link:', url);
});
$('#builder-ics').addEventListener('click', () => {
  const entries = [];
  builderStops.forEach(id => {
    const e = eventById(id);
    (window.CAL_DATES[id] || []).forEach(([a, b], i) => entries.push({
      id: `${id}-${i}`, start: a, end: b, title: e.name,
      location: window.PLACES[e.place].name, desc: DOSSIERS[id]?.tagline || '',
    }));
  });
  if (entries.length) downloadICS('my-grand-tour.ics', buildICS(entries));
});

/* ---------- outdoors: mountains & trails ---------- */
let outdoorsFilter = 'all';
function renderOutdoors() {
  const acts = ['all', 'hiking', 'skiing', 'cycling'];
  $('#outdoors-filters').innerHTML = acts.map(k => `
    <button class="cfilter ${outdoorsFilter === k ? 'on' : ''}" data-kind="${k}">
      ${k === 'all' ? 'All' : esc(KIND_LABEL[k])}
    </button>`).join('');
  $('#outdoors-filters').querySelectorAll('.cfilter').forEach(b => b.addEventListener('click', () => {
    outdoorsFilter = b.dataset.kind;
    renderOutdoors();
  }));

  const list = window.ADVENTURES.filter(a => outdoorsFilter === 'all' || a.activity === outdoorsFilter);
  $('#outdoors-grid').innerHTML = list.map(a => {
    const d = DOSSIERS[a.id];
    const img = photoOf(a.id);
    const travel = d?.gettingThere?.[0];
    return `
    <a class="ctile" href="#/event/${a.id}">
      <div class="ctile-imgwrap">
        ${img ? `<div class="ctile-img" style="background-image:url('${img}')"></div>` : ''}
      </div>
      <div class="ctile-body">
        <div class="ctile-kind">${esc(KIND_LABEL[a.activity])} · ${esc(window.PLACES[a.place].name)}${d?.country ? ', ' + esc(d.country) : ''}</div>
        <h3>${esc(a.name)}</h3>
        <div class="ctile-meta">${esc(a.season)}${travel ? ` · ${esc(MODE_LABEL[travel.mode] || '')} ${esc(travel.duration)} from Zürich` : ''}</div>
        ${d?.tagline ? `<p class="ctile-tag">${esc(d.tagline)}</p>` : ''}
        <span class="ctile-cta">Read the dossier</span>
      </div>
    </a>`;
  }).join('');
}

/* ---------- collection & playbook ---------- */
let collectionFilter = 'all';
function renderCollection() {
  const kinds = ['all', 'festival', 'arts', 'sport', 'food'];
  $('#collection-filters').innerHTML = kinds.map(k => `
    <button class="cfilter ${collectionFilter === k ? 'on' : ''}" data-kind="${k}">
      ${k === 'all' ? 'All events' : esc(KIND_LABEL[k])}
    </button>`).join('');
  $('#collection-filters').querySelectorAll('.cfilter').forEach(b => b.addEventListener('click', () => {
    collectionFilter = b.dataset.kind;
    renderCollection();
  }));

  const list = window.EVENTS.filter(e => collectionFilter === 'all' || e.kind === collectionFilter);
  $('#all-events').innerHTML = list.map(e => {
    const d = DOSSIERS[e.id];
    const img = photoOf(e.id);
    const travel = d?.gettingThere?.[0];
    return `
    <a class="ctile" href="#/event/${e.id}">
      <div class="ctile-imgwrap">
        ${img ? `<div class="ctile-img" style="background-image:url('${img}')"></div>` : ''}
      </div>
      <div class="ctile-body">
        <div class="ctile-kind">${esc(KIND_LABEL[e.kind] || 'Event')} · ${esc(window.PLACES[e.place].name)}${d?.country ? ', ' + esc(d.country) : ''}</div>
        <h3>${esc(e.name)}</h3>
        <div class="ctile-meta">${esc(shortDates(d?.dates) || e.month)}${travel ? ` · ${esc(MODE_LABEL[travel.mode] || '')} ${esc(travel.duration)} from Zürich` : ''}</div>
        ${d?.tagline ? `<p class="ctile-tag">${esc(d.tagline)}</p>` : ''}
        <span class="ctile-cta">Read the dossier</span>
      </div>
    </a>`;
  }).join('');
}

function renderPlaybook() {
  $('#clusters').innerHTML = window.CLUSTERS.map(c => `<li><b>${esc(c.name)}</b> — ${esc(c.desc)}</li>`).join('');
  $('#savings').innerHTML = window.SAVINGS.map(c => `<li><b>${esc(c.name)}</b> — ${esc(c.desc)}</li>`).join('');
  $('#book-table').innerHTML = `
    <tr><th>Event</th><th>When</th><th>Why book early</th><th></th></tr>` +
    window.BOOK_EARLY.map(b => `
      <tr>
        <td>${esc(b.event)}</td><td>${esc(b.when)}</td><td>${esc(b.why)}</td>
        <td><a class="book-link" href="#/event/${b.id}">Details</a></td>
      </tr>`).join('');
}

/* ---------- detail page ---------- */
function renderDetail(id) {
  const e = eventById(id);
  const root = $('#detail');
  if (!e) { root.innerHTML = '<div class="wrap"><p class="missing">Event not found. <a href="#/collection">Back to the collection</a></p></div>'; return; }
  const d = DOSSIERS[id];
  const pl = window.PLACES[e.place];
  const idx = window.EVENTS.indexOf(e);
  const prev = window.EVENTS[(idx - 1 + window.EVENTS.length) % window.EVENTS.length];
  const next = window.EVENTS[(idx + 1) % window.EVENTS.length];
  const img = d?.photos?.[0]?.url;
  const inBuilder = builderStops.includes(id);

  root.innerHTML = `
  <div class="d-hero" ${img ? `style="background-image:url('${img}')"` : ''}>
    <div class="d-hero-shade"></div>
    <div class="wrap">
      <a class="d-back" href="#/collection" id="d-back">Back</a>
      <div class="d-kind">${esc(KIND_LABEL[e.kind] || 'Event')} · ${esc(pl.name)}${d?.country ? ', ' + esc(d.country) : ''}</div>
      <h1>${esc(d?.name || e.name)}</h1>
      <p class="d-tagline">${esc(d?.tagline || '')}</p>
      <div class="d-chips">
        <span class="chip">${esc(shortDates(d?.dates, 64) || e.month)}</span>
        ${d?.gettingThere?.[0] ? `<span class="chip">${esc(MODE_LABEL[d.gettingThere[0].mode] || 'Travel')} · ${esc(d.gettingThere[0].duration)} from Zürich</span>` : ''}
        ${d?.costs?.midrange ? `<span class="chip">${esc(d.costs.midrange)} mid-range</span>` : ''}
      </div>
    </div>
  </div>
  <div class="wrap d-cols">
    <div class="d-main">
      ${d ? `
      <section class="d-sec"><span class="eyebrow">Why go</span><p class="d-why">${esc(d.whyGo)}</p></section>
      <section class="d-sec"><span class="eyebrow">The story</span><h2>A little history</h2>${(d.history || []).map(p => `<p>${esc(p)}</p>`).join('')}</section>
      <section class="d-sec">
        <span class="eyebrow">Logistics</span><h2>Getting there from Zürich</h2>
        <div class="gt-cards">
          ${(d.gettingThere || []).map(g => `
            <div class="gt-card">
              <div class="gt-mode">${esc(MODE_LABEL[g.mode] || 'Travel')}</div>
              <div class="gt-route">${esc(g.route)}</div>
              <div class="gt-nums"><span>${esc(g.duration)}</span><span>${esc(g.cost)}</span></div>
              ${g.notes ? `<div class="gt-notes">${esc(g.notes)}</div>` : ''}
            </div>`).join('')}
        </div>
      </section>
      <section class="d-sec">
        <span class="eyebrow">Budget</span><h2>What it costs</h2>
        <div class="cost-tiers">
          <div class="tier"><div class="t-name">Thrifty</div><div class="t-val">${esc(d.costs?.thrifty || '—')}</div></div>
          <div class="tier mid"><div class="t-name">Mid-range</div><div class="t-val">${esc(d.costs?.midrange || '—')}</div></div>
          <div class="tier"><div class="t-name">Splurge</div><div class="t-val">${esc(d.costs?.splurge || '—')}</div></div>
        </div>
        ${d.costs?.notes ? `<p class="cost-notes">${esc(d.costs.notes)}</p>` : ''}
      </section>
      <section class="d-sec">
        <span class="eyebrow">Know before you go</span><h2>Insider tips</h2>
        <ul class="tips">${(d.tips || []).map(t => `<li>${esc(t)}</li>`).join('')}</ul>
      </section>
      <section class="d-sec">
        <span class="eyebrow">While you're there</span><h2>Eat, drink, wander</h2>
        <div class="recs">
          ${(d.localRecs || []).map(r => `
            <div class="rec"><div class="rec-type">${esc(r.type)}</div><div class="rec-name">${esc(r.name)}</div><div class="rec-note">${esc(r.note)}</div></div>`).join('')}
        </div>
      </section>
      ${d.photos?.length > 1 ? `
      <section class="d-sec">
        <span class="eyebrow">In pictures</span><h2>Gallery</h2>
        <div class="gallery">
          ${d.photos.map(p => `
            <figure><div class="g-imgwrap"><img src="${p.url}" alt="${esc(p.caption)}" loading="lazy" onerror="this.closest('figure').remove()"></div>
            <figcaption>${esc(p.caption)}${p.credit ? ` — <span>${esc(p.credit)}</span>` : ''}</figcaption></figure>`).join('')}
        </div>
      </section>` : ''}
      ` : `
      <section class="d-sec"><h2>Dossier being researched</h2>
        <p>The research agents haven't filed this one yet. Meanwhile: <b>${esc(e.name)}</b> in ${esc(pl.name)}, ${esc(e.month)}. Refresh in a minute.</p>
      </section>`}
    </div>
    <aside class="d-side">
      <div class="d-panel">
        <h3>From your door in Zürich</h3>
        <div id="mini-map"></div>
        <div class="d-weather">${d?.weather ? esc(d.weather) : ''}</div>
      </div>
      <div class="d-panel">
        <h3>Plan this trip</h3>
        ${planLinks(e, d).map(b => `<a class="d-booklink" href="${b.url}" target="_blank" rel="noopener">${esc(b.label)}</a>`).join('')}
        ${window.CAL_DATES[id] ? `<button class="rcard-btn builder-add" id="d-ics">Add to calendar (.ics)</button>` : ''}
      </div>
      <div class="d-panel" id="d-trains"></div>
      <div class="d-panel" id="d-weather-live"></div>
      ${d?.booking?.length ? `
      <div class="d-panel">
        <h3>Booking & official links</h3>
        ${d.booking.map(b => `<a class="d-booklink" href="${b.url}" target="_blank" rel="noopener">${esc(b.label)}</a>`).join('')}
      </div>` : ''}
      <div class="d-panel">
        <h3>On your routes</h3>
        ${window.ROUTES.filter(r => r.stops.some(s => s.eventId === id)).map(r =>
          `<div class="rt-pill" style="--rc:${r.color}"><span class="dot"></span>${esc(r.name)}</div>`).join('') || '<div class="rt-none">Optional add-on — not on a default route.</div>'}
        <button class="rcard-btn builder-add" id="d-add-builder">${inBuilder ? 'In your route — view it' : 'Add to your route'}</button>
      </div>
    </aside>
  </div>
  <div class="wrap d-nav">
    <a href="#/event/${prev.id}" class="d-navlink">← ${esc(prev.name)}</a>
    <a href="#/event/${next.id}" class="d-navlink next">${esc(next.name)} →</a>
  </div>`;

  $('#d-back').addEventListener('click', ev => {
    if (history.length > 1) { ev.preventDefault(); history.back(); }
  });
  $('#d-add-builder').addEventListener('click', () => {
    if (!builderStops.includes(id)) { builderStops.push(id); saveBuilder(); }
    location.hash = '#/builder';
  });
  const icsBtn = $('#d-ics');
  if (icsBtn) icsBtn.addEventListener('click', () => {
    const spans = window.CAL_DATES[id];
    downloadICS(`${id}.ics`, buildICS(spans.map(([a, b], i) => ({
      id: `${id}-${i}`, start: a, end: b, title: d?.name || e.name,
      location: `${pl.name}${d?.country ? ', ' + d.country : ''}`,
      desc: d?.tagline || '',
    }))));
  });

  // live data (fail silently — panels remove themselves)
  loadTrains($('#d-trains'), e);
  loadForecast($('#d-weather-live'), e);

  GrandTourMap.mini($('#mini-map'), e.place, '#9c4b2f');
}

/* ---------- router ---------- */
const VIEWS = ['v-home', 'v-map', 'v-calendar', 'v-routes', 'v-builder', 'v-outdoors', 'v-collection', 'v-playbook', 'detail'];

function show(viewId) {
  VIEWS.forEach(v => { $('#' + v).style.display = v === viewId ? '' : 'none'; });
}

function setNav(page, transparent) {
  const nav = $('#topnav');
  nav.classList.toggle('over-photo', !!transparent);
  document.querySelectorAll('.topnav-links a').forEach(a =>
    a.classList.toggle('active', a.dataset.nav === page));
  onScroll();
}

function route() {
  const h = location.hash || '#/';
  const mEv = h.match(/^#\/event\/([\w-]+)/);
  stopHero();
  if (mainMap) mainMap.pause();
  if ($('#play-toggle')) $('#play-toggle').textContent = 'Pause journey';

  if (mEv) {
    show('detail');
    renderDetail(mEv[1]);
    setNav(null, true);
  } else if (h.startsWith('#/map')) {
    show('v-map');
    setNav('map', false);
    ensureMainMap().then(() => { mainMap.play(); applyRoute(true); });
  } else if (h.startsWith('#/calendar')) {
    show('v-calendar');
    setNav('calendar', false);
    if (calMode === 'grid') renderCalGrid();
  } else if (h.startsWith('#/routes')) {
    show('v-routes');
    setNav('routes', false);
  } else if (h.startsWith('#/builder')) {
    const shared = h.match(/^#\/builder\/([\w,-]+)/);
    if (shared) {
      const ids = shared[1].split(',').filter(id => eventById(id));
      if (ids.length && ids.join(',') !== builderStops.join(',')) { builderStops = ids; saveBuilder(); }
    }
    show('v-builder');
    setNav('builder', false);
    ensureBuilderMap();
  } else if (h.startsWith('#/outdoors')) {
    show('v-outdoors');
    setNav('outdoors', false);
  } else if (h.startsWith('#/collection')) {
    show('v-collection');
    setNav('collection', false);
  } else if (h.startsWith('#/playbook')) {
    show('v-playbook');
    setNav('playbook', false);
  } else {
    show('v-home');
    setNav(null, true);
    startHero();
  }
  window.scrollTo({ top: 0 });
}

/* ---------- nav scroll state ---------- */
function onScroll() {
  const nav = $('#topnav');
  if (!nav.classList.contains('over-photo')) { nav.classList.add('solid'); return; }
  const threshold = location.hash.startsWith('#/event/') ? window.innerHeight * 0.55 : window.innerHeight - 120;
  nav.classList.toggle('solid', window.scrollY > threshold);
}

/* ---------- boot ---------- */
(async function init() {
  bindFrances();
  renderHome();
  renderCalendar();
  bindCalToggle();
  renderRouteTabs();
  renderRoutesPage();
  renderCollection();
  renderOutdoors();
  renderPlaybook();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('hashchange', route);
  route();

  await loadDossiers();  // re-render photo-dependent pieces
  renderHome();
  renderCalendar();
  renderCollection();
  renderOutdoors();
  route();
})();
