/* ============================================================
   App: multi-page router, home, map, calendar (+grid view),
   routes, route builder, collection, playbook, event detail
   ============================================================ */

const DOSSIERS = {};   // id -> rich dossier json (or undefined if missing)
let mainMap = null;
let builderMap = null;
let currentRouteId = 'greatest-hits';
let calMode = 'editorial';
const RESEARCH_VERIFIED_ON = '13 July 2026';

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const searchText = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const vibeRank = (query, items) => {
  if (!query.trim() || !window.VibeSearch) return [];
  const allowed = new Set(items.map(item => item.id));
  const ranked = window.VibeSearch.search(query, {
    reindex: true, dossiers: DOSSIERS, places: window.PLACES,
    railStations: window.RAIL_STATIONS, airports: window.AIRPORTS,
  }).results;
  return ranked.filter(result => allowed.has(result.item.id) && result.score > 38);
};
const vibeReasons = result => (result?.reasons || []).slice(0, 3).map(reason => reason
  .replace('food: high', 'food-forward')
  .replace('culture: high', 'culture-rich')
  .replace('nature: high', 'strong nature')
  .replace('adventure: high', 'adventurous')
  .replace('romance: high', 'romantic')
  .replace('family: high', 'family-friendly')
  .replace('travel: rail', 'works by rail')
  .replace('crowd: quiet', 'quieter atmosphere')
  .replace('intensity: relaxed', 'relaxed pace'));
const vibeChips = result => {
  const reasons = vibeReasons(result);
  return reasons.length ? `<div class="match-reasons" aria-label="Why this matched">${reasons.map(reason => `<span>${esc(reason)}</span>`).join('')}</div>` : '';
};

/* events + mountain destinations share detail pages, the builder and dossiers */
const ITEMS = window.EVENTS.concat(window.ADVENTURES.map(a =>
  ({ id: a.id, name: a.name, place: a.place, month: a.season, kind: a.activity, adventure: true })));
const eventById = id => ITEMS.find(e => e.id === id);
const photoOf = (id, i = 0) => DOSSIERS[id]?.photos?.[i]?.url || null;
const eventColor = id => window.EVENT_COLORS[Math.max(0, ITEMS.findIndex(e => e.id === id)) % window.EVENT_COLORS.length];

const KIND_LABEL = { arts: 'Arts & Music', festival: 'Festival', food: 'Food & Wine', sport: 'Sport',
  hiking: 'Hiking', skiing: 'Skiing', cycling: 'Cycling', gravel: 'Gravel & Bikepacking',
  climbing: 'Climbing & Via Ferrata', water: 'Water & Paddling', trail: 'Trail Running' };
const MODE_LABEL = { rail: 'Rail', fly: 'Fly', drive: 'Drive' };

/* ---------- three-way comparison ---------- */
const COMPARE_KEY = 'gt-compare';
let compareIds = [];
try { compareIds = JSON.parse(localStorage.getItem(COMPARE_KEY) || '[]').filter(id => eventById(id)).slice(0, 3); } catch { compareIds = []; }

function saveCompare() { localStorage.setItem(COMPARE_KEY, JSON.stringify(compareIds)); }
function compareButton(id) {
  const selected = compareIds.includes(id);
  const full = compareIds.length >= 3 && !selected;
  return `<button type="button" class="compare-toggle${selected ? ' on' : ''}" data-compare="${esc(id)}" aria-pressed="${selected}" ${full ? 'disabled' : ''}>${selected ? 'Selected' : full ? '3 selected' : 'Compare'}</button>`;
}
function bindCompareButtons(root) {
  root.querySelectorAll('[data-compare]').forEach(button => button.addEventListener('click', () => {
    const id = button.dataset.compare;
    if (compareIds.includes(id)) compareIds = compareIds.filter(itemId => itemId !== id);
    else if (compareIds.length < 3) compareIds.push(id);
    saveCompare();
    renderCompareTray();
    renderCollection();
    renderOutdoors();
  }));
}
function renderCompareTray() {
  const tray = $('#compare-tray');
  tray.hidden = compareIds.length === 0;
  $('#compare-items').innerHTML = compareIds.map(id => {
    const item = eventById(id);
    return `<span>${esc(item?.name || id)}<button type="button" data-remove-compare="${esc(id)}" aria-label="Remove ${esc(item?.name || id)}">×</button></span>`;
  }).join('');
  $('#compare-open').disabled = compareIds.length < 2;
  $('#compare-items').querySelectorAll('[data-remove-compare]').forEach(button => button.addEventListener('click', () => {
    compareIds = compareIds.filter(id => id !== button.dataset.removeCompare);
    saveCompare(); renderCompareTray(); renderCollection(); renderOutdoors();
  }));
}
function renderCompareDialog() {
  const items = compareIds.map(id => eventById(id)).filter(Boolean);
  const cell = value => `<td>${value || '—'}</td>`;
  const row = (label, values) => `<tr><th scope="row">${esc(label)}</th>${values.map(cell).join('')}</tr>`;
  $('#compare-table').innerHTML = `
    <thead><tr><th></th>${items.map(item => `<th scope="col"><a href="#/event/${item.id}">${esc(item.name)}</a></th>`).join('')}</tr></thead>
    <tbody>
      ${row('Where', items.map(item => esc(window.PLACES[item.place]?.name)))}
      ${row('When', items.map(item => esc(shortDates(DOSSIERS[item.id]?.dates) || item.month)))}
      ${row('Type', items.map(item => esc(KIND_LABEL[item.kind] || item.kind)))}
      ${row('From Zürich', items.map(item => { const leg = DOSSIERS[item.id]?.gettingThere?.[0]; return leg ? `${esc(MODE_LABEL[leg.mode] || 'Travel')} · ${esc(leg.duration)}` : '—'; }))}
      ${row('Thrifty', items.map(item => esc(DOSSIERS[item.id]?.costs?.thrifty)))}
      ${row('Mid-range', items.map(item => esc(DOSSIERS[item.id]?.costs?.midrange)))}
      ${row('Pace', items.map(item => esc(window.VibeSearch?.metadata(item.id)?.intensity)))}
      ${row('Atmosphere', items.map(item => esc(window.VibeSearch?.metadata(item.id)?.crowd)))}
    </tbody>`;
}

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

