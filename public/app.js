/* menU front end: vanilla JS single page app, hash routing. */
const $app = document.getElementById('app');
const S = { me: null, cfg: {}, ob: 0, authMode: 'onboard', settings: null, quiet: false };

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (p) => '£' + ((p || 0) / 100).toFixed(2);
const imgUrl = (k) => (k ? '/api/img/' + k : '');
const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
const fmtDate = (d) => !d ? 'Date to be decided' : new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
// Lucide icons (https://lucide.dev). <i data-lucide="name"> tags are swapped for SVGs after each render.
// menU wordmark (light and dark versions) and app icon.
const logoImg = () => `<picture><source srcset="/logo-dark.png" media="(prefers-color-scheme: dark)"><img class="wordmark" src="/logo.png" alt="menU" width="112" height="30"></picture>`;
const icon = (name, cls = '') => `<i data-lucide="${name}" class="ic ${cls}" aria-hidden="true"></i>`;
let iconQueued = false;
function drawIcons() {
  if (iconQueued) return;
  iconQueued = true;
  requestAnimationFrame(() => { iconQueued = false; if (window.lucide) window.lucide.createIcons(); });
}
new MutationObserver(drawIcons).observe(document.getElementById('app'), { childList: true, subtree: true });
window.addEventListener('load', () => {
  if (window.lucide) return drawIcons();
  const f = document.createElement('script'); // second CDN if the first one was blocked
  f.src = 'https://unpkg.com/lucide@0.469.0/dist/umd/lucide.min.js';
  f.onload = drawIcons;
  document.head.appendChild(f);
});
const isAdmin = () => !!(S.me && S.me.is_admin);

async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && S.me) { S.me = null; render(); }
    throw new Error(d.error || 'Something went wrong');
  }
  return d;
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2400);
}
const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message); } };

function avatar(u, cls = '') {
  if (!u) return '';
  const name = u.name || u.requester_name || u.cook_name || '?';
  const key = u.avatar_key;
  return key
    ? `<img class="av ${cls}" src="${imgUrl(key)}" alt="${esc(name)}" title="${esc(name)}">`
    : `<span class="av ${cls}" title="${esc(name)}">${esc(name.trim()[0] || '?').toUpperCase()}</span>`;
}
const stackAv = (list) => `<span class="stack">${list.slice(0, 6).map((u) => avatar(u, 'sm')).join('')}</span>`;

async function shrink(file, max = 1000) {
  const bmp = await createImageBitmap(file);
  const sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82));
}
async function uploadImage(file, max) {
  const blob = await shrink(file, max);
  const r = await fetch('/api/upload', { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: blob });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Upload failed');
  return d.key;
}

function copyText(v) {
  const done = () => toast('Copied');
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(v).then(done, () => fallbackCopy(v, done));
  fallbackCopy(v, done);
}
function fallbackCopy(v, done) {
  const t = document.createElement('textarea');
  t.value = v; t.style.position = 'fixed'; t.style.opacity = '0';
  document.body.appendChild(t); t.select();
  try { document.execCommand('copy'); done(); } catch { toast('Copy failed'); }
  t.remove();
}

// ---------- shell ----------
// cls sets the page width: '' (wide), 'mid' or 'narrow'. Phones always use the full width.
function shell(inner, active, cls = '') {
  document.body.classList.add('has-nav');
  const a = isAdmin();
  const tab = (href, ic, label, key) => `<a href="${href}" class="${active === key ? 'on' : ''}"${active === key ? ' aria-current="page"' : ''}><b>${icon(ic)}</b><span>${label}</span></a>`;
  $app.innerHTML = `
    <div class="top">
      <a class="brand" href="#/" aria-label="menU home">${logoImg()}</a>
      <a href="#/me" aria-label="Profile">${avatar(S.me)}</a>
    </div>
    <main class="wrap ${cls}">${inner}</main>
    <nav class="nav" aria-label="Main"><div class="in">
      <a class="brand nav-brand" href="#/" aria-label="menU home">${logoImg()}</a>
      ${tab('#/', 'house', 'Home', 'home')}
      ${tab('#/calendar', 'calendar-days', 'Calendar', 'calendar')}
      ${tab('#/requests', 'lightbulb', 'Requests', 'requests')}
      ${a ? tab('#/bank', 'library', 'Meal bank', 'bank') : ''}
      ${tab('#/pay', 'pound-sterling', a ? 'Owed' : 'Pay', 'pay')}
      <a class="nav-me ${active === 'me' ? 'on' : ''}" href="#/me">${avatar(S.me, 'sm')}<span>${esc(S.me.name)}</span></a>
    </div></nav>`;
}
// Placeholder while a page loads. Skipped on quiet refreshes so the page does not jump to the top.
function loading(active, cls = '') { if (!S.quiet) shell('<p class="muted">Loading...</p>', active, cls); }
// Re-draws the current page in place and keeps the scroll position (used after ticking, joining, paying).
async function refresh() {
  const y = window.scrollY;
  S.quiet = true;
  try { await render(); } finally { S.quiet = false; }
  window.scrollTo(0, y);
}

