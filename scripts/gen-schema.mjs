// Generates two files from the sources of truth:
//   schema.sql      -> src/schema.js   (one statement per array item, creates the tables)
//   data/catalog.tsv -> src/catalog.js (Tesco product catalogue, loaded into the products table)
// Run: npm run gen
import fs from 'node:fs';
import crypto from 'node:crypto';

const sql = fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')
  .split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
const statements = sql.split(';').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
fs.writeFileSync(new URL('../src/schema.js', import.meta.url),
  '// Generated from schema.sql by scripts/gen-schema.mjs. Do not edit by hand.\nexport const STATEMENTS = ' + JSON.stringify(statements, null, 2) + ';\n');
console.log(statements.length + ' statements written to src/schema.js');

const raw = fs.readFileSync(new URL('../data/catalog.tsv', import.meta.url), 'utf8');
const rows = raw.split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l, n) => {
  const [category, name, unit, pack, price, product] = l.split('\t');
  const pence = Math.round(parseFloat(price) * 100);
  if (!category || !name || !unit || !pack || !Number.isFinite(pence) || pence <= 0) throw new Error('Bad catalogue row ' + (n + 1) + ': ' + l);
  return { category, name, unit, pack, pence, product: product || '' };
});
const seen = new Set();
for (const r of rows) { const k = r.name.toLowerCase(); if (seen.has(k)) throw new Error('Duplicate catalogue name: ' + r.name); seen.add(k); }
const q = (v) => "'" + String(v).replace(/'/g, "''") + "'";
const version = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 10);
const CREATE = 'CREATE TABLE IF NOT EXISTS products (name_lc TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, unit TEXT NOT NULL, pack TEXT NOT NULL, price_pence INTEGER NOT NULL, product TEXT NOT NULL DEFAULT \'\')';
const inserts = [];
for (let i = 0; i < rows.length; i += 40) {
  const vals = rows.slice(i, i + 40).map((r) => `(${[q(r.name.toLowerCase()), q(r.name), q(r.category), q(r.unit), q(r.pack), r.pence, q(r.product)].join(',')})`);
  inserts.push('INSERT OR REPLACE INTO products (name_lc, name, category, unit, pack, price_pence, product) VALUES ' + vals.join(','));
}
fs.writeFileSync(new URL('../src/catalog.js', import.meta.url),
  '// Generated from data/catalog.tsv by scripts/gen-schema.mjs. Do not edit by hand.\n' +
  `export const CATALOG_VERSION = ${q(version)};\nexport const CATALOG_CREATE = ${JSON.stringify(CREATE)};\nexport const CATALOG_STATEMENTS = ${JSON.stringify(inserts, null, 2)};\n`);
console.log(rows.length + ' catalogue items (' + inserts.length + ' statements), version ' + version);
