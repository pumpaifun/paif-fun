const configuration = require('../app.json');
const allowed = new Map([
  ['/api/trending-tokens', 'GET'],
  ['/api/swing-bot/market-weather', 'GET'],
  ['/api/scan', 'POST'],
]);

function publicResearchProxy(next) {
  return async (req, res, fallback) => {
    const path = new URL(req.url, 'http://preview.invalid').pathname;
    if (!path.startsWith('/api/')) return next(req, res, fallback);
    if (allowed.get(path) !== req.method) {
      res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ error: 'This companion exposes public research only.' }));
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), req.method === 'POST' ? 65_000 : 20_000);
    try {
      const origin = process.env.EXPO_PUBLIC_API_URL || configuration.expo.extra.apiOrigin;
      if (!/^https:\/\/[^/]+\/?$/.test(origin)) throw new Error('Invalid HTTPS backend configuration.');
      let body;
      if (req.method === 'POST') {
        const chunks = [];
        let length = 0;
        for await (const chunk of req) {
          length += chunk.length;
          if (length > 2048) {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'The token query is too long.' }));
          }
          chunks.push(chunk);
        }
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (typeof data.query !== 'string' || data.query.length > 256 || Object.keys(data).length !== 1) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'A single token query is required.' }));
        }
        body = JSON.stringify({ query: data.query });
      }
      const upstream = await fetch(`${origin.replace(/\/$/, '')}${path}`, {
        method: req.method, body, signal: controller.signal,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        redirect: 'error',
      });
      if (!(upstream.headers.get('content-type') || '').includes('application/json')) {
        throw new Error('The PAIF backend did not return research data.');
      }
      res.writeHead(upstream.status, {
        'Content-Type': 'application/json', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(await upstream.text());
    } catch (cause) {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: controller.signal.aborted ? 'Research request timed out.' : cause.message || 'Research API is unavailable.' }));
    } finally { clearTimeout(timeout); }
  };
}
module.exports = { publicResearchProxy };