// ---------- auth + onboarding ----------
const mav = (t) => `<span class="av sm">${t}</span>`;
const SLIDES = [
  { title: 'Cook once, share the table', text: 'Your flat cook posts the meals. You choose what you want, and the cost is split fairly.',
    art: () => `<img class="ob-appicon" src="/icon-192.png" alt="" width="104" height="104">
      <div class="ob-chips"><span class="chip">${icon('utensils')}Meals</span><span class="chip">${icon('users')}Flatmates</span><span class="chip">${icon('pound-sterling')}Fair split</span></div>` },
  { title: "See what's cooking", text: "The home page shows tonight's meal and everything coming up, with the price per person.",
    art: () => `<div class="mini"><div class="mini-hero">${icon('utensils')}</div>
      <div class="row between" style="margin-top:10px"><b>Beef Chilli</b><span class="badge">Today</span></div>
      <div class="row between" style="margin-top:6px"><span class="muted">&pound;5.76 each</span><span class="stack">${mav('A')}${mav('B')}${mav('C')}</span></div></div>` },
  { title: "Say if you're in", text: 'Tap I\'m in or I\'m out on any meal. Your share updates as people join. No reply means you are not counted.',
    art: () => `<div class="mini"><div class="row between"><b>Beef Chilli</b><span class="muted">3 in, 1 out</span></div>
      <div class="seg" style="margin-top:12px"><span class="btn in">${icon('check')}I'm in</span><span class="btn">${icon('x')}I'm out</span></div>
      <div class="row" style="margin-top:12px"><span class="stack">${mav('A')}${mav('B')}${mav('C')}</span><span class="muted">your share &pound;5.76</span></div></div>` },
  { title: 'Tick off what you have', text: 'Already got rice in the cupboard? Tick it. The meal price only counts what is still needed.',
    art: () => `<div class="mini">
      <div class="ing done"><span class="tick on">${icon('check')}</span><div class="grow nm">Rice</div><span class="muted">&pound;2.00</span></div>
      <div class="ing"><span class="tick"></span><div class="grow nm">Beef mince</div><span>&pound;6.50</span></div>
      <div class="ing"><span class="tick"></span><div class="grow nm">Chopped tomatoes</div><span>&pound;2.80</span></div>
      <div class="totals" style="margin-top:8px"><div class="line"><span>Still to buy</span><b>&pound;9.30</b></div></div></div>` },
  { title: 'Plan ahead, ask for favourites', text: 'See meals by date in the calendar, or request a meal you fancy with a name, photo and ingredients.',
    art: () => `<div class="mini"><div class="mini-cal">${['M','T','W','T','F','S','S'].map((d) => `<span class="dow">${d}</span>`).join('')}
      <span>9</span><span>10</span><span class="hot">11</span><span>12</span><span class="dot">13</span><span>14</span><span>15</span></div>
      <div class="chip" style="margin-top:12px">${icon('lightbulb')}Request: Thai Green Curry</div></div>` },
  { title: 'Pay in two taps', text: 'The Pay page shows what you owe and the bank details, each with its own copy button. Mark it paid when sent.',
    art: () => `<div class="mini"><div class="row between"><b>You owe</b><b style="font-size:1.4rem;color:var(--brand-text)">&pound;4.72</b></div>
      <div class="copyrow"><div><div class="muted">Sort code</div><div class="v">00-00-00</div></div><span class="btn small">${icon('copy')}Copy</span></div>
      <div class="copyrow"><div><div class="muted">Account number</div><div class="v">12345678</div></div><span class="btn small">${icon('copy')}Copy</span></div></div>` },
];

const authTop = () => `<div class="ob-top"><span class="brand">${logoImg()}</span></div>`;

function viewAuth() {
  document.body.classList.remove('has-nav');
  if (S.authMode === 'onboard') {
    const s = SLIDES[S.ob];
    const last = S.ob === SLIDES.length - 1;
    $app.innerHTML = `<div class="ob wide">
      <div class="ob-top"><span class="brand">${logoImg()}</span><button class="linkbtn" data-act="ob-profile">Skip</button></div>
      <div class="ob-progress" role="progressbar" aria-valuemin="1" aria-valuemax="${SLIDES.length}" aria-valuenow="${S.ob + 1}"><i style="width:${((S.ob + 1) / SLIDES.length) * 100}%"></i></div>
      <div class="muted ob-step">Step ${S.ob + 1} of ${SLIDES.length}</div>
      <div class="ob-body"><div class="ob-stage">${s.art()}</div>
      <div class="ob-copy"><h1 class="ob-title">${esc(s.title)}</h1>
      <p class="ob-text">${esc(s.text)}</p>
      <div class="ob-actions">
        ${S.ob > 0 ? `<button class="btn" data-act="ob-back">${icon('arrow-left')}Back</button>` : ''}
        <button class="btn primary grow" data-act="${last ? 'ob-profile' : 'ob-next'}">${last ? 'Create my profile' : 'Next'}${icon(last ? 'user-plus' : 'arrow-right')}</button>
      </div>
      <p class="muted ob-links"><a href="#" data-act="auth-mode" data-m="login">I already have an account</a> &middot; <a href="#" data-act="auth-mode" data-m="cook">Cook login</a></p></div></div></div>`;
    return;
  }
  if (S.authMode === 'profile') {
    $app.innerHTML = `<div class="ob">${authTop()}
      <h1>Create your profile</h1><p class="muted" style="margin-top:0">So your flatmates know who is who.</p>
      <form class="card pad" data-form="register">
        <label class="avatar-pick" for="p-file"><span id="p-prev" class="avatar-circle">${icon('camera')}</span>Add a profile picture</label>
        <input type="file" id="p-file" accept="image/*" hidden>
        <label for="p-name">Your name</label><input id="p-name" maxlength="30" required autocomplete="nickname" placeholder="e.g. Alice">
        <label for="p-pin">Choose a PIN (4 to 8 digits)</label><input id="p-pin" inputmode="numeric" pattern="\\d{4,8}" maxlength="8" type="password" required autocomplete="new-password" placeholder="You will use this to log back in">
        ${S.cfg.needs_code ? '<label for="p-code">Flat code</label><input id="p-code" required placeholder="Ask your flat cook">' : ''}
        <button class="btn primary block" style="margin-top:18px">${icon('check')}Join the flat</button>
      </form>
      <p class="muted"><a href="#" data-act="auth-mode" data-m="onboard">Back to the intro</a></p></div>`;
    return;
  }
  if (S.authMode === 'login') {
    $app.innerHTML = `<div class="ob">${authTop()}<h1>Welcome back</h1>
      <form class="card pad" data-form="login">
        <label for="l-name">Name</label><input id="l-name" required autocomplete="username">
        <label for="l-pin">PIN</label><input id="l-pin" type="password" inputmode="numeric" required autocomplete="current-password">
        <button class="btn primary block" style="margin-top:18px">${icon('log-in')}Log in</button>
      </form>
      <p class="muted"><a href="#" data-act="auth-mode" data-m="onboard">Back to the intro</a></p></div>`;
    return;
  }
  $app.innerHTML = `<div class="ob">${authTop()}<h1>Cook login</h1>
    <form class="card pad" data-form="cook">
      <label for="c-pass">Admin password</label><input id="c-pass" type="password" required autocomplete="current-password">
      <button class="btn primary block" style="margin-top:18px">${icon('key-round')}Log in</button>
    </form>
    <p class="muted"><a href="#" data-act="auth-mode" data-m="onboard">Back to the intro</a></p></div>`;
}

