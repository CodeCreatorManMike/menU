// Turns schema.sql into src/schema.js (one statement per array item) so the Worker
// can create its own tables on first run. Run: npm run gen
import fs from 'node:fs';
const sql = fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')
  .split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
const statements = sql.split(';').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
fs.writeFileSync(new URL('../src/schema.js', import.meta.url),
  '// Generated from schema.sql by scripts/gen-schema.mjs. Do not edit by hand.\nexport const STATEMENTS = ' + JSON.stringify(statements, null, 2) + ';\n');
console.log(statements.length + ' statements written to src/schema.js');
