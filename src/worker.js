// Worker entry: /api/* goes to the API, everything else is served from ./public.
import { onRequest } from './api.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return onRequest({ request, env });
    return env.ASSETS.fetch(request);
  },
};