// ---------- meal cards ----------
function shareLine(m) {
  const sp = m.split;
  if (m.my_rsvp === 'in' && !isAdmin()) return `<b>Your share ${money(sp.per)}</b>`;
  if (isAdmin()) return `<b>You pay ${money(sp.cook)}</b> <span class="muted">(${sp.diners} ${sp.diners === 1 ? 'other' : 'others'} at ${money(sp.per)})</span>`;
  return `<span class="muted">${sp.diners ? money(sp.per) + ' each if you join' : 'Be the first to join'}</span>`;
}
function rsvpButtons(m) {
  if (isAdmin()) return '';
  return `<div class="seg" style="margin-top:10px">
    <button class="btn ${m.my_rsvp === 'in' ? 'in' : ''}" data-act="rsvp" data-id="${m.id}" data-s="in">${icon('check')}I'm in</button>
    <button class="btn ${m.my_rsvp === 'out' ? 'out' : ''}" data-act="rsvp" data-id="${m.id}" data-s="out">${icon('x')}I'm out</button>
  </div>`;
}
function mealCard(m, today) {
  const label = !m.date ? '<span class="badge warn">Date to be decided</span>' : m.date === today ? '<span class="badge">Today</span>' : `<span class="muted">${fmtDate(m.date)}</span>`;
  const hero = m.image_key ? `<img class="hero" src="${imgUrl(m.image_key)}" alt="" loading="lazy">` : `<div class="hero ph">${icon('utensils', 'big')}</div>`;
  return `<div class="card">
    <a href="#/meal/${m.id}" style="color:inherit;text-decoration:none">${hero}
      <div class="pad" style="padding-bottom:0">
        <div class="row between">${label}<span class="muted">${icon('chef-hat')}${esc(m.cook_name || '')}</span></div>
        <h2 style="margin-top:4px">${esc(m.title)}</h2>
        <div class="row between wrapflex"><span>${shareLine(m)}</span>
          <span class="row" style="gap:6px">${stackAv(m.ins)}<span class="muted">${m.ins.length} in</span></span></div>
      </div></a>
    <div class="pad" style="padding-top:0">${rsvpButtons(m)}</div>
  </div>`;
}

// ---------- views ----------
async function viewHome() {
  loading('home');
  const { meals, today, undated } = await api('/meals?scope=upcoming');
  const tod = meals.filter((m) => m.date === today);
  const later = meals.filter((m) => m.date > today);
  shell(`
    ${isAdmin() ? `<a class="btn primary block addbtn" href="#/new">${icon('plus')}Add a meal</a>` : ''}
    <div class="sectionhead"><h2>Today</h2></div>
    <div class="grid">${tod.length ? tod.map((m) => mealCard(m, today)).join('') : '<div class="card pad muted empty">No meal planned for today.</div>'}</div>
    <div class="sectionhead"><h2>Coming up</h2></div>
    <div class="grid">${later.length ? later.map((m) => mealCard(m, today)).join('') : '<div class="card pad muted empty">Nothing scheduled yet. Request a meal you fancy from the Requests tab.</div>'}</div>
    ${undated && undated.length ? `<div class="sectionhead"><h2>Date to be decided</h2></div><div class="grid">${undated.map((m) => mealCard(m, today)).join('')}</div>` : ''}
  `, 'home');
}

