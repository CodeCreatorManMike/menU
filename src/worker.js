// Cloudflare Worker entry: /api/* goes to the API, everything else is a static file from public/.
import { onRequest } from './api.js';
import schemaSql from '../schema.sql';

let ready = null;

// Creates the tables on first request, so a fresh database needs no manual setup step.
async function ensureSchema(env) {
  try {
    await env.DB.prepare('SELECT 1 FROM catalog LIMIT 1').first();
    return;
  } catch {
    const statements = schemaSql
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n')
      .split(/;\s*\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    await env.DB.batch(statements.map((s) => env.DB.prepare(s)));
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      ready ??= ensureSchema(env).catch((e) => { ready = null; throw e; });
      try { await ready; } catch (e) {
        return new Response(JSON.stringify({ error: 'Database setup failed: ' + e.message }), { status: 500, headers: { 'content-type': 'application/json' } });
      }
      return onRequest({ request, env });
    }
    return env.ASSETS.fetch(request);
  },
};
