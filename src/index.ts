import { Hono } from 'hono';
import { XMLParser } from 'fast-xml-parser';
import { requestIdMiddleware } from './middlewares/requestId';
import { bodyLimitMiddleware } from './middlewares/bodyLimit';
import { authMiddleware } from './middlewares/auth';
import { rateLimitMiddleware } from './middlewares/rateLimit';
import { Env, Variables } from './types';
import { isUrlAllowed } from './utils/ssrf';

const app = new Hono<{ Bindings: Env, Variables: Variables }>();

app.use('*', requestIdMiddleware);
app.use('*', bodyLimitMiddleware);

app.get('/', (c) => {
  return c.json({
    ok: true,
    message: 'Feed Normalization API',
    version: '1.0.0',
  });
});

// Protected routes
const protectedRoutes = new Hono<{ Bindings: Env, Variables: Variables }>();
protectedRoutes.use('*', authMiddleware('feed:read'));
protectedRoutes.use('*', rateLimitMiddleware);

async function fetchAndParseFeed(url: string) {
  if (!isUrlAllowed(url)) {
    throw new Error('Invalid or blocked URL');
  }

  const response = await fetch(url, {
    headers: { 'User-Agent': 'CFW-Feed-Normalization-Bot/1.0' },
    cf: { cacheTtl: 1800 }, // Cache for 30m as per spec
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch feed: ${response.statusText}`);
  }

  const xml = await response.text();
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  });
  return parser.parse(xml);
}

function normalizeFeed(parsed: any) {
  // Very basic normalization logic for RSS/Atom
  const channel = parsed.rss?.channel || parsed.feed;
  const items = channel?.item || channel?.entry || [];
  const normalizedItems = (Array.isArray(items) ? items : [items]).map((item: any) => ({
    title: item.title?.['#text'] || item.title || '',
    link: item.link?.['@_href'] || item.link || '',
    description: item.description || item.summary || item.content?.['#text'] || '',
    pubDate: item.pubDate || item.published || item.updated || '',
    id: item.guid?.['#text'] || item.id || item.link || '',
  }));

  return {
    title: channel?.title || '',
    description: channel?.description || '',
    link: channel?.link || '',
    items: normalizedItems,
  };
}

protectedRoutes.get('/parse', async (c) => {
  const url = c.req.query('url');
  if (!url) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'URL is required' } }, 400);

  try {
    const parsed = await fetchAndParseFeed(url);
    return c.json({ ok: true, data: parsed, request_id: c.get('requestId') });
  } catch (e: any) {
    return c.json({ ok: false, error: { code: 'UPSTREAM_ERROR', message: e.message } }, 502);
  }
});

protectedRoutes.get('/normalize', async (c) => {
  const url = c.req.query('url');
  if (!url) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'URL is required' } }, 400);

  try {
    const parsed = await fetchAndParseFeed(url);
    const normalized = normalizeFeed(parsed);
    return c.json({ ok: true, data: normalized, request_id: c.get('requestId') });
  } catch (e: any) {
    return c.json({ ok: false, error: { code: 'UPSTREAM_ERROR', message: e.message } }, 502);
  }
});

protectedRoutes.post('/batch', async (c) => {
  const { urls } = await c.req.json();
  if (!Array.isArray(urls)) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'urls array is required' } }, 400);

  const results = await Promise.all(
    urls.slice(0, 10).map(async (url) => {
      try {
        const parsed = await fetchAndParseFeed(url);
        return { url, ok: true, data: normalizeFeed(parsed) };
      } catch (e: any) {
        return { url, ok: false, error: e.message };
      }
    })
  );

  return c.json({ ok: true, data: results, request_id: c.get('requestId') });
});

app.route('/v1/feed', protectedRoutes);

export default app;