async function viewCalendar(params) {
  const t = todayStr();
  const month = params.get('m') || t.slice(0, 7);
  loading('calendar', 'mid');
  const { meals } = await api('/meals?scope=month&month=' + month);
  const [y, mo] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, mo - 1, 1));
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const shift = (n) => { const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return d.toISOString().slice(0, 7); };
  let cells = '';
  for (let i = 0; i < lead; i++) cells += '<div class="day blank"></div>';
  for (let d = 1; d <= days; d++) {
    const ds = `${month}-${String(d).padStart(2, '0')}`;
    const dm = meals.filter((m) => m.date === ds);
    const link = dm.length === 1 ? `#/meal/${dm[0].id}` : dm.length > 1 ? `#/day/${ds}` : isAdmin() ? `#/new?date=${ds}` : '#/calendar?m=' + month;
    cells += `<a class="day ${ds === t ? 'today' : ''}" href="${link}"><span class="n">${d}</span>${dm.map((m) => `<span class="m">${esc(m.title)}</span>`).join('')}</a>`;
  }
  const label = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  shell(`
    <div class="row between" style="margin-bottom:10px">
      <a class="btn small" href="#/calendar?m=${shift(-1)}" aria-label="Previous month">${icon('chevron-left')}</a><h2 style="margin:0">${label}</h2><a class="btn small" href="#/calendar?m=${shift(1)}" aria-label="Next month">${icon('chevron-right')}</a>
    </div>
    <div class="cal">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div class="dow">${d}</div>`).join('')}${cells}</div>
    ${isAdmin() ? '<p class="muted" style="margin-top:12px">Tap an empty day to add a meal on that date.</p>' : ''}
  `, 'calendar', 'mid');
}

async function viewDay(date) {
  loading('calendar');
  const { meals, today } = await api('/meals?scope=month&month=' + date.slice(0, 7));
  const list = meals.filter((m) => m.date === date);
  shell(`<h2>${fmtDate(date)}</h2><div class="grid">${list.map((m) => mealCard(m, today)).join('')}</div>`, 'calendar');
}

async function viewMeal(id) {
  loading('home');
  const { meal: m, ingredients, today } = await api('/meals/' + id);
  const a = isAdmin();
  const sp = m.split;
  const past = m.date && m.date <= today;
  const meId = S.me.id;
  // Who has ticked what: each ticked ingredient shows its provider's profile picture and name.
  const provider = (i) => (i.have && i.have_by ? { id: i.have_by, name: i.have_name || 'Someone', avatar_key: i.have_avatar } : null);
  const ings = ingredients.map((i) => {
    const p = provider(i);
    return `<label class="ing ${i.have ? 'done' : ''}">
      <input type="checkbox" ${i.have ? 'checked' : ''} data-act="have" data-id="${i.id}" aria-label="Have ${esc(i.name)}">
      <span class="grow"><span class="nm">${esc(i.name)}${i.qty ? ` <span class="muted">${esc(i.qty)}</span>` : ''}</span>
        ${p ? `<span class="prov">${avatar(p, 'xs')}<span>${p.id === meId ? 'You have this' : esc(p.name) + ' has this'}</span></span>` : ''}</span>
      <span class="${i.have ? 'muted' : ''}">${i.price_pence ? money(i.price_pence) : ''}</span>
    </label>`;
  }).join('');
  const givers = [];
  for (const i of ingredients) {
    const p = provider(i);
    if (!p) continue;
    let g = givers.find((x) => x.id === p.id);
    if (!g) givers.push((g = { ...p, n: 0 }));
    g.n++;
  }
  givers.sort((x, y) => (y.id === meId) - (x.id === meId));
  const giverNames = (list) => list.length <= 2 ? list.map((g) => (g.id === meId ? 'You' : esc(g.name))).join(' and ')
    : `${list.length} people`;
  const items = givers.reduce((x, g) => x + g.n, 0);
  const verb = givers.length === 1 && givers[0].id !== meId ? 'is' : 'are';
  const covered = givers.length
    ? `<div class="row covered">${stackAv(givers)}<span class="muted">${giverNames(givers)} ${verb} covering ${items} ${items === 1 ? 'item' : 'items'}</span></div>`
    : '';
  let payBlock = '';
  if (a && past) {
    const rows = m.ins.filter((u) => u.user_id !== m.cook_id).map((u) => {
      const st = m.payments[u.user_id] || 'unpaid';
      const badge = st === 'confirmed' ? '<span class="badge good">Paid</span>' : st === 'claimed' ? '<span class="badge warn">Says paid</span>' : '<span class="badge bad">Owes</span>';
      const btn = st === 'confirmed'
        ? `<button class="btn small" data-act="pay" data-id="${m.id}" data-u="${u.user_id}" data-s="unpaid">Undo</button>`
        : `<button class="btn small primary" data-act="pay" data-id="${m.id}" data-u="${u.user_id}" data-s="confirmed">Confirm paid</button>`;
      return `<div class="row wrapflex payrow">${avatar(u, 'sm')}<span class="grow">${esc(u.name)} <span class="muted">${money(sp.per)}</span></span>${badge}${btn}</div>`;
    }).join('');
    payBlock = `<div class="card pad"><h2>Payments</h2>${rows || '<p class="muted">Nobody opted in.</p>'}</div>`;
  }
  shell(`
    <div class="meal-cols">
    <div class="col">
    <div class="card">
      ${m.image_key ? `<img class="hero lg" src="${imgUrl(m.image_key)}" alt="">` : ''}
      <div class="pad">
        <div class="row between wrapflex"><span class="muted">${m.date ? fmtDate(m.date) : m.status === 'requested' ? 'Requested' : 'Date to be decided'}${m.date === today ? ' (today)' : ''}</span>
          ${m.cook_name ? `<span class="row" style="gap:6px">${avatar({ name: m.cook_name, avatar_key: m.cook_avatar }, 'sm')}<span class="muted">${esc(m.cook_name)}</span></span>` : ''}</div>
        <h1 style="margin-top:6px">${esc(m.title)}</h1>
        ${m.description ? `<p style="white-space:pre-wrap">${esc(m.description)}</p>` : ''}
        ${m.status === 'scheduled' && (!past || m.date === today) ? rsvpButtons(m) : ''}
      </div>
    </div>
    ${m.status === 'scheduled' ? `<div class="totals" style="margin-bottom:14px">
      <div class="line"><span>Still to buy</span><span>${money(sp.needed)}</span></div>
      ${sp.auto ? '' : `<div class="line"><span>Cook's set total</span><span>${money(sp.total)}</span></div>`}
      <div class="line"><span>${sp.diners} ${sp.diners === 1 ? 'person' : 'people'} joining (plus the cook)</span><span></span></div>
      <div class="line big"><span>${isAdmin() ? 'Each person pays' : m.my_rsvp === 'in' ? 'Your share' : 'Each person pays'}</span><span>${money(sp.per)}</span></div>
      <div class="line muted"><span>Cook pays</span><span>${money(sp.cook)}</span></div>
      ${a ? `<form data-form="total" data-id="${m.id}" class="row" style="margin-top:10px">
        <input id="t-total" inputmode="decimal" placeholder="Set total £ (blank = auto)" value="${sp.auto ? '' : (sp.total / 100).toFixed(2)}">
        <button class="btn small primary">Save</button></form>` : ''}
    </div>` : ''}
    </div>
    <div class="col">
    <div class="card pad">
      <div class="row between"><h2 style="margin:0">Ingredients</h2><span class="muted">${m.ing_missing} still needed</span></div>
      <p class="muted" style="margin:4px 0 8px">Tick what you already have and your profile shows next to it.</p>
      ${covered}
      ${ings || '<p class="muted">No ingredients listed.</p>'}
    </div>
    ${m.status === 'scheduled' ? `<div class="card pad">
      <h2>Who's in</h2>
      <div class="row wrapflex">${m.ins.length ? m.ins.map((u) => `<span class="row" style="gap:6px">${avatar(u, 'sm')}${esc(u.name)}</span>`).join('') : '<span class="muted">Nobody yet</span>'}</div>
      ${m.outs.length ? `<h3 style="margin-top:12px">Out</h3><div class="row wrapflex">${m.outs.map((u) => `<span class="row muted" style="gap:6px">${avatar(u, 'sm')}${esc(u.name)}</span>`).join('')}</div>` : ''}
    </div>` : ''}
    ${payBlock}
    ${a && m.status === 'scheduled' && !m.date ? `<form class="card pad row" data-form="schedule" data-id="${m.id}"><input type="date" id="sd-${m.id}" value="${todayStr()}" required><button class="btn small primary">${icon('calendar-plus')}Set date</button></form>` : ''}
    ${a ? `<div class="row wrapflex">
      <a class="btn" href="#/edit/${m.id}">${icon('pencil')}Edit</a>
      <a class="btn" href="#/new?from=${m.id}">${icon('repeat')}Cook again</a>
      <button class="btn danger" data-act="del-meal" data-id="${m.id}">${icon('trash-2')}Delete</button></div>` : ''}
    </div>
    </div>
  `, 'home');
}