/* ---------- Swiss rail hub ---------- */
const railAdvice = {
  fixed: {
    eyebrow: 'Lowest price, least flexibility',
    title: 'Compare a normal point-to-point ticket with Supersaver.',
    text: 'Use this when you can commit to a specific connection. Supersaver availability and conditions are shown in the live SBB purchase flow; do not assume the same discount exists on a later train.',
    label: 'Compare on SBB', url: 'https://www.sbb.ch/en/offers/find-saver-offers',
  },
  flexible: {
    eyebrow: 'A network day',
    title: 'Price a Saver Day Pass before stacking individual legs.',
    text: 'This is the useful comparison for a full day with several Swiss trains or uncertain return timing. The pass is capacity-priced, so the live date and your Half Fare status matter.',
    label: 'Saver Day Pass', url: 'https://www.sbb.ch/en/offers/saver-day-pass',
  },
  frequent: {
    eyebrow: 'Resident economics',
    title: 'Model the year, not just the weekend.',
    text: 'If Zürich is home, compare the Half Fare Travelcard and GA against your expected annual travel. The right answer depends on recurring local journeys as much as the glamorous international ones.',
    label: 'SBB travelcards', url: 'https://www.sbb.ch/en/offers/half-fare-travelcard-benefits',
  },
  visitor: {
    eyebrow: 'Guests resident abroad',
    title: 'Swiss Travel Pass is a visitor product—not a default resident pass.',
    text: 'It bundles broad Swiss travel and selected benefits for eligible visitors. Check residence eligibility, duration, mountain-rail inclusions and reservation extras before comparing it with ordinary tickets.',
    label: 'Swiss Travel Pass', url: 'https://www.sbb.ch/en/offers/swiss-travel-pass',
  },
  international: {
    eyebrow: 'One journey, several fare systems',
    title: 'Start with one through-ticket, then compare splits carefully.',
    text: 'A through-ticket can protect connections better than separate bargains. Sales windows, bike carriage and compulsory reservations change after the border; verify every operator on the actual itinerary.',
    label: 'SBB Europe', url: 'https://www.sbb.ch/en/help-and-contact/products-services/tickets/europe/tickets.html',
  },
  night: {
    eyebrow: 'Distance while you sleep',
    title: 'Choose the berth first, then build the journey around it.',
    text: 'Night-train reservations are compulsory and sleeping inventory sells independently by date. Check boarding time, compartment type, bike acceptance and morning arrival before treating it as a hotel replacement.',
    label: 'Night trains from Switzerland', url: 'https://www.sbb.ch/en/leisure-holidays/europe/night-trains/nightjet.html',
  },
};

