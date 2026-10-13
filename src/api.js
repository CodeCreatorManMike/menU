// API for every /api/* request (used by src/worker.js and local-server.mjs).
// Bindings: DB (D1), IMAGES (R2). Secrets: ADMIN_PASSWORD, optional JOIN_CODE.
import { STATEMENTS } from './schema.js';

// Creates the tables and default items the first time the app runs against an empty database.
let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  const has = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'catalog'").first();
  if (!has) await env.DB.batch(STATEMENTS.map((s) => env.DB.prepare(s)));
  schemaReady = true;
}

const enc = new TextEncoder();
const json = (d, s = 200, h = {}) =>
  new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json', ...h } });
const fail = (m, s = 400) => json({ error: m }, s);
const rid = () => crypto.randomUUID().replace(/-/g, '');
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());

async function sha(text) {
  const b = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function cookie(req, name) {
  const c = req.headers.get('cookie') || '';
  const m = c.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? m[1] : null;
}

async function getUser(req, env) {
  const sid = cookie(req, 'sid');
  if (!sid) return null;
  return env.DB.prepare(
    'SELECT u.id, u.name, u.avatar_key, u.is_admin FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?'
  ).bind(sid, Date.now()).first();
}

async function startSession(env, req, userId) {
  const sid = rid() + rid();
  const maxAge = 60 * 60 * 24 * 180;
  await env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(sid, userId, Date.now() + maxAge * 1000).run();
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

async function getSettings(env) {
  const rows = (await env.DB.prepare('SELECT key, value FROM settings').all()).results;
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  return s;
}

// ---- cost + split -------------------------------------------------------
// total = admin override if set, otherwise the price of ingredients not yet ticked.
// Diners (everyone opted in except the cook) pay an equal share; the cook counts as
// `cookWeight` of a share (default 0.5) so the cook always pays less.
function computeSplit(needed, override, dinerCount, cookWeight) {
  const total = override ?? needed;
  let per = 0;
  let cook = total;
  if (dinerCount > 0) {
    per = Math.ceil(total / (dinerCount + cookWeight));
    cook = Math.max(0, total - per * dinerCount);
  }
  return { needed, total, auto: override == null, per, cook, diners: dinerCount };
}

async function summarise(env, meals, meId) {
  if (!meals.length) return [];
  const ids = meals.map((m) => m.id);
  const ph = ids.map(() => '?').join(',');
  const cfg = await getSettings(env);
  const w = parseFloat(cfg.cook_weight);
  const cookWeight = Number.isFinite(w) ? Math.min(Math.max(w, 0), 1) : 0.5;
  const [ing, rs, pay] = await Promise.all([
    env.DB.prepare(
      `SELECT meal_id, SUM(CASE WHEN have = 0 THEN price_pence ELSE 0 END) needed, COUNT(*) n, SUM(CASE WHEN have = 0 THEN 1 ELSE 0 END) missing
       FROM ingredients WHERE meal_id IN (${ph}) GROUP BY meal_id`
    ).bind(...ids).all(),
    env.DB.prepare(
      `SELECT r.meal_id, r.user_id, r.status, u.name, u.avatar_key FROM rsvps r JOIN users u ON u.id = r.user_id WHERE r.meal_id IN (${ph})`
    ).bind(...ids).all(),
    env.DB.prepare(`SELECT meal_id, user_id, status FROM payments WHERE meal_id IN (${ph})`).bind(...ids).all(),
  ]);
  const ingBy = {}, rsBy = {}, payBy = {};
  for (const r of ing.results) ingBy[r.meal_id] = r;
  for (const r of rs.results) (rsBy[r.meal_id] ||= []).push(r);
  for (const r of pay.results) (payBy[r.meal_id] ||= {})[r.user_id] = r.status;
  return meals.map((m) => {
    const i = ingBy[m.id] || { needed: 0, n: 0, missing: 0 };
    const r = rsBy[m.id] || [];
    const ins = r.filter((x) => x.status === 'in');
    const outs = r.filter((x) => x.status === 'out');
    const diners = ins.filter((x) => x.user_id !== m.cook_id);
    const mine = r.find((x) => x.user_id === meId);
    return {
      ...m,
      ing_total: i.n,
      ing_missing: i.missing || 0,
      ins: ins.map(({ user_id, name, avatar_key }) => ({ user_id, name, avatar_key })),
      outs: outs.map(({ user_id, name, avatar_key }) => ({ user_id, name, avatar_key })),
      my_rsvp: mine ? mine.status : null,
      split: computeSplit(i.needed || 0, m.total_override_pence, diners.length, cookWeight),
      payments: payBy[m.id] || {},
    };
  });
}

// ---- ingredient helpers ------------------------------------------------
function cleanIngredients(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((x, idx) => ({
      name: String(x.name || '').trim().slice(0, 80),
      qty: String(x.qty || '').trim().slice(0, 40),
      price_pence: Math.max(0, Math.min(100000, Math.round(Number(x.price_pence) || 0))),
      have: x.have ? 1 : 0,
      sort: idx,
    }))
    .filter((x) => x.name)
    .slice(0, 60);
}

function ingredientStatements(env, mealId, list) {
  const stmts = [env.DB.prepare('DELETE FROM ingredients WHERE meal_id = ?').bind(mealId)];
  for (const i of list) {
    stmts.push(
      env.DB.prepare('INSERT INTO ingredients (meal_id, name, qty, price_pence, have, sort) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(mealId, i.name, i.qty, i.price_pence, i.have, i.sort)
    );
  }
  return stmts;
}

const MEAL_COLS = 'm.*, cu.name AS cook_name, cu.avatar_key AS cook_avatar, ru.name AS requester_name, ru.avatar_key AS requester_avatar';
const MEAL_JOIN = 'FROM meals m LEFT JOIN users cu ON cu.id = m.cook_id LEFT JOIN users ru ON ru.id = m.requested_by';

const validDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const p = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const method = request.method;
  try {
    await ensureSchema(env);
    return await route(request, env, url, p, method);
  } catch (e) {
    return fail(e.message || 'Server error', 500);
  }
}

async function route(request, env, url, p, method) {
  const body = async () => {
    try { return await request.json(); } catch { return {}; }
  };

  // ---- public routes ----
  if (p[0] === 'config' && method === 'GET') {
    return json({ needs_code: !!env.JOIN_CODE, configured: !!env.ADMIN_PASSWORD });
  }

  if (p[0] === 'register' && method === 'POST') {
    const b = await body();
    const name = String(b.name || '').trim();
    const pin = String(b.pin || '');
    if (name.length < 2 || name.length > 30) return fail('Name must be 2 to 30 characters');
    if (!/^\d{4,8}$/.test(pin)) return fail('PIN must be 4 to 8 digits');
    if (env.JOIN_CODE && String(b.join_code || '').trim() !== env.JOIN_CODE) return fail('Wrong flat code', 403);
    const exists = await env.DB.prepare('SELECT id FROM users WHERE name_lc = ?').bind(name.toLowerCase()).first();
    if (exists) return fail('That name is taken. Log in instead?', 409);
    const id = rid(), salt = rid();
    await env.DB.prepare('INSERT INTO users (id, name, name_lc, pin_hash, salt) VALUES (?, ?, ?, ?, ?)')
      .bind(id, name, name.toLowerCase(), await sha(salt + pin), salt).run();
    const c = await startSession(env, request, id);
    return json({ ok: true }, 200, { 'set-cookie': c });
  }

  if (p[0] === 'login' && method === 'POST') {
    const b = await body();
    const u = await env.DB.prepare('SELECT * FROM users WHERE name_lc = ?').bind(String(b.name || '').trim().toLowerCase()).first();
    if (!u || u.is_admin || (await sha(u.salt + String(b.pin || ''))) !== u.pin_hash) return fail('Wrong name or PIN', 401);
    return json({ ok: true }, 200, { 'set-cookie': await startSession(env, request, u.id) });
  }

  if (p[0] === 'admin-login' && method === 'POST') {
    const b = await body();
    if (!env.ADMIN_PASSWORD) return fail('ADMIN_PASSWORD is not set on the server', 500);
    if (String(b.password || '') !== env.ADMIN_PASSWORD) return fail('Wrong password', 401);
    let admin = await env.DB.prepare('SELECT id FROM users WHERE is_admin = 1 LIMIT 1').first();
    if (!admin) {
      const id = rid(), salt = rid();
      let name = (env.ADMIN_NAME || 'Michael Jones').trim();
      const clash = await env.DB.prepare('SELECT id FROM users WHERE name_lc = ?').bind(name.toLowerCase()).first();
      if (clash) name += ' (cook)';
      await env.DB.prepare('INSERT INTO users (id, name, name_lc, pin_hash, salt, is_admin) VALUES (?, ?, ?, ?, ?, 1)')
        .bind(id, name, name.toLowerCase(), 'x', salt).run();
      admin = { id };
    }
    return json({ ok: true }, 200, { 'set-cookie': await startSession(env, request, admin.id) });
  }

  if (p[0] === 'img' && p[1] && method === 'GET') {
    const obj = await env.IMAGES.get('img/' + p[1].replace(/[^a-z0-9]/gi, ''));
    if (!obj) return new Response('Not found', { status: 404 });
    return new Response(obj.body, {
      headers: { 'content-type': obj.httpMetadata?.contentType || 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' },
    });
  }

  // ---- everything below needs a logged-in user ----
  const user = await getUser(request, env);
  if (p[0] === 'me' && method === 'GET') return json({ user: user || null });
  if (!user) return fail('Please log in', 401);
  const admin = !!user.is_admin;
  const needAdmin = () => (admin ? null : fail('Only the cook can do that', 403));

  if (p[0] === 'logout' && method === 'POST') {
    const sid = cookie(request, 'sid');
    if (sid) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sid).run();
    return json({ ok: true }, 200, { 'set-cookie': 'sid=; Path=/; Max-Age=0' });
  }

  if (p[0] === 'me' && method === 'PATCH') {
    const b = await body();
    if (b.name !== undefined) {
      const name = String(b.name).trim();
      if (name.length < 2 || name.length > 30) return fail('Name must be 2 to 30 characters');
      const clash = await env.DB.prepare('SELECT id FROM users WHERE name_lc = ? AND id != ?').bind(name.toLowerCase(), user.id).first();
      if (clash) return fail('That name is taken', 409);
      await env.DB.prepare('UPDATE users SET name = ?, name_lc = ? WHERE id = ?').bind(name, name.toLowerCase(), user.id).run();
    }
    if (b.avatar_key !== undefined) {
      await env.DB.prepare('UPDATE users SET avatar_key = ? WHERE id = ?').bind(String(b.avatar_key).replace(/[^a-z0-9]/gi, '') || null, user.id).run();
    }
    return json({ ok: true });
  }

  if (p[0] === 'upload' && method === 'POST') {
    const type = request.headers.get('content-type') || '';
    if (!type.startsWith('image/')) return fail('Images only');
    const buf = await request.arrayBuffer();
    if (buf.byteLength > 3 * 1024 * 1024) return fail('Image too large (max 3MB)');
    if (buf.byteLength < 100) return fail('Empty image');
    const key = rid();
    await env.IMAGES.put('img/' + key, buf, { httpMetadata: { contentType: type } });
    return json({ key });
  }

  if (p[0] === 'settings') {
    if (method === 'GET') {
      const s = await getSettings(env);
      return json({ settings: s });
    }
    if (method === 'PUT') {
      const no = needAdmin(); if (no) return no;
      const b = await body();
      const allowed = ['bank_currency', 'bank_beneficiary', 'bank_sort_code', 'bank_account', 'bank_name', 'bank_address', 'cook_weight'];
      const stmts = [];
      for (const k of allowed) {
        if (b[k] === undefined) continue;
        let v = String(b[k]).trim().slice(0, 200);
        if (k === 'cook_weight') {
          const n = parseFloat(v);
          if (!Number.isFinite(n) || n < 0 || n > 1) return fail('Cook share must be between 0 and 1');
          v = String(n);
        }
        stmts.push(env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, v));
      }
      if (stmts.length) await env.DB.batch(stmts);
      return json({ ok: true });
    }
  }

  if (p[0] === 'price-bank' && method === 'GET') {
    // Default catalogue first, then prices from meals you have saved (those win).
    const merged = new Map();
    const base = (await env.DB.prepare('SELECT name, qty, price_pence FROM catalog').all()).results;
    for (const r of base) merged.set(r.name.toLowerCase(), r);
    const used = (await env.DB.prepare(
      'SELECT name, price_pence, qty FROM ingredients WHERE id IN (SELECT MAX(id) FROM ingredients WHERE price_pence > 0 GROUP BY lower(name))'
    ).all()).results;
    for (const r of used) merged.set(r.name.toLowerCase(), r);
    const items = [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
    return json({ items });
  }

  // ---- meals ----
  if (p[0] === 'meals' && !p[1] && method === 'GET') {
    const scope = url.searchParams.get('scope') || 'upcoming';
    const t = today();
    if (scope === 'bank') {
      const rows = (await env.DB.prepare(
        `SELECT m.id, m.title, m.image_key, m.date,
          (SELECT COUNT(*) FROM meals x WHERE x.status = 'scheduled' AND lower(x.title) = lower(m.title)) AS times,
          (SELECT COUNT(*) FROM ingredients i WHERE i.meal_id = m.id) AS ing_total
         FROM meals m
         WHERE m.status = 'scheduled' AND m.id = (SELECT MAX(id) FROM meals y WHERE y.status = 'scheduled' AND lower(y.title) = lower(m.title))
         ORDER BY m.title COLLATE NOCASE`
      ).all()).results;
      return json({ meals: rows });
    }
    let q, binds;
    if (scope === 'month') {
      const m = url.searchParams.get('month') || t.slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(m)) return fail('Bad month');
      q = `SELECT ${MEAL_COLS} ${MEAL_JOIN} WHERE m.status = 'scheduled' AND m.date LIKE ? ORDER BY m.date, m.id`;
      binds = [m + '-%'];
    } else {
      q = `SELECT ${MEAL_COLS} ${MEAL_JOIN} WHERE m.status = 'scheduled' AND m.date >= ? ORDER BY m.date, m.id LIMIT 30`;
      binds = [t];
    }
    const meals = (await env.DB.prepare(q).bind(...binds).all()).results;
    let undated = [];
    if (scope !== 'month') {
      undated = (await env.DB.prepare(`SELECT ${MEAL_COLS} ${MEAL_JOIN} WHERE m.status = 'scheduled' AND m.date IS NULL ORDER BY m.id DESC LIMIT 20`).all()).results;
    }
    const all = await summarise(env, [...meals, ...undated], user.id);
    return json({ meals: all.slice(0, meals.length), undated: all.slice(meals.length), today: t });
  }

  if (p[0] === 'meals' && !p[1] && method === 'POST') {
    const no = needAdmin(); if (no) return no;
    const b = await body();
    const title = String(b.title || '').trim().slice(0, 100);
    if (!title) return fail('Give the meal a name');
    if (b.date && !validDate(b.date)) return fail('Bad date');
    const override = b.total_override_pence === null || b.total_override_pence === undefined || b.total_override_pence === ''
      ? null : Math.max(0, Math.round(Number(b.total_override_pence)));
    const res = await env.DB.prepare(
      "INSERT INTO meals (title, description, image_key, date, status, cook_id, total_override_pence) VALUES (?, ?, ?, ?, 'scheduled', ?, ?)"
    ).bind(title, String(b.description || '').slice(0, 2000), b.image_key || null, b.date || null, user.id, override).run();
    const id = res.meta.last_row_id;
    await env.DB.batch(ingredientStatements(env, id, cleanIngredients(b.ingredients)));
    return json({ id });
  }

  if (p[0] === 'meals' && p[1] && !p[2] && method === 'GET') {
    const id = Number(p[1]);
    const meal = await env.DB.prepare(`SELECT ${MEAL_COLS} ${MEAL_JOIN} WHERE m.id = ?`).bind(id).first();
    if (!meal) return fail('Meal not found', 404);
    const ingredients = (await env.DB.prepare('SELECT * FROM ingredients WHERE meal_id = ? ORDER BY sort, id').bind(id).all()).results;
    const [s] = await summarise(env, [meal], user.id);
    return json({ meal: s, ingredients, today: today() });
  }

  if (p[0] === 'meals' && p[1] && !p[2] && method === 'PUT') {
    const no = needAdmin(); if (no) return no;
    const id = Number(p[1]);
    const b = await body();
    const title = String(b.title || '').trim().slice(0, 100);
    if (!title) return fail('Give the meal a name');
    if (b.date && !validDate(b.date)) return fail('Bad date');
    const override = b.total_override_pence === null || b.total_override_pence === undefined || b.total_override_pence === ''
      ? null : Math.max(0, Math.round(Number(b.total_override_pence)));
    await env.DB.prepare('UPDATE meals SET title = ?, description = ?, image_key = ?, date = ?, total_override_pence = ? WHERE id = ?')
      .bind(title, String(b.description || '').slice(0, 2000), b.image_key || null, b.date || null, override, id).run();
    if (Array.isArray(b.ingredients)) await env.DB.batch(ingredientStatements(env, id, cleanIngredients(b.ingredients)));
    return json({ ok: true });
  }

  if (p[0] === 'meals' && p[1] && !p[2] && method === 'DELETE') {
    const id = Number(p[1]);
    const meal = await env.DB.prepare('SELECT * FROM meals WHERE id = ?').bind(id).first();
    if (!meal) return fail('Meal not found', 404);
    const own = meal.status === 'requested' && meal.requested_by === user.id;
    if (!admin && !own) return fail('Not allowed', 403);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM ingredients WHERE meal_id = ?').bind(id),
      env.DB.prepare('DELETE FROM rsvps WHERE meal_id = ?').bind(id),
      env.DB.prepare('DELETE FROM payments WHERE meal_id = ?').bind(id),
      env.DB.prepare('DELETE FROM meals WHERE id = ?').bind(id),
    ]);
    return json({ ok: true });
  }

  if (p[0] === 'meals' && p[1] && p[2] === 'schedule' && method === 'POST') {
    const no = needAdmin(); if (no) return no;
    const b = await body();
    if (!validDate(b.date)) return fail('Pick a date');
    await env.DB.prepare("UPDATE meals SET status = 'scheduled', date = ?, cook_id = ? WHERE id = ?").bind(b.date, user.id, Number(p[1])).run();
    return json({ ok: true });
  }

  if (p[0] === 'meals' && p[1] && p[2] === 'rsvp' && method === 'POST') {
    const id = Number(p[1]);
    const b = await body();
    const meal = await env.DB.prepare('SELECT * FROM meals WHERE id = ?').bind(id).first();
    if (!meal || meal.status !== 'scheduled') return fail('Meal not found', 404);
    if (meal.date < today()) return fail('That meal has already happened');
    if (b.status === 'in' || b.status === 'out') {
      await env.DB.prepare('INSERT INTO rsvps (meal_id, user_id, status) VALUES (?, ?, ?) ON CONFLICT(meal_id, user_id) DO UPDATE SET status = excluded.status')
        .bind(id, user.id, b.status).run();
    } else {
      await env.DB.prepare('DELETE FROM rsvps WHERE meal_id = ? AND user_id = ?').bind(id, user.id).run();
    }
    return json({ ok: true });
  }

  if (p[0] === 'meals' && p[1] && p[2] === 'pay' && method === 'POST') {
    const id = Number(p[1]);
    const b = await body();
    let uid = user.id, status = b.status;
    if (admin) {
      if (b.user_id) uid = String(b.user_id);
      if (!['unpaid', 'claimed', 'confirmed'].includes(status)) return fail('Bad status');
    } else {
      if (!['unpaid', 'claimed'].includes(status)) return fail('Bad status');
      const cur = await env.DB.prepare('SELECT status FROM payments WHERE meal_id = ? AND user_id = ?').bind(id, uid).first();
      if (cur && cur.status === 'confirmed') return fail('Already confirmed by the cook');
    }
    await env.DB.prepare(
      "INSERT INTO payments (meal_id, user_id, status, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(meal_id, user_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at"
    ).bind(id, uid, status).run();
    return json({ ok: true });
  }

  if (p[0] === 'ingredients' && p[1] && p[2] === 'have' && method === 'POST') {
    const b = await body();
    await env.DB.prepare('UPDATE ingredients SET have = ? WHERE id = ?').bind(b.have ? 1 : 0, Number(p[1])).run();
    return json({ ok: true });
  }

  // ---- requests ----
  if (p[0] === 'requests' && !p[1] && method === 'GET') {
    const rows = (await env.DB.prepare(
      `SELECT ${MEAL_COLS}, (SELECT COUNT(*) FROM ingredients i WHERE i.meal_id = m.id) AS ing_total ${MEAL_JOIN} WHERE m.status = 'requested' ORDER BY m.id DESC LIMIT 50`
    ).all()).results;
    return json({ requests: rows });
  }

  if (p[0] === 'requests' && !p[1] && method === 'POST') {
    const b = await body();
    const title = String(b.title || '').trim().slice(0, 100);
    if (!title) return fail('What meal are you requesting?');
    const res = await env.DB.prepare(
      "INSERT INTO meals (title, description, image_key, status, requested_by) VALUES (?, ?, ?, 'requested', ?)"
    ).bind(title, String(b.description || '').slice(0, 2000), b.image_key || null, user.id).run();
    await env.DB.batch(ingredientStatements(env, res.meta.last_row_id, cleanIngredients(b.ingredients)));
    return json({ id: res.meta.last_row_id });
  }

  // ---- balances ----
  if (p[0] === 'balances' && method === 'GET') {
    const t = today();
    const meals = (await env.DB.prepare(
      `SELECT ${MEAL_COLS} ${MEAL_JOIN} WHERE m.status = 'scheduled' AND m.date <= ? ORDER BY m.date DESC, m.id DESC LIMIT 60`
    ).bind(t).all()).results;
    const sums = await summarise(env, meals, user.id);
    const rows = [];
    for (const m of sums) {
      for (const u of m.ins) {
        if (u.user_id === m.cook_id) continue;
        if (!admin && u.user_id !== user.id) continue;
        rows.push({
          meal_id: m.id, title: m.title, date: m.date,
          user_id: u.user_id, name: u.name, avatar_key: u.avatar_key,
          amount: m.split.per, status: m.payments[u.user_id] || 'unpaid',
        });
      }
    }
    return json({ rows });
  }

  return fail('Not found', 404);
}