// ---------- meal form (admin add/edit, user request) ----------
let F = null;
async function openForm(opts) {
  // opts: {mode:'admin'|'request', id?, from?, date?}
  F = { mode: opts.mode, id: opts.id || null, title: '', description: '', date: opts.date || '', image_key: null, total: '', ingredients: [{ name: '', qty: '', price: '', have: 0 }] };
  const src = opts.id || opts.from;
  if (src) {
    const { meal, ingredients } = await api('/meals/' + src);
    F.title = meal.title; F.description = meal.description || ''; F.image_key = meal.image_key;
    if (opts.id) { F.date = meal.date || F.date; F.total = meal.total_override_pence == null ? '' : (meal.total_override_pence / 100).toFixed(2); }
    F.ingredients = ingredients.map((i) => ({ name: i.name, qty: i.qty, price: i.price_pence ? (i.price_pence / 100).toFixed(2) : '', have: opts.id ? i.have : 0 }));
    if (!F.ingredients.length) F.ingredients = [{ name: '', qty: '', price: '', have: 0 }];
  }
  F.bank = (await api('/price-bank')).items;
  renderForm();
}
function readForm() {
  if (!F || !document.getElementById('f-title')) return;
  F.title = document.getElementById('f-title').value;
  F.description = document.getElementById('f-desc').value;
  const d = document.getElementById('f-date'); if (d) F.date = d.value;
  const t = document.getElementById('f-total'); if (t) F.total = t.value;
  F.ingredients = [...document.querySelectorAll('.ingrow')].map((r) => ({
    name: r.querySelector('.i-name').value, qty: r.querySelector('.i-qty').value,
    price: r.querySelector('.i-price').value, have: Number(r.dataset.have) || 0,
    cat: r.dataset.cat || '', auto: r.dataset.auto === '1',
  }));
}
function renderForm() {
  const admin = F.mode === 'admin';
  const title = admin ? (F.id ? 'Edit meal' : 'Add a meal') : 'Request a meal';
  const rows = F.ingredients.map((i, n) => `<div class="ingrow" data-have="${i.have}" data-cat="${esc(i.cat || '')}" data-auto="${i.auto ? 1 : 0}">
      <input class="i-name" list="price-bank" placeholder="Ingredient" value="${esc(i.name)}">
      <input class="i-qty" placeholder="Qty" value="${esc(i.qty)}">
      <input class="i-price" inputmode="decimal" placeholder="£" value="${esc(i.price)}">
      <button type="button" class="btn small" data-act="rm-ing" data-n="${n}" aria-label="Remove">${icon('x')}</button>
      <div class="hint">${esc(hintText(i.cat, i.auto))}</div>
    </div>`).join('');
  shell(`<h1>${title}</h1>
    ${admin && !F.id ? `<a class="btn block" href="#/bank" style="margin-bottom:12px">${icon('library')}Pick from meal bank</a>` : ''}
    <form class="card pad" data-form="meal">
      <div class="imgpick"><span id="f-prev">${F.image_key ? `<img src="${imgUrl(F.image_key)}" alt="">` : `<span class="imgph">${icon('camera')}</span>`}</span>
        <div class="grow"><label style="margin-top:0">Photo of the meal</label><input type="file" id="f-file" accept="image/*"></div></div>
      <label>Meal name</label><input id="f-title" maxlength="100" required value="${esc(F.title)}">
      <label>Description / notes</label><textarea id="f-desc">${esc(F.description)}</textarea>
      ${admin ? `<label>Date <span class="muted">(optional, leave blank if not decided yet. Everyone sees it once set)</span></label><input id="f-date" type="date" value="${esc(F.date)}">` : ''}
      <label>Ingredients <span class="muted">(pick an item for a real Tesco price per pack, then change the quantity)</span></label>
      <datalist id="price-bank">${F.bank.map((b) => `<option value="${esc(b.name)}" label="${esc(b.pack ? b.pack + ' · ' : '')}£${(b.price_pence / 100).toFixed(2)}${b.unit ? ' per ' + esc(b.unit) : ''}"></option>`).join('')}</datalist>
      ${rows}
      <div class="row wrapflex" style="margin-top:6px"><button type="button" class="btn small" data-act="add-ing">${icon('plus')}Add ingredient</button>
        <a class="btn small" id="tesco-link" target="_blank" rel="noopener" href="https://www.tesco.com/groceries/en-GB/search?query=">${icon('search')}Search Tesco</a></div>
      <div class="totals" id="f-sum" style="margin-top:12px"></div>
      ${admin ? `<label>Total price to split £ <span class="muted">(leave blank to use the ingredient total)</span></label><input id="f-total" inputmode="decimal" value="${esc(F.total)}">` : ''}
      <button class="btn primary block" style="margin-top:16px">${admin ? 'Save meal' : 'Send request'}</button>
    </form>`, admin ? 'home' : 'requests', 'narrow');
  updateSum();
}