function updateRailClock() {
  const clock = $('#rail-clock');
  if (!clock) return;
  clock.textContent = new Intl.DateTimeFormat('de-CH', {
    timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
}

function initializeRailForm() {
  const dateInput = $('#rail-date'), timeInput = $('#rail-time');
  if (!dateInput || !timeInput) return;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  dateInput.value = `${parts.year}-${parts.month}-${parts.day}`;
  timeInput.value = `${parts.hour}:${parts.minute}`;
}

function railDuration(raw) {
  const match = String(raw || '').match(/(\d+)d(\d+):(\d+)/);
  if (!match) return raw || '—';
  const hours = Number(match[1]) * 24 + Number(match[2]);
  return `${hours}h ${match[3]}m`;
}

async function searchRail(destination, origin = 'Zürich HB', date = '', timeValue = '') {
  const results = $('#rail-results');
  const state = $('#rail-board-state');
  $('#rail-board-origin').textContent = `FROM ${origin.toUpperCase()}`;
  state.textContent = 'SEARCHING';
  results.innerHTML = '<div class="rail-empty">Reading the live Swiss transport board…</div>';
  try {
    const query = new URLSearchParams({ from: origin, to: destination, limit: '5' });
    if (date) query.set('date', date);
    if (timeValue) query.set('time', timeValue);
    const response = await fetch(`https://transport.opendata.ch/v1/connections?${query}`);
    if (!response.ok) throw new Error('Live board unavailable');
    const data = await response.json();
    const connections = (data.connections || []).filter(connection => connection.from?.departure && connection.to?.arrival);
    if (!connections.length) throw new Error('No connections found');
    const time = value => String(value).slice(11, 16);
    results.innerHTML = connections.map(connection => `
      <div class="rail-row">
        <time>${esc(time(connection.from.departure))}</time>
        <div><strong>${esc(destination)}</strong><span>arr ${esc(time(connection.to.arrival))} · ${esc((connection.products || []).join(' · ') || 'Swiss public transport')}</span></div>
        <span>${esc(connection.transfers === 0 ? 'Direct' : `${connection.transfers} change${connection.transfers === 1 ? '' : 's'}`)}</span>
        <span>${esc(railDuration(connection.duration))}</span>
        <span>Pl. ${esc(connection.from.platform || '—')}</span>
      </div>`).join('') + `<a class="rail-sbb-link" href="https://www.sbb.ch/en" target="_blank" rel="noopener">Verify fare, platform and disruptions on SBB →</a>`;
    state.textContent = 'LIVE';
  } catch {
    results.innerHTML = `<div class="rail-empty">The live board could not return that journey. Check the station spelling or continue in the official SBB planner. <a href="https://www.sbb.ch/en" target="_blank" rel="noopener">Open SBB →</a></div>`;
    state.textContent = 'OFFLINE';
  }
}

$('#rail-form').addEventListener('submit', event => {
  event.preventDefault();
  const destination = $('#rail-destination').value.trim();
  const origin = $('#rail-origin').value.trim() || 'Zürich HB';
  if (destination) searchRail(destination, origin, $('#rail-date').value, $('#rail-time').value);
});
document.querySelectorAll('[data-rail-to]').forEach(button => button.addEventListener('click', () => {
  $('#rail-destination').value = button.dataset.railTo;
  searchRail(button.dataset.railTo, $('#rail-origin').value.trim() || 'Zürich HB', $('#rail-date').value, $('#rail-time').value);
}));
$('#rail-choice-grid').addEventListener('click', event => {
  const button = event.target.closest('[data-rail-choice]');
  if (!button) return;
  const advice = railAdvice[button.dataset.railChoice];
  document.querySelectorAll('[data-rail-choice]').forEach(item => {
    item.classList.toggle('on', item === button);
    item.setAttribute('aria-pressed', String(item === button));
  });
  $('#rail-advice').innerHTML = `<span class="eyebrow">${esc(advice.eyebrow)}</span><h3>${esc(advice.title)}</h3><p>${esc(advice.text)}</p><a href="${esc(advice.url)}" target="_blank" rel="noopener">${esc(advice.label)} →</a>`;
});

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
const PASSPORT_STOPS = [
  { city: 'Zürich', code: 'ZRH', date: '09 AUG 2026', x: 31, y: 34, r: -12, ink: '#9b3343' },
  { city: 'München', code: 'MUC', date: '19 SEP 2026', x: 68, y: 31, r: 9, ink: '#365f74' },
  { city: 'Venezia', code: 'VCE', date: '06 FEB 2027', x: 40, y: 61, r: 7, ink: '#315c58' },
  { city: 'Cannes', code: 'CEQ', date: '14 MAY 2027', x: 72, y: 65, r: -8, ink: '#8b3a48' },
  { city: 'Edinburgh', code: 'EDI', date: '02 JUL 2027', x: 25, y: 78, r: -4, ink: '#394f83' },
  { city: 'Zürich', code: 'ZRH', date: '09 AUG 2027', x: 61, y: 82, r: 12, ink: '#8a3f31' },
];
let passportStampIndex = 0;

function stampPassport() {
  const holder = $('#passport-stamps');
  const stop = PASSPORT_STOPS[passportStampIndex % PASSPORT_STOPS.length];
  const stamp = document.createElement('span');
  stamp.className = 'passport-stamp';
  stamp.style.setProperty('--stamp-x', `${stop.x}%`);
  stamp.style.setProperty('--stamp-y', `${stop.y}%`);
  stamp.style.setProperty('--stamp-r', `${stop.r}deg`);
  stamp.style.setProperty('--stamp-ink', stop.ink);
  stamp.innerHTML = `<b>${esc(stop.city)}</b><i>${esc(stop.date)}</i><small>${esc(stop.code)} · ENTRY</small>`;
  holder.appendChild(stamp);
  if (holder.children.length > PASSPORT_STOPS.length) holder.firstElementChild.remove();
  requestAnimationFrame(() => stamp.classList.add('struck'));
  holder.setAttribute('aria-label', `Passport stamped ${stop.city}, ${stop.date}`);
  passportStampIndex += 1;
}

function closeFrances() {
  const box = $('#frances-box');
  const passport = $('#frances-passport');
  box.classList.remove('on');
  box.setAttribute('aria-hidden', 'true');
  setTimeout(() => {
    box.hidden = true;
    passport.classList.remove('open');
    passport.setAttribute('aria-expanded', 'false');
  }, 420);
}

function revealFrances() {
  const box = $('#frances-box');
  const passport = $('#frances-passport');
  passport.classList.remove('open');
  passport.setAttribute('aria-expanded', 'false');
  passport.setAttribute('aria-label', 'Open the Grand Tour passport');
  $('#passport-stamps').replaceChildren();
  passportStampIndex = 0;
  box.hidden = false;
  box.setAttribute('aria-hidden', 'false');
  void box.offsetWidth; // flush styles so the fade-in still animates
  box.classList.add('on');
  setTimeout(() => passport.focus(), 380);
}
window.revealFrances = revealFrances;
function bindFrances() {
  const box = $('#frances-box');
  const passport = $('#frances-passport');
  box.addEventListener('click', event => {
    if (event.target === box) closeFrances();
  });
  passport.addEventListener('click', () => {
    if (!passport.classList.contains('open')) {
      passport.classList.add('open');
      passport.setAttribute('aria-expanded', 'true');
      passport.setAttribute('aria-label', 'Add the next passport stamp');
      setTimeout(stampPassport, 620);
    } else {
      stampPassport();
    }
  });
  $('#passport-close').addEventListener('click', closeFrances);
  $('#frances-footer').addEventListener('click', revealFrances);
  $('#hero-dedication').addEventListener('click', revealFrances);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !box.hidden) closeFrances(); });
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
  { href: '#/map', kicker: 'See the shape', title: 'The Map', sub: 'Three journeys drawn across Europe', photo: ['monaco-gp', 0] },
  { href: '#/rail', kicker: 'Leave from Zürich', title: 'The Rail Hub', sub: 'Live trains, ticket logic, night routes and bike rules', photo: ['andermatt-passes', 0] },
  { href: '#/calendar', kicker: 'Choose the moment', title: 'The Calendar', sub: 'Thirteen months, headline by headline', photo: ['strasbourg-christmas', 0] },
  { href: '#/routes', kicker: 'Follow a philosophy', title: 'The Routes', sub: 'Greatest Hits, Thrifty, Bucket-List', photo: ['alba-truffle', 0] },
  { href: '#/builder', kicker: 'Make it yours', title: 'Build a Route', sub: 'Compose your own year, stop by stop', photo: ['keukenhof', 0] },
  { href: '#/collection', kicker: 'Browse everything', title: 'The Collection', sub: 'Every dossier, one beautiful index', photo: ['las-fallas', 0] },
  { href: '#/playbook', kicker: 'Plan with confidence', title: 'The Planning Desk', sub: 'Live brief, clusters, savings and booking windows', photo: ['venice-carnival', 0] },
  { href: '#/outdoors', kicker: 'Go under your own power', title: 'The Outdoor Atlas', sub: 'Cycling hubs, great trails, water and winter — from Zürich into Europe', photo: ['eiger-grindelwald', 0], wide: true },
];

