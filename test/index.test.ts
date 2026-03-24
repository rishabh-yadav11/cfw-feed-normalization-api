import { describe, it, expect, vi, beforeEach } from 'vitest';
import app from '../src/index';

const mockKV = {
  get: async (key: string) => {
    if (key.startsWith('apikey:')) {
      return JSON.stringify({
        key_id: 'test_key',
        plan: 'pro',
        scopes: ['feed:read'],
        status: 'active',
      });
    }
    return null;
  },
  put: async () => {},
};

const MOCK_ENV = {
  KV: mockKV as any,
};

const MOCK_CTX = {
  waitUntil: (promise: Promise<any>) => {},
  passThroughOnException: () => {},
  props: {},
} as any;

describe('Feed Normalization API', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('should return 401 without auth', async () => {
    const res = await app.fetch(new Request('http://localhost/v1/feed/parse?url=https://example.com'), MOCK_ENV, MOCK_CTX);
    expect(res.status).toBe(401);
  });

  it('should parse rss feed', async () => {
    const mockRss = `
      <rss version="2.0">
        <channel>
          <title>Test Feed</title>
          <item>
            <title>Post 1</title>
            <link>https://example.com/1</link>
          </item>
        </channel>
      </rss>
    `;
    (globalThis as any).fetch.mockResolvedValue(new Response(mockRss));

    const req = new Request('http://localhost/v1/feed/parse?url=https://example.com/feed.xml', {
      headers: { 'Authorization': 'Bearer test_token' }
    });
    const res = await app.fetch(req, MOCK_ENV, MOCK_CTX);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.data.rss.channel.title).toBe('Test Feed');
  });

  it('should normalize rss feed', async () => {
    const mockRss = `
      <rss version="2.0">
        <channel>
          <title>Test Feed</title>
          <item>
            <title>Post 1</title>
            <link>https://example.com/1</link>
          </item>
        </channel>
      </rss>
    `;
    (globalThis as any).fetch.mockResolvedValue(new Response(mockRss));

    const req = new Request('http://localhost/v1/feed/normalize?url=https://example.com/feed.xml', {
      headers: { 'Authorization': 'Bearer test_token' }
    });
    const res = await app.fetch(req, MOCK_ENV, MOCK_CTX);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.data.title).toBe('Test Feed');
    expect(body.data.items[0].title).toBe('Post 1');
  });

  it('should block local urls', async () => {
    const req = new Request('http://localhost/v1/feed/parse?url=http://127.0.0.1/secret', {
      headers: { 'Authorization': 'Bearer test_token' }
    });
    const res = await app.fetch(req, MOCK_ENV, MOCK_CTX);
    expect(res.status).toBe(502);
    const body: any = await res.json();
    expect(body.error.message).toBe('Invalid or blocked URL');
  });
});