const bankFind = (name) => (F?.bank || []).find((b) => b.name.toLowerCase() === String(name || '').trim().toLowerCase());
const qtyNum = (q) => { const m = String(q || '').match(/^\s*(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 1; };
function hintText(cat, auto) {
  const b = cat && bankFind(cat);
  if (!b || b.source !== 'catalog') return '';
  const one = `${b.product || b.name}: £${(b.price_pence / 100).toFixed(2)} per ${b.unit}`;
  return auto ? one + ' (price = quantity x this)' : one + ' (price edited by hand)';
}
function setHint(row) { const h = row.querySelector('.hint'); if (h) h.textContent = hintText(row.dataset.cat, row.dataset.auto === '1'); }
function priceFromQty(row) {
  const b = bankFind(row.dataset.cat);
  if (!b || b.source !== 'catalog' || row.dataset.auto !== '1') return;
  row.querySelector('.i-price').value = (Math.round(b.price_pence * qtyNum(row.querySelector('.i-qty').value)) / 100).toFixed(2);
}

function updateSum() {
  const el = document.getElementById('f-sum');
  if (!el) return;
  let all = 0, need = 0, count = 0;
  document.querySelectorAll('.ingrow').forEach((r) => {
    const v = Math.round((parseFloat(r.querySelector('.i-price').value) || 0) * 100);
    if (r.querySelector('.i-name').value.trim()) count++;
    all += v;
    if (!Number(r.dataset.have)) need += v;
  });
  const t = document.getElementById('f-total');
  const raw = t ? t.value.trim() : '';
  const ov = raw !== '' && Number.isFinite(parseFloat(raw)) ? Math.round(parseFloat(raw) * 100) : null;
  const line = (a, b, cls = '') => `<div class="line ${cls}"><span>${a}</span><span>${b}</span></div>`;
  let h = line(`Ingredients total (${count} ${count === 1 ? 'item' : 'items'})`, money(all));
  if (need !== all) h += line('Still to buy (ticked items removed)', money(need));
  if (F && F.mode === 'admin') {
    h += line(ov === null ? 'Total to split' : 'Total to split (your fixed total)', money(ov === null ? need : ov), 'big');
  } else {
    h += line('Estimated meal cost', money(need), 'big');
  }
  el.innerHTML = h;
}

async function submitForm() {
  readForm();
  const ingredients = F.ingredients.filter((i) => i.name.trim()).map((i) => ({
    name: i.name, qty: i.qty, price_pence: Math.round((parseFloat(i.price) || 0) * 100), have: i.have,
  }));
  const payload = { title: F.title, description: F.description, image_key: F.image_key, ingredients };
  if (F.mode === 'admin') {
    payload.date = F.date || null;
    payload.total_override_pence = F.total.trim() === '' ? null : Math.round(parseFloat(F.total) * 100);
    if (payload.total_override_pence !== null && !Number.isFinite(payload.total_override_pence)) throw new Error('Total must be a number');
    if (F.id) { await api('/meals/' + F.id, 'PUT', payload); location.hash = '#/meal/' + F.id; }
    else { const r = await api('/meals', 'POST', payload); location.hash = '#/meal/' + r.id; }
    toast('Saved');
  } else {
    await api('/requests', 'POST', payload);
    toast('Request sent');
    location.hash = '#/requests';
  }
}

async function viewBank() {
  loading('bank', 'narrow');
  const { meals } = await api('/meals?scope=bank');
  shell(`<h1>Meal bank</h1><p class="muted">Everything you have cooked before. Tap one to schedule it again.</p>
    ${meals.map((m) => `<a class="card row" style="text-decoration:none;color:inherit;padding:10px" href="#/new?from=${m.id}">
      ${m.image_key ? `<img class="av" style="width:64px;height:64px;border-radius:10px" src="${imgUrl(m.image_key)}" alt="">` : `<span class="av" style="width:64px;height:64px;border-radius:10px">${esc(m.title[0])}</span>`}
      <div class="grow"><b>${esc(m.title)}</b><div class="muted">${m.ing_total} ingredients &middot; cooked ${m.times}x &middot; last ${m.date ? fmtDate(m.date) : 'no date'}</div></div>
      <span class="btn small primary">${icon('plus')}Use</span></a>`).join('') || '<div class="card pad muted">Nothing yet. Meals you add will show up here.</div>'}
    <a class="btn block" href="#/new">${icon('plus')}New meal from scratch</a>`, 'bank', 'narrow');
}

async function viewRequests() {
  loading('requests', 'narrow');
  const { requests } = await api('/requests');
  shell(`<div class="row between"><h1 style="margin:0">Meal requests</h1><a class="btn primary small" href="#/request">${icon('plus')}Request</a></div>
    <p class="muted">Fancy something? Suggest a meal and the cook can schedule it.</p>
    ${requests.map((r) => `<div class="card">
      ${r.image_key ? `<img class="hero" src="${imgUrl(r.image_key)}" alt="" loading="lazy">` : ''}
      <div class="pad">
        <h2>${esc(r.title)}</h2>
        ${r.description ? `<p style="white-space:pre-wrap">${esc(r.description)}</p>` : ''}
        <div class="row between wrapflex"><span class="row muted" style="gap:6px">${avatar({ name: r.requester_name, avatar_key: r.requester_avatar }, 'sm')}${esc(r.requester_name || '')} &middot; ${r.ing_total} ingredients</span>
          <a class="btn small" href="#/meal/${r.id}">View</a></div>
        ${isAdmin() ? `<form class="row" data-form="schedule" data-id="${r.id}" style="margin-top:10px"><input type="date" id="sd-${r.id}" value="${todayStr()}" required><button class="btn small primary">${icon('calendar-plus')}Schedule</button></form>` : ''}
        ${isAdmin() || r.requested_by === S.me.id ? `<button class="btn small danger" style="margin-top:8px" data-act="del-meal" data-id="${r.id}" data-back="requests">${icon('trash-2')}Remove</button>` : ''}
      </div></div>`).join('') || '<div class="card pad muted">No requests right now.</div>'}`, 'requests', 'narrow');
}

async function viewPay() {
  loading('pay', 'narrow');
  const [{ rows }, { settings: s }] = await Promise.all([api('/balances'), api('/settings')]);
  S.settings = s;
  const owed = (r) => r.status !== 'confirmed';
  const a = isAdmin();
  let body = '';
  if (a) {
    const by = {};
    for (const r of rows) (by[r.user_id] ||= { name: r.name, avatar_key: r.avatar_key, rows: [] }).rows.push(r);
    const people = Object.values(by).map((u) => ({ ...u, total: u.rows.filter(owed).reduce((x, r) => x + r.amount, 0) })).sort((x, y) => y.total - x.total);
    body = `<h1>Who owes you</h1>` + (people.map((u) => `<div class="card pad">
      <div class="row between"><span class="row">${avatar(u)}<b>${esc(u.name)}</b></span><b>${u.total ? money(u.total) : '<span class="badge good">All paid</span>'}</b></div>
      ${u.rows.filter(owed).map((r) => `<div class="row wrapflex payrow">
        <span class="grow">${esc(r.title)} <span class="muted">${fmtDate(r.date)} &middot; ${money(r.amount)}</span></span>
        ${r.status === 'claimed' ? '<span class="badge warn">Says paid</span>' : ''}
        <button class="btn small primary" data-act="pay" data-id="${r.meal_id}" data-u="${r.user_id}" data-s="confirmed">Confirm</button></div>`).join('')}
    </div>`).join('') || '<div class="card pad muted">Nobody has opted in to a past meal yet.</div>');
  } else {
    const mine = rows.filter(owed);
    const total = mine.reduce((x, r) => x + r.amount, 0);
    body = `<h1>Pay the cook</h1>
      <div class="totals" style="margin-bottom:14px"><div class="line big"><span>You owe</span><span>${money(total)}</span></div>
        <div class="row" style="margin-top:8px"><button class="btn small" data-act="copy" data-v="${(total / 100).toFixed(2)}">${icon('copy')}Copy amount</button></div></div>
      ${mine.map((r) => `<div class="card pad row">
        <div class="grow"><b>${esc(r.title)}</b><div class="muted">${fmtDate(r.date)} &middot; ${money(r.amount)}</div></div>
        ${r.status === 'claimed'
          ? `<span class="badge warn">Waiting for cook</span><button class="btn small" data-act="pay" data-id="${r.meal_id}" data-u="${r.user_id}" data-s="unpaid">Undo</button>`
          : `<button class="btn small primary" data-act="pay" data-id="${r.meal_id}" data-u="${r.user_id}" data-s="claimed">I've paid</button>`}</div>`).join('') || '<div class="card pad muted">You are all settled up.</div>'}`;
  }
  const bank = [
    ['Beneficiary', s.bank_beneficiary], ['Sort code', s.bank_sort_code], ['Account number', s.bank_account],
    ['Currency', s.bank_currency], ['Bank', s.bank_name], ['Bank address', s.bank_address],
  ].filter(([, v]) => v);
  body += `<div class="card pad"><h2>Bank details</h2>
    ${bank.map(([k, v]) => `<div class="copyrow"><div><div class="muted">${k}</div><div class="v">${esc(v)}</div></div>
      <button class="btn small" data-act="copy" data-v="${esc(v)}">${icon('copy')}Copy</button></div>`).join('')}</div>`;
  shell(body, 'pay', 'narrow');
}

async function viewMe() {
  const a = isAdmin();
  let settingsHtml = '';
  if (a) {
    const { settings: s } = await api('/settings');
    const f = (k, l) => `<label>${l}</label><input id="s-${k}" value="${esc(s[k] || '')}">`;
    settingsHtml = `<form class="card pad" data-form="settings"><h2>Bank details</h2>
      ${f('bank_beneficiary', 'Beneficiary')}${f('bank_sort_code', 'Sort code')}${f('bank_account', 'Account number')}
      ${f('bank_currency', 'Currency')}${f('bank_name', 'Bank')}${f('bank_address', 'Bank address')}
      <h2 style="margin-top:16px">Splitting</h2>
      <label>Cook's share of a normal portion (0 to 1). 0.5 means you pay half what everyone else pays.</label>
      <input id="s-cook_weight" inputmode="decimal" value="${esc(s.cook_weight || '0.5')}">
      <button class="btn primary block" style="margin-top:14px">Save settings</button></form>`;
  }
  shell(`<h1>Profile</h1>
    <form class="card pad" data-form="profile">
      <div class="imgpick"><span id="m-prev">${avatar(S.me, 'big')}</span>
        <div class="grow"><label style="margin-top:0">Profile picture</label><input type="file" id="m-file" accept="image/*"></div></div>
      <label>Name</label><input id="m-name" maxlength="30" value="${esc(S.me.name)}" required>
      <button class="btn primary block" style="margin-top:14px">Save</button>
    </form>
    ${settingsHtml}
    <button class="btn block" data-act="logout">${icon('log-out')}Log out</button>
    <p class="muted" style="text-align:center;margin-top:14px"><a href="#" data-act="replay">View the intro again</a></p>`, 'me', 'narrow');
}

// ---------- router ----------
async function render() {
  if (!S.me) { return viewAuth(); }
  const [path, qs] = location.hash.slice(1).split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(qs || '');
  try {
    switch (parts[0]) {
      case undefined: return await viewHome();
      case 'calendar': return await viewCalendar(params);
      case 'day': return await viewDay(parts[1]);
      case 'meal': return await viewMeal(parts[1]);
      case 'new': if (!isAdmin()) return (location.hash = '#/'); return await openForm({ mode: 'admin', from: params.get('from'), date: params.get('date') });
      case 'edit': if (!isAdmin()) return (location.hash = '#/'); return await openForm({ mode: 'admin', id: parts[1] });
      case 'request': return await openForm({ mode: 'request' });
      case 'requests': return await viewRequests();
      case 'bank': if (!isAdmin()) return (location.hash = '#/'); return await viewBank();
      case 'pay': return await viewPay();
      case 'me': return await viewMe();
      default: location.hash = '#/';
    }
  } catch (e) {
    shell(`<div class="card pad"><p>${esc(e.message)}</p><button class="btn" onclick="render()">Try again</button></div>`, null);
  }
}

// ---------- events ----------
const ACTIONS = {
  'ob-next': () => { S.ob++; viewAuth(); },
  'ob-back': () => { S.ob--; viewAuth(); },
  'ob-profile': () => { S.authMode = 'profile'; viewAuth(); },
  'auth-mode': (el) => { S.authMode = el.dataset.m; viewAuth(); },
  replay: () => { S.ob = 0; S.authMode = 'onboard'; S.me = null; localStorage.removeItem('ff-seen'); render(); },
  copy: (el) => copyText(el.dataset.v),
  rsvp: async (el) => {
    const cur = el.classList.contains('in') || el.classList.contains('out');
    await api(`/meals/${el.dataset.id}/rsvp`, 'POST', { status: cur ? null : el.dataset.s });
    await refresh();
  },
  have: async (el) => {
    try { await api(`/ingredients/${el.dataset.id}/have`, 'POST', { have: el.checked }); }
    catch (e) { toast(e.message); } // e.g. someone else ticked it; the refresh below puts the box back
    await refresh();
  },
  pay: async (el) => { await api(`/meals/${el.dataset.id}/pay`, 'POST', { user_id: el.dataset.u, status: el.dataset.s }); await refresh(); },
  'del-meal': async (el) => {
    if (!confirm('Delete this? This cannot be undone.')) return;
    await api('/meals/' + el.dataset.id, 'DELETE');
    location.hash = el.dataset.back ? '#/' + el.dataset.back : '#/';
    render();
  },
  'add-ing': () => { readForm(); F.ingredients.push({ name: '', qty: '', price: '', have: 0 }); renderForm(); },
  'rm-ing': (el) => { readForm(); F.ingredients.splice(Number(el.dataset.n), 1); if (!F.ingredients.length) F.ingredients.push({ name: '', qty: '', price: '', have: 0 }); renderForm(); },
  logout: async () => { await api('/logout', 'POST'); S.me = null; S.authMode = 'login'; render(); },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  if (el.tagName === 'A') e.preventDefault();
  const fn = ACTIONS[el.dataset.act];
  if (fn) guard(fn)(el);
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.matches('input[data-act=have]')) return guard(ACTIONS.have)(el);
  if (el.id === 'f-file') {
    const f = el.files[0]; if (!f) return;
    guard(async () => {
      readForm();
      toast('Uploading...');
      F.image_key = await uploadImage(f, 1000);
      document.getElementById('f-prev').innerHTML = `<img src="${imgUrl(F.image_key)}" alt="">`;
      toast('Photo added');
    })();
  }
  if (el.id === 'p-file' || el.id === 'm-file') {
    const f = el.files[0]; if (!f) return;
    el._file = f;
    const prev = document.getElementById(el.id === 'p-file' ? 'p-prev' : 'm-prev');
    prev.innerHTML = `<img class="av big" src="${URL.createObjectURL(f)}" alt="">`;
  }
  if (el.classList.contains('i-name')) { // autofill qty and price from the catalogue
    const row = el.closest('.ingrow');
    const hit = bankFind(el.value);
    const price = row.querySelector('.i-price'), qty = row.querySelector('.i-qty');
    if (hit && hit.source === 'catalog') {
      const manual = price.value && row.dataset.auto !== '1';
      if (!qty.value || row.dataset.auto === '1') qty.value = hit.qty;
      row.dataset.cat = hit.name;
      if (!manual) { row.dataset.auto = '1'; priceFromQty(row); }
      setHint(row); updateSum();
    } else if (hit) {
      row.dataset.cat = ''; row.dataset.auto = '0';
      if (!price.value && hit.price_pence) price.value = (hit.price_pence / 100).toFixed(2);
      if (!qty.value && hit.qty) qty.value = hit.qty;
      setHint(row); updateSum();
    } else { row.dataset.cat = ''; row.dataset.auto = '0'; setHint(row); }
  }
});
document.addEventListener('input', (e) => {
  if (e.target.classList.contains('i-qty')) { const row = e.target.closest('.ingrow'); priceFromQty(row); updateSum(); }
  if (e.target.classList.contains('i-price')) { const row = e.target.closest('.ingrow'); if (row.dataset.auto === '1') { row.dataset.auto = '0'; setHint(row); } updateSum(); }
  if (e.target.id === 'f-total') updateSum();
  if (e.target.classList.contains('i-name')) {
    const l = document.getElementById('tesco-link');
    if (l) l.href = 'https://www.tesco.com/groceries/en-GB/search?query=' + encodeURIComponent(e.target.value);
  }
});
document.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  const kind = form.dataset.form;
  const v = (id) => document.getElementById(id)?.value ?? '';
  guard(async () => {
    if (kind === 'register') {
      await api('/register', 'POST', { name: v('p-name'), pin: v('p-pin'), join_code: v('p-code') });
      const f = document.getElementById('p-file').files[0];
      if (f) { try { const key = await uploadImage(f, 400); await api('/me', 'PATCH', { avatar_key: key }); } catch { toast('Joined, but the photo failed to upload'); } }
      localStorage.setItem('ff-seen', '1');
      await boot();
    } else if (kind === 'login') {
      await api('/login', 'POST', { name: v('l-name'), pin: v('l-pin') });
      await boot();
    } else if (kind === 'cook') {
      await api('/admin-login', 'POST', { password: v('c-pass') });
      await boot();
    } else if (kind === 'meal') {
      await submitForm();
    } else if (kind === 'total') {
      const raw = v('t-total').trim();
      const { meal, ingredients } = await api('/meals/' + form.dataset.id);
      const val = raw === '' ? null : Math.round(parseFloat(raw) * 100);
      if (val !== null && !Number.isFinite(val)) throw new Error('Total must be a number');
      await api('/meals/' + form.dataset.id, 'PUT', {
        title: meal.title, description: meal.description, image_key: meal.image_key, date: meal.date, total_override_pence: val,
        ingredients: ingredients.map((i) => ({ name: i.name, qty: i.qty, price_pence: i.price_pence, have: i.have })),
      });
      toast('Total updated'); render();
    } else if (kind === 'schedule') {
      await api(`/meals/${form.dataset.id}/schedule`, 'POST', { date: v('sd-' + form.dataset.id) });
      toast('Scheduled'); location.hash = '#/meal/' + form.dataset.id; render();
    } else if (kind === 'profile') {
      const f = document.getElementById('m-file').files[0];
      if (f) await api('/me', 'PATCH', { avatar_key: await uploadImage(f, 400) });
      await api('/me', 'PATCH', { name: v('m-name') });
      S.me = (await api('/me')).user; toast('Profile saved'); render();
    } else if (kind === 'settings') {
      const body = {};
      for (const k of ['bank_beneficiary', 'bank_sort_code', 'bank_account', 'bank_currency', 'bank_name', 'bank_address', 'cook_weight']) body[k] = v('s-' + k);
      await api('/settings', 'PUT', body); toast('Settings saved');
    }
  })();
});
window.addEventListener('hashchange', render);

async function boot() {
  try {
    S.cfg = await api('/config');
    S.me = (await api('/me')).user;
  } catch { S.me = null; }
  if (!S.me && localStorage.getItem('ff-seen')) S.authMode = 'login';
  if (location.hash === '' || !S.me) { /* stay */ }
  render();
}
boot();