function renderHome() {
  $('#chapter-grid').innerHTML = CHAPTERS.map(c => {
    const img = photoOf(c.photo[0], c.photo[1]) || photoOf(c.photo[0], 0);
    return `
    <a class="chapter rv ${c.wide ? 'wide' : ''}" href="${c.href}">
      ${img ? `<div class="chapter-img" style="background-image:url('${img}')"></div>` : ''}
      <div class="chapter-shade"></div>
      <div class="chapter-txt">
        <span class="chapter-kicker">${esc(c.kicker)}</span>
        <span class="chapter-title">${esc(c.title)}</span>
        <span class="chapter-sub">${esc(c.sub)}</span>
      </div>
      <span class="chapter-arrow" aria-hidden="true">↗</span>
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
  const coverIds = {
    'greatest-hits': 'white-turf',
    'thrifty': 'strasbourg-christmas',
    'bucket-list': 'venice-carnival',
  };
  $('#route-cards').innerHTML = window.ROUTES.map((r, i) => `
    ${(() => {
      const coverId = coverIds[r.id];
      const photo = DOSSIERS[coverId]?.photos?.[0];
      const stops = r.stops.filter(stop => stop.eventId).slice(0, 5);
      return `<article class="rcard" style="--rc:${r.color}">
        <div class="rcard-visual"${photo ? ` style="background-image:url('${esc(photo.url)}')"` : ''} role="img" aria-label="${esc(photo?.caption || r.name)}">
          <div class="rcard-shade"></div>
          <div class="rcard-image-copy">
            <div class="rcard-num">Route ${['One', 'Two', 'Three'][i]}</div>
            <span>${r.stops.filter(stop => stop.eventId).length} signature stops</span>
          </div>
          ${photo ? `<small class="rcard-credit">${esc(photo.credit.split(' — ')[0])}</small>` : ''}
        </div>
        <div class="rcard-copy">
          <div class="tag">${esc(r.tag)}</div>
          <h3>${esc(r.name)}</h3>
          <p>${esc(r.blurb)}</p>
          <div class="rcard-stops" aria-label="A few signature stops">
            ${stops.map((stop, stopIndex) => `<span><b>${String(stopIndex + 1).padStart(2, '0')}</b>${esc(eventById(stop.eventId)?.name || stop.label)}</span>`).join('')}
          </div>
          <div class="rcard-bottom">
            <div><span>Year estimate</span><strong>${esc(r.price)}</strong></div>
            <ul>${r.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>
          </div>
          <button class="rcard-btn" data-route="${r.id}">Trace this route on the map <span aria-hidden="true">↗</span></button>
        </div>
      </article>`;
    })()}`).join('');
  document.querySelectorAll('.rcard-btn').forEach(b => b.addEventListener('click', () => {
    currentRouteId = b.dataset.route;
    location.hash = '#/map';
  }));
}

function renderPageVisuals() {
  document.querySelectorAll('[data-photo-id]').forEach(figure => {
    const photo = DOSSIERS[figure.dataset.photoId]?.photos?.[Number(figure.dataset.photoIndex || 0)];
    if (!photo) return;
    const image = figure.querySelector('.page-photo-image');
    image.style.backgroundImage = `url("${photo.url.replace(/"/g, '%22')}")`;
    image.setAttribute('aria-label', photo.caption);
    figure.querySelector('[data-photo-caption]').textContent = photo.caption;
    figure.querySelector('[data-photo-credit]').textContent = photo.credit.split(' — ')[0];
  });
}

