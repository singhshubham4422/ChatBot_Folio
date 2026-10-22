import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import { handleOnline } from './api/online';
import { statusPayload } from './api/online-status';

function loadRootEnv() {
  try {
    const source = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    for (const line of source.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      else value = value.replace(/\s+#.*$/, '').trim();
      process.env[match[1]] = value;
    }
  } catch { /* A local .env is optional; provider status will say Unavailable. */ }
}

loadRootEnv();

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

import { request as httpsRequest } from 'node:https';

function isAllowedHfHost(hostname: string): boolean {
  return (
    hostname === 'huggingface.co' ||
    hostname.endsWith('.huggingface.co') ||
    hostname === 'hf.co' ||
    hostname.endsWith('.hf.co') ||
    hostname.endsWith('.cloudfront.net') ||
    hostname.endsWith('.amazonaws.com')
  );
}

function proxyHfRequest(req: IncomingMessage, res: ServerResponse, targetUrl: string, maxRedirects = 5) {
  if (maxRedirects <= 0) {
    return sendJson(res, 502, { error: { code: 'too_many_redirects', message: 'Too many redirects when fetching model asset.' } });
  }

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return sendJson(res, 400, { error: { code: 'invalid_url', message: 'Invalid upstream URL.' } });
  }

  if (!isAllowedHfHost(parsed.hostname)) {
    return sendJson(res, 403, { error: { code: 'forbidden_host', message: 'Host not permitted.' } });
  }

  const headers: Record<string, string | string[]> = {
    'User-Agent': 'Folio-LocalModel-Proxy/1.0',
    'Accept': '*/*',
  };
  if (req.headers.range) {
    headers['Range'] = req.headers.range;
  }

  const upstreamReq = httpsRequest(
    {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: req.method || 'GET',
      family: 4,
      headers,
    },
    (upstreamRes) => {
      const statusCode = upstreamRes.statusCode ?? 502;
      if (statusCode >= 300 && statusCode < 400 && upstreamRes.headers.location) {
        const nextUrl = new URL(upstreamRes.headers.location, targetUrl).href;
        return proxyHfRequest(req, res, nextUrl, maxRedirects - 1);
      }

      res.statusCode = statusCode;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', '*');

      const allowedHeaders = [
        'content-type',
        'content-length',
        'etag',
        'cache-control',
        'accept-ranges',
        'content-range',
        'last-modified',
      ];
      for (const [key, val] of Object.entries(upstreamRes.headers)) {
        if (val !== undefined && allowedHeaders.includes(key.toLowerCase())) {
          res.setHeader(key, val);
        }
      }

      upstreamRes.pipe(res);
    }
  );

  upstreamReq.on('error', (err) => {
    if (!res.headersSent) {
      sendJson(res, 502, {
        error: {
          code: 'upstream_fetch_failed',
          message: `Could not fetch model asset: ${err.message}`,
          url: targetUrl,
        },
      });
    }
  });

  req.on('close', () => {
    upstreamReq.destroy();
  });

  upstreamReq.end();
}

function folioApiMiddleware(req: IncomingMessage, res: ServerResponse, next: () => void) {
  const reqUrl = new URL(req.url ?? '/', 'http://localhost');
  const path = reqUrl.pathname;

  if (path.startsWith('/api/hf-proxy/')) {
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', '*');
      return res.end();
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'Method not allowed.' } });
    }
    const subpath = path.slice('/api/hf-proxy/'.length);
    const targetUrl = `https://huggingface.co/${subpath}${reqUrl.search}`;
    return proxyHfRequest(req, res, targetUrl);
  }

  if (path === '/api/online/status') {
    if (req.method !== 'GET') return sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'Method not allowed.' } });
    return sendJson(res, 200, statusPayload());
  }

  if (path !== '/api/online') return next();
  if (req.method !== 'POST') return sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'Method not allowed.' } });

  let raw = '';
  void (async () => {
    try {
      for await (const chunk of req) {
        raw += String(chunk);
        if (raw.length > 24_000) return sendJson(res, 413, { error: { code: 'payload_too_large', message: 'The selected excerpts are too large.' } });
      }
      const result = await handleOnline(JSON.parse(raw || '{}'));
      return sendJson(res, result.status, result.body);
    } catch {
      return sendJson(res, 400, { error: { code: 'invalid_request', message: 'The request could not be accepted.' } });
    }
  })();
}

function localApi(): Plugin {
  return {
    name: 'folio-local-api',
    configureServer(server) {
      server.middlewares.use(folioApiMiddleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(folioApiMiddleware);
    },
  };
}

export default defineConfig({
  plugins: [localApi()],
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-dom/client', 'lucide-react'],
    esbuildOptions: { preserveSymlinks: true, absWorkingDir: process.cwd() },
  },
  cacheDir: resolve(process.cwd(), 'node_modules/.vite'),
});
