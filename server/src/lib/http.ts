import { config } from '../config.js';

/**
 * Polite HTTP client: per-host rate limiting, timeouts, bounded retries with backoff.
 * Only used against public APIs/feeds and public pages; never sends credentials or bypasses auth.
 */
const lastHit = new Map<string, number>();
const MIN_GAP_MS: Record<string, number> = { default: 700, 'remoteok.com': 2000, 'himalayas.app': 1200 };

export class HttpError extends Error {
  constructor(public status: number, public url: string, msg?: string) {
    super(msg ?? `HTTP ${status} for ${url}`);
  }
}

async function throttle(url: string) {
  const host = new URL(url).hostname.replace(/^www\./, '');
  const gap = MIN_GAP_MS[host] ?? MIN_GAP_MS.default;
  const prev = lastHit.get(host) ?? 0;
  const wait = prev + gap - Date.now();
  lastHit.set(host, Math.max(Date.now(), prev + gap));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

export interface FetchOpts { retries?: number; timeoutMs?: number; accept?: string; method?: string; allow404?: boolean }

export async function fetchText(url: string, o: FetchOpts = {}): Promise<{ status: number; text: string; finalUrl: string }> {
  const retries = o.retries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle(url);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 25000);
    try {
      const res = await fetch(url, {
        method: o.method ?? 'GET',
        headers: { 'User-Agent': config.userAgent, Accept: o.accept ?? 'application/json, text/html;q=0.9, */*;q=0.8' },
        redirect: 'follow',
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (res.status === 404 && o.allow404) return { status: 404, text, finalUrl: res.url };
      if (res.status === 429 || res.status >= 500) throw new HttpError(res.status, url);
      if (!res.ok) return Promise.reject(new HttpError(res.status, url)); // 4xx: do not retry
      return { status: res.status, text, finalUrl: res.url };
    } catch (e) {
      lastErr = e;
      if (e instanceof HttpError && e.status < 500 && e.status !== 429) throw e;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr;
}

export async function fetchJson<T = any>(url: string, o: FetchOpts = {}): Promise<T> {
  const { text } = await fetchText(url, { ...o, accept: 'application/json' });
  return JSON.parse(text) as T;
}

/** HEAD-ish liveness check (GET, since many ATS pages reject HEAD). */
export async function checkUrl(url: string): Promise<{ ok: boolean; status: number; finalUrl: string; body: string }> {
  try {
    const r = await fetchText(url, { retries: 1, allow404: true, timeoutMs: 20000 });
    return { ok: r.status >= 200 && r.status < 400, status: r.status, finalUrl: r.finalUrl, body: r.text };
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 0;
    return { ok: false, status, finalUrl: url, body: '' };
  }
}