/* ---------- builder ---------- */
const BUILDER_KEY = 'gt-builder-route';
const BUILDER_BUDGET_KEY = 'gt-builder-budget';
let builderStops = [];
let builderQuery = '';
let builderBudgetTier = localStorage.getItem(BUILDER_BUDGET_KEY) || 'midrange';
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
const parsedTierCost = (id, tier) => {
  const raw = DOSSIERS[id]?.costs?.[tier] || '';
  const m = raw.match(/(?:€|EUR|CHF)\s*([\d,.]+)(?:\s*[–-]\s*([\d,.]+))?/i);
  if (!m) return null;
  const number = s => Number(String(s).replace(/,/g, ''));
  const low = number(m[1]);
  const high = m[2] ? number(m[2]) : low;
  return Math.round((low + high) / 2);
};
const datedStopTime = id => {
  const start = window.CAL_DATES[id]?.[0]?.[0];
  return start ? parseISO(start).getTime() : Number.MAX_SAFE_INTEGER;
};

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
  const q = searchText(builderQuery);
  const rankedMatches = q ? vibeRank(builderQuery, ITEMS) : [];
  const rankById = new Map(rankedMatches.map(result => [result.item.id, result]));
  const groups = q ? (rankedMatches.length ? [{ label: 'Best matches', evs: rankedMatches.map(result => eventById(result.item.id)).filter(Boolean) }] : []) : window.MONTHS.map(mo => ({
    label: `${mo.label} ${mo.year}`,
    evs: window.EVENTS.filter(e => e.month === `${mo.label.slice(0, 3)} ${mo.year}`),
  })).filter(g => g.evs.length);
  if (!q) groups.push({ label: 'Outdoor Atlas', evs: ITEMS.filter(e => e.adventure) });
  const matchCount = groups.reduce((n, g) => n + g.evs.length, 0);
  $('#builder-search-status').textContent = q
    ? `${matchCount} stop${matchCount === 1 ? '' : 's'} ranked locally from dossier metadata — no AI`
    : '';
  $('#builder-catalog').innerHTML = groups.length ? groups.map(g => `
    <div class="bcat-group">
      <div class="bcat-month">${esc(g.label)}</div>
      ${g.evs.map(e => {
        const added = builderStops.includes(e.id);
        return `
        <div class="bcat-row ${added ? 'added' : ''}">
          <div class="bcat-txt">
            <span class="bcat-name">${esc(e.name)}</span>
            <span class="bcat-place">${esc(window.PLACES[e.place].name)}</span>
            ${q ? vibeChips(rankById.get(e.id)) : ''}
          </div>
          <button class="bcat-btn" data-id="${e.id}">${added ? 'Added' : 'Add'}</button>
        </div>`;
      }).join('')}
    </div>`).join('') : '<p class="search-empty">No stops match that search. Try a place, month or activity.</p>';
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

  const tierLabels = { thrifty: 'Thrifty', midrange: 'Mid-range', splurge: 'Splurge' };
  $('#builder-budget').querySelectorAll('button').forEach(b => {
    const selected = b.dataset.tier === builderBudgetTier;
    b.classList.toggle('on', selected);
    b.setAttribute('aria-pressed', String(selected));
  });
  $('#builder-sort').disabled = builderStops.length < 2;
  const stopEstimates = builderStops.map(id => parsedTierCost(id, builderBudgetTier));
  const knownSpend = stopEstimates.filter(Number.isFinite).reduce((sum, value) => sum + value, 0);
  const missing = stopEstimates.filter(value => value === null).length;
  const total = knownSpend + cost;
  $('#builder-budget-total').innerHTML = builderStops.length
    ? `<strong>~€${total.toLocaleString('en')}</strong><span>${esc(tierLabels[builderBudgetTier])} trip estimate · €${knownSpend.toLocaleString('en')} stops + €${cost.toLocaleString('en')} transport</span>`
    : '<strong>€0</strong><span>Add stops to build a whole-trip estimate</span>';
  $('#builder-budget-note').textContent = builderStops.length
    ? `Planning midpoint from each dossier; CHF is treated roughly at parity with EUR. Live prices will differ.${missing ? ` ${missing} stop${missing === 1 ? '' : 's'} still need a cost estimate.` : ''}`
    : '';

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
$('#builder-sort').addEventListener('click', () => {
  builderStops = builderStops
    .map((id, index) => ({ id, index, time: datedStopTime(id) }))
    .sort((a, b) => a.time - b.time || a.index - b.index)
    .map(item => item.id);
  saveBuilder();
  refreshBuilder();
});
$('#builder-budget').addEventListener('click', ev => {
  const button = ev.target.closest('button[data-tier]');
  if (!button) return;
  builderBudgetTier = button.dataset.tier;
  localStorage.setItem(BUILDER_BUDGET_KEY, builderBudgetTier);
  renderBuilder();
});
$('#builder-search').addEventListener('input', ev => {
  builderQuery = ev.target.value;
  renderBuilder();
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
let outdoorsQuery = '';
function renderOutdoors() {
  const acts = ['all', ...new Set(window.ADVENTURES.map(adventure => adventure.activity))];
  $('#outdoors-filters').innerHTML = acts.map(k => `
    <button class="cfilter ${outdoorsFilter === k ? 'on' : ''}" data-kind="${k}">
      ${k === 'all' ? 'All' : esc(KIND_LABEL[k])}
    </button>`).join('');
  $('#outdoors-filters').querySelectorAll('.cfilter').forEach(b => b.addEventListener('click', () => {
    outdoorsFilter = b.dataset.kind;
    renderOutdoors();
  }));

  const q = searchText(outdoorsQuery);
  const rankedMatches = q ? vibeRank(outdoorsQuery, window.ADVENTURES) : [];
  const resultById = new Map(rankedMatches.map(result => [result.item.id, result]));
  const source = q ? rankedMatches.map(result => result.item) : window.ADVENTURES;
  const list = source.filter(a => outdoorsFilter === 'all' || a.activity === outdoorsFilter);
  $('#outdoors-search-status').textContent = q
    ? `${list.length} adventure${list.length === 1 ? '' : 's'} ranked locally from dossier metadata — no AI`
    : '';
  $('#outdoors-grid').innerHTML = list.length ? list.map(a => {
    const d = DOSSIERS[a.id];
    const img = photoOf(a.id);
    const travel = d?.gettingThere?.[0];
    return `
    <article class="ctile">
      <a class="ctile-main" href="#/event/${a.id}">
      <div class="ctile-imgwrap">
        ${img ? `<div class="ctile-img" style="background-image:url('${img}')"></div>` : ''}
      </div>
      <div class="ctile-body">
        <div class="ctile-kind">${esc(KIND_LABEL[a.activity])} · ${esc(window.PLACES[a.place].name)}${d?.country ? ', ' + esc(d.country) : ''}</div>
        <h3>${esc(a.name)}</h3>
        <div class="ctile-meta">${esc(a.season)}${travel ? ` · ${esc(MODE_LABEL[travel.mode] || '')} ${esc(travel.duration)} from Zürich` : ''}</div>
        ${d?.tagline ? `<p class="ctile-tag">${esc(d.tagline)}</p>` : ''}
        ${q ? vibeChips(resultById.get(a.id)) : ''}
        <span class="ctile-cta">Read the dossier</span>
      </div>
      </a>
      ${compareButton(a.id)}
    </article>`;
  }).join('') : '<p class="search-empty collection-empty">Nothing matches that exact outdoor mood yet. Try removing one constraint or raising the budget.</p>';
  bindCompareButtons($('#outdoors-grid'));
}

$('#outdoors-search').addEventListener('input', ev => {
  outdoorsQuery = ev.target.value;
  renderOutdoors();
});
$('#outdoors-prompts').addEventListener('click', ev => {
  const button = ev.target.closest('button[data-query]');
  if (!button) return;
  outdoorsQuery = button.dataset.query;
  $('#outdoors-search').value = outdoorsQuery;
  renderOutdoors();
});

/* ---------- collection & Planning Desk ---------- */
let collectionFilter = 'all';
let collectionQuery = '';
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

  const q = searchText(collectionQuery);
  const rankedMatches = q ? vibeRank(collectionQuery, window.EVENTS) : [];
  const resultById = new Map(rankedMatches.map(result => [result.item.id, result]));
  const source = q ? rankedMatches.map(result => result.item) : window.EVENTS;
  const list = source.filter(e => collectionFilter === 'all' || e.kind === collectionFilter);
  $('#collection-search-status').textContent = q
    ? `${list.length} dossier${list.length === 1 ? '' : 's'} ranked locally from dossier metadata — no AI`
    : '';
  $('#all-events').innerHTML = list.length ? list.map(e => {
    const d = DOSSIERS[e.id];
    const img = photoOf(e.id);
    const travel = d?.gettingThere?.[0];
    return `
    <article class="ctile">
      <a class="ctile-main" href="#/event/${e.id}">
      <div class="ctile-imgwrap">
        ${img ? `<div class="ctile-img" style="background-image:url('${img}')"></div>` : ''}
      </div>
      <div class="ctile-body">
        <div class="ctile-kind">${esc(KIND_LABEL[e.kind] || 'Event')} · ${esc(window.PLACES[e.place].name)}${d?.country ? ', ' + esc(d.country) : ''}</div>
        <h3>${esc(e.name)}</h3>
        <div class="ctile-meta">${esc(shortDates(d?.dates) || e.month)}${travel ? ` · ${esc(MODE_LABEL[travel.mode] || '')} ${esc(travel.duration)} from Zürich` : ''}</div>
        ${d?.tagline ? `<p class="ctile-tag">${esc(d.tagline)}</p>` : ''}
        ${q ? vibeChips(resultById.get(e.id)) : ''}
        <span class="ctile-cta">Read the dossier</span>
      </div>
      </a>
      ${compareButton(e.id)}
    </article>`;
  }).join('') : '<p class="search-empty collection-empty">No dossiers match that search and filter. Try a broader place, season or interest.</p>';
  bindCompareButtons($('#all-events'));
}

$('#collection-search').addEventListener('input', ev => {
  collectionQuery = ev.target.value;
  renderCollection();
});

$('#compare-clear').addEventListener('click', () => {
  compareIds = []; saveCompare(); renderCompareTray(); renderCollection(); renderOutdoors();
});
$('#compare-open').addEventListener('click', () => {
  renderCompareDialog();
  $('#compare-dialog').showModal();
});
$('#compare-close').addEventListener('click', () => $('#compare-dialog').close());
$('#compare-table').addEventListener('click', ev => {
  if (ev.target.closest('a')) $('#compare-dialog').close();
});

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
  const detailSequence = e.adventure ? ITEMS.filter(item => item.adventure) : window.EVENTS;
  const idx = detailSequence.findIndex(item => item.id === id);
  const prev = detailSequence[(idx - 1 + detailSequence.length) % detailSequence.length];
  const next = detailSequence[(idx + 1) % detailSequence.length];
  const img = d?.photos?.[0]?.url;
  const inBuilder = builderStops.includes(id);
  const guideSections = (d?.guideSections || []).map((section, index) => ({
    ...section,
    id: String(section.id || `d-guide-${index + 1}`).replace(/[^\w-]/g, '-'),
  }));
  const detailSections = d ? [
    ['d-overview', 'Why go'],
    ['d-story', 'Story'],
    ...guideSections.map(section => [section.id, section.toc || section.title || 'Field guide']),
    ['d-logistics', 'Getting there'],
    ['d-budget', 'Budget'],
    ['d-tips', 'Tips'],
    ['d-local', 'While there'],
    ...(d.photos?.length > 1 ? [['d-gallery', 'Gallery']] : []),
    ['d-booking', 'Booking'],
  ] : [['d-overview', 'Overview'], ['d-booking', 'Booking']];

  root.innerHTML = `
  <div class="d-hero" ${img ? `style="background-image:url('${img}')"` : ''}>
    <div class="d-hero-shade"></div>
    <div class="wrap">
      <a class="d-back" href="${e.adventure ? '#/outdoors' : '#/collection'}" id="d-back">Back</a>
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
  <div class="d-utility-shell">
    <div class="wrap">
      <nav class="d-toc" aria-label="Dossier sections">
        <span class="d-toc-label">In this dossier</span>
        <div class="d-toc-links">
          ${detailSections.map(([sectionId, label]) => `<a href="#/event/${id}/${sectionId}">${esc(label)}</a>`).join('')}
        </div>
      </nav>
      <div class="d-actionbar" aria-label="Trip actions">
        <a href="#/event/${id}/d-booking">Plan & book</a>
        ${window.CAL_DATES[id] ? '<button type="button" id="d-action-calendar">Add dates</button>' : ''}
        <button type="button" class="primary" id="d-action-route">${inBuilder ? 'View your route' : 'Add to route'}</button>
      </div>
    </div>
  </div>
  <div class="wrap d-cols">
    <div class="d-main">
      ${d ? `
      <section class="d-sec anchor" id="d-overview"><span class="eyebrow">Why go</span><p class="d-why">${esc(d.whyGo)}</p></section>
      <section class="d-sec anchor" id="d-story"><span class="eyebrow">The story</span><h2>A little history</h2>${(d.history || []).map(p => `<p>${esc(p)}</p>`).join('')}</section>
      ${guideSections.map(section => `
      <section class="d-sec d-guide anchor" id="${esc(section.id)}">
        <span class="eyebrow">${esc(section.eyebrow || 'Field guide')}</span>
        <h2>${esc(section.title || '')}</h2>
        ${section.intro ? `<p class="guide-intro">${esc(section.intro)}</p>` : ''}
        ${(section.paragraphs || []).map(paragraph => `<p>${esc(paragraph)}</p>`).join('')}
        ${section.facts?.length ? `<div class="guide-facts">${section.facts.map(fact => `
          <div class="guide-fact"><span>${esc(fact.label)}</span><strong>${esc(fact.value)}</strong>${fact.note ? `<p>${esc(fact.note)}</p>` : ''}</div>`).join('')}</div>` : ''}
        ${section.items?.length ? `<div class="guide-items">${section.items.map(item => `
          <article><span>${esc(item.kicker || '')}</span><h3>${esc(item.title)}</h3>${item.meta ? `<div class="guide-item-meta">${esc(item.meta)}</div>` : ''}<p>${esc(item.text || '')}</p></article>`).join('')}</div>` : ''}
        ${section.bullets?.length ? `<ul class="tips guide-bullets">${section.bullets.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : ''}
        ${section.links?.length ? `<div class="guide-links">${section.links.map(link => `<a href="${esc(link.url)}" target="_blank" rel="noopener">${esc(link.label)}</a>`).join('')}</div>` : ''}
      </section>`).join('')}
      <section class="d-sec anchor" id="d-logistics">
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
      <section class="d-sec anchor" id="d-budget">
        <span class="eyebrow">Budget</span><h2>What it costs</h2>
        <div class="cost-tiers">
          <div class="tier"><div class="t-name">Thrifty</div><div class="t-val">${esc(d.costs?.thrifty || '—')}</div></div>
          <div class="tier mid"><div class="t-name">Mid-range</div><div class="t-val">${esc(d.costs?.midrange || '—')}</div></div>
          <div class="tier"><div class="t-name">Splurge</div><div class="t-val">${esc(d.costs?.splurge || '—')}</div></div>
        </div>
        ${d.costs?.notes ? `<p class="cost-notes">${esc(d.costs.notes)}</p>` : ''}
      </section>
      <section class="d-sec anchor" id="d-tips">
        <span class="eyebrow">Know before you go</span><h2>Insider tips</h2>
        <ul class="tips">${(d.tips || []).map(t => `<li>${esc(t)}</li>`).join('')}</ul>
      </section>
      <section class="d-sec anchor" id="d-local">
        <span class="eyebrow">While you're there</span><h2>Eat, drink, wander</h2>
        <div class="recs">
          ${(d.localRecs || []).map(r => `
            <div class="rec"><div class="rec-type">${esc(r.type)}</div><div class="rec-name">${esc(r.name)}</div><div class="rec-note">${esc(r.note)}</div></div>`).join('')}
        </div>
      </section>
      ${d.photos?.length > 1 ? `
      <section class="d-sec anchor" id="d-gallery">
        <span class="eyebrow">In pictures</span><h2>Gallery</h2>
        <div class="gallery">
          ${d.photos.map(p => `
            <figure><div class="g-imgwrap"><img src="${p.url}" alt="${esc(p.caption)}" loading="lazy" onerror="this.closest('figure').remove()"></div>
            <figcaption>${esc(p.caption)}${p.credit ? ` — <span>${esc(p.credit)}</span>` : ''}</figcaption></figure>`).join('')}
        </div>
      </section>` : ''}
      ` : `
      <section class="d-sec anchor" id="d-overview"><h2>Dossier being researched</h2>
        <p>The research agents haven't filed this one yet. Meanwhile: <b>${esc(e.name)}</b> in ${esc(pl.name)}, ${esc(e.month)}. Refresh in a minute.</p>
      </section>`}
    </div>
    <aside class="d-side">
      <div class="d-panel">
        <h3>From your door in Zürich</h3>
        <div id="mini-map"></div>
        <div class="d-weather">${d?.weather ? esc(d.weather) : ''}</div>
      </div>
      <div class="d-panel anchor" id="d-booking">
        <h3>Plan this trip</h3>
        <p class="booking-verified">Travel links checked ${RESEARCH_VERIFIED_ON}. Confirm live prices before purchase.</p>
        ${planLinks(e, d).map(b => `<a class="d-booklink" href="${b.url}" target="_blank" rel="noopener">${esc(b.label)}</a>`).join('')}
        ${window.CAL_DATES[id] ? `<button class="rcard-btn builder-add" id="d-ics">Add to calendar (.ics)</button>` : ''}
      </div>
      <div class="d-panel" id="d-trains"></div>
      <div class="d-panel" id="d-weather-live"></div>
      ${d?.booking?.length ? `
      <div class="d-panel">
        <h3>Booking & official links</h3>
        <p class="booking-verified">Sources verified ${RESEARCH_VERIFIED_ON}. Dates and inventory can change.</p>
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
  const addOrViewRoute = () => {
    if (!builderStops.includes(id)) { builderStops.push(id); saveBuilder(); }
    location.hash = '#/builder';
  };
  $('#d-add-builder').addEventListener('click', addOrViewRoute);
  $('#d-action-route').addEventListener('click', addOrViewRoute);
  const downloadDetailCalendar = () => {
    const spans = window.CAL_DATES[id];
    downloadICS(`${id}.ics`, buildICS(spans.map(([a, b], i) => ({
      id: `${id}-${i}`, start: a, end: b, title: d?.name || e.name,
      location: `${pl.name}${d?.country ? ', ' + d.country : ''}`,
      desc: d?.tagline || '',
    }))));
  };
  const icsBtn = $('#d-ics');
  if (icsBtn) icsBtn.addEventListener('click', downloadDetailCalendar);
  const actionIcsBtn = $('#d-action-calendar');
  if (actionIcsBtn) actionIcsBtn.addEventListener('click', downloadDetailCalendar);

  // live data (fail silently — panels remove themselves)
  loadTrains($('#d-trains'), e);
  loadForecast($('#d-weather-live'), e);

  GrandTourMap.mini($('#mini-map'), e.place, '#9c4b2f');
}

/* ---------- responsive navigation ---------- */
function closeMobileNav() {
  const nav = $('#topnav');
  const toggle = $('#nav-toggle');
  nav.classList.remove('menu-open');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', 'Open navigation');
  $('.nav-toggle-label').textContent = 'Menu';
}

function bindMobileNav() {
  const nav = $('#topnav');
  const toggle = $('#nav-toggle');
  toggle.addEventListener('click', () => {
    const open = !nav.classList.contains('menu-open');
    nav.classList.toggle('menu-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    $('.nav-toggle-label').textContent = open ? 'Close' : 'Menu';
  });
  $('.topnav-links').addEventListener('click', ev => {
    if (ev.target.closest('a')) closeMobileNav();
  });
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && nav.classList.contains('menu-open')) {
      closeMobileNav();
      toggle.focus();
    }
  });
}

/* ---------- router ---------- */
const VIEWS = ['v-home', 'v-map', 'v-rail', 'v-calendar', 'v-routes', 'v-builder', 'v-outdoors', 'v-collection', 'v-playbook', 'detail'];

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

function scrollToRouteSection(sectionId) {
  const scroll = () => document.getElementById(sectionId)?.scrollIntoView({ block: 'start' });
  requestAnimationFrame(scroll);
  setTimeout(scroll, 160);
}

function route() {
  const h = location.hash || '#/';
  const mEv = h.match(/^#\/event\/([\w-]+)(?:\/([\w-]+))?/);
  closeMobileNav();
  stopHero();
  if (mainMap) mainMap.pause();
  if ($('#play-toggle')) $('#play-toggle').textContent = 'Pause journey';

  if (mEv) {
    show('detail');
    renderDetail(mEv[1]);
    setNav(null, true);
    if (mEv[2]) scrollToRouteSection(mEv[2]);
  } else if (h.startsWith('#/map')) {
    show('v-map');
    setNav('map', false);
    ensureMainMap().then(() => { mainMap.play(); applyRoute(true); });
  } else if (h.startsWith('#/rail')) {
    show('v-rail');
    setNav('rail', false);
    updateRailClock();
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
    const planningSection = h.match(/^#\/playbook\/(planning-[\w-]+)/)?.[1];
    if (planningSection) scrollToRouteSection(planningSection);
  } else if (h.startsWith('#/brief')) {
    location.replace('#/playbook');
    return;
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
  bindMobileNav();
  updateRailClock();
  initializeRailForm();
  setInterval(updateRailClock, 30000);
  window.VibeSearch?.index({ dossiers: DOSSIERS });
  renderCompareTray();
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
  window.VibeSearch?.index({ dossiers: DOSSIERS });
  renderHome();
  renderCalendar();
  renderCollection();
  renderOutdoors();
  renderRoutesPage();
  renderPageVisuals();
  route();
})();
