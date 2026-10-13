// Local runner: serves public/ and the same API code Cloudflare runs, using Node's
// built-in SQLite instead of D1. No Cloudflare account,
// no wrangler, nothing to install. Needs Node 22.5 or newer.
//
//   node local-server.mjs          start on http://localhost:8787
//   node local-server.mjs --demo   same, plus sample flatmates and meals
//
// Cook password locally: changeme (override with ADMIN_PASSWORD=...).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

let DatabaseSync;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  console.error('This needs Node 22.5 or newer (node:sqlite). Your version is ' + process.version + '.');
  console.error('Alternative: npm install, then npm run db:local and npm run dev (uses wrangler).');
  process.exit(1);
}

const root = path.dirname(fileURLToPath(import.meta.url));
const local = path.join(root, '.local');
fs.mkdirSync(local, { recursive: true });

const { onRequest } = await import(pathToFileURL(path.join(root, 'src/api.js')).href);

const sqlite = new DatabaseSync(path.join(local, 'flat-feast.db'));
sqlite.exec(fs.readFileSync(path.join(root, 'schema.sql'), 'utf8'));

const stmt = (sql) => {
  let args = [];
  const o = {
    bind: (...a) => { args = a; return o; },
    all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
    first: async () => sqlite.prepare(sql).get(...args) ?? null,
    run: async () => { const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid) } }; },
    _run: () => sqlite.prepare(sql).run(...args),
  };
  return o;
};
const env = {
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'changeme',
  JOIN_CODE: process.env.JOIN_CODE || undefined,
  DB: {
    prepare: stmt,
    batch: async (list) => {
      sqlite.exec('BEGIN');
      try { list.forEach((s) => s._run()); sqlite.exec('COMMIT'); } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
      return [];
    },
  },
};

// ---- optional demo data ----
if (process.argv.includes('--demo') && !sqlite.prepare('SELECT 1 FROM meals LIMIT 1').get()) {
  const rid = () => crypto.randomUUID().replace(/-/g, '');
  const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
  const day = (n) => {
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/London' }));
    d.setDate(d.getDate() + n);
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  };
  const addUser = (name, admin = 0) => {
    const id = rid(), salt = rid();
    sqlite.prepare('INSERT INTO users (id, name, name_lc, pin_hash, salt, is_admin) VALUES (?,?,?,?,?,?)')
      .run(id, name, name.toLowerCase(), admin ? 'x' : sha(salt + '1234'), salt, admin);
    return id;
  };
  const cook = addUser('Michael Jones', 1);
  const people = ['Alice', 'Bob', 'Cara', 'Dev'].map((n) => addUser(n));
  const addMeal = (title, desc, date, ings, status = 'scheduled', by = null) => {
    const r = sqlite.prepare('INSERT INTO meals (title, description, date, status, cook_id, requested_by) VALUES (?,?,?,?,?,?)')
      .run(title, desc, date, status, status === 'scheduled' ? cook : null, by);
    const id = Number(r.lastInsertRowid);
    ings.forEach(([name, qty, p, by], i) => sqlite.prepare('INSERT INTO ingredients (meal_id,name,qty,price_pence,have,have_by,sort) VALUES (?,?,?,?,?,?,?)').run(id, name, qty, p, by ? 1 : 0, by || null, i));
    return id;
  };
  const rsvp = (m, u, s) => sqlite.prepare('INSERT INTO rsvps (meal_id,user_id,status) VALUES (?,?,?)').run(m, u, s);
  const past = addMeal('Chicken Tikka Masala', 'Big batch with rice and naan.', day(-2), [['Chicken thighs', '2kg', 900], ['Tikka paste', '2 jars', 300], ['Basmati rice', '1kg', 250], ['Naan', '8', 200]]);
  [0, 1, 2].forEach((i) => rsvp(past, people[i], 'in')); rsvp(past, people[3], 'out');
  sqlite.prepare("INSERT INTO payments (meal_id,user_id,status) VALUES (?,?,'claimed')").run(past, people[0]);
  const t1 = addMeal('Beef Chilli', 'Slow cooked, with rice and nachos.', day(0), [['Beef mince', '1kg', 650], ['Kidney beans', '3 tins', 210], ['Chopped tomatoes', '4 tins', 280], ['Rice', '1kg', 200, people[1]], ['Tortilla chips', '2 bags', 300, people[0]]]);
  [0, 1].forEach((i) => rsvp(t1, people[i], 'in')); rsvp(t1, people[2], 'out');
  const t2 = addMeal('Spaghetti Bolognese', 'Classic, with garlic bread.', day(2), [['Spaghetti', '1kg', 160, people[0]], ['Beef mince', '1kg', 650], ['Passata', '2 jars', 240], ['Garlic bread', '3', 270]]);
  rsvp(t2, people[1], 'in');
  addMeal('Veggie Lasagne', 'Layered with spinach and ricotta.', day(5), [['Lasagne sheets', '1 box', 180], ['Spinach', '500g', 200], ['Ricotta', '2 tubs', 300], ['Cheddar', '400g', 380]]);
  addMeal('Thai Green Curry', 'Please! With extra veg.', null, [['Green curry paste', '2', 240], ['Coconut milk', '4 tins', 400]], 'requested', people[2]);
  console.log('Demo data loaded. Flatmates: Alice, Bob, Cara, Dev, PIN 1234 for all.');
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.json': 'application/json' };
const PORT = Number(process.env.PORT) || 8787;

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost:' + PORT);
    if (url.pathname.startsWith('/api/')) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length && !['GET', 'HEAD'].includes(req.method) ? Buffer.concat(chunks) : undefined;
      const r = await onRequest({ request: new Request(url, { method: req.method, headers: req.headers, body }), env });
      const headers = {};
      r.headers.forEach((v, k) => { headers[k] = v; });
      res.writeHead(r.status, headers);
      res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(root, 'public', rel));
    if (!file.startsWith(path.join(root, 'public')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('Not found'); return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    res.writeHead(500); res.end(String(e.message || e));
  }
}).listen(PORT, () => {
  console.log(`menU running at http://localhost:${PORT}`);
  console.log(`Cook password: ${env.ADMIN_PASSWORD}`);
});
