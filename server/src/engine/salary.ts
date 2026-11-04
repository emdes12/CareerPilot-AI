import { fetchJson } from '../lib/http.js';

export const DEFAULT_FX: Record<string, number> = { NGN: 1, USD: 1500, EUR: 1700, GBP: 2000, CAD: 1080, AUD: 980, CHF: 1850, SEK: 150, PLN: 400, INR: 17, ZAR: 85, KES: 11.6, BRL: 270 };

const SYMBOLS: [RegExp, string][] = [[/US\$|USD|\$/i, 'USD'], [/€|EUR/i, 'EUR'], [/£|GBP/i, 'GBP'], [/CA\$|CAD/i, 'CAD'], [/A\$|AUD/i, 'AUD'], [/₦|NGN/i, 'NGN'], [/CHF/i, 'CHF'], [/INR|₹/i, 'INR'], [/PLN|zł/i, 'PLN'], [/SEK/i, 'SEK']];

export interface ParsedSalary { min: number | null; max: number | null; currency: string | null; period: 'year' | 'month' | 'hour' | null; raw: string | null; source: 'listing' | 'description' | null }

function toNum(s: string): number {
  const k = /k$/i.test(s);
  const n = Number(s.replace(/[k,\s]/gi, ''));
  return k ? n * 1000 : n;
}

/** Parse free-text salary like "$3.5k–$5k/month", "USD 120,000 - 150,000 per year", "€60k", "$40/hr". */
export function parseSalaryText(text: string | null | undefined, source: ParsedSalary['source'] = 'listing'): ParsedSalary | null {
  if (!text) return null;
  const re = /((?:US\$|CA\$|A\$|USD|EUR|GBP|CAD|AUD|NGN|CHF|[$€£₦])\s?)(\d[\d,]*(?:\.\d+)?\s?[kK]?)(?:\s*(?:-|–|—|to)\s*(?:(?:US\$|CA\$|A\$|USD|EUR|GBP|CAD|AUD|NGN|CHF|[$€£₦])\s?)?(\d[\d,]*(?:\.\d+)?\s?[kK]?))?\s*(USD|EUR|GBP|CAD|AUD)?\s*(?:\/|per|a|an)?\s*(year|yr|annum|annual(?:ly)?|month|mo|hour|hr|h)?/i;
  const m = re.exec(text);
  if (!m) return null;
  const cur = SYMBOLS.find(([r]) => r.test(m[4] || m[1]))?.[1] ?? null;
  let min = toNum(m[2]); const max = m[3] ? toNum(m[3]) : null;
  // "$45–60,000" means 45,000–60,000: scale a bare small minimum to the maximum's magnitude.
  if (max && min < 1000 && max >= 1000 && max / min > 100 && !/\./.test(m[2])) min *= 1000;
  let period: ParsedSalary['period'] = m[5] ? (/^(h|hr|hour)/i.test(m[5]) ? 'hour' : /^mo/i.test(m[5]) ? 'month' : 'year') : null;
  if (!period) period = min < 300 ? 'hour' : min < 20000 && cur !== 'NGN' ? 'month' : 'year';
  if (!min || min < 5) return null;
  return { min, max, currency: cur, period, raw: m[0].trim(), source };
}

/** Find a salary in the description only when it is clearly a compensation statement. */
export function findSalaryInDescription(text: string): ParsedSalary | null {
  const lines = text.split('\n').filter((l) => /(salary|compensation|pay range|base pay|ote|per year|per annum|\/year|\/yr|per month|\/month|annual)/i.test(l) && /[$€£₦]|USD|EUR|GBP|CAD/.test(l));
  for (const l of lines) { const p = parseSalaryText(l, 'description'); if (p && (p.min ?? 0) >= 10) return p; }
  return null;
}

export function toNgnMonthly(amount: number, currency: string, period: string, fx: Record<string, number>): number | null {
  const rate = fx[currency?.toUpperCase()];
  if (!rate) return null;
  const monthly = period === 'year' ? amount / 12 : period === 'hour' ? amount * 160 : amount;
  return Math.round(monthly * rate);
}

export interface SalaryAnalysis { status: 'meets_target' | 'meets_minimum' | 'below_minimum' | 'not_disclosed' | 'unconvertible'; disclosed: boolean; original: string | null; ngnMonthlyMin: number | null; ngnMonthlyMax: number | null; verified: boolean; note: string; score01: number }

export function analyseSalary(s: ParsedSalary | null, fx: Record<string, number>, minNgn: number, targetNgn: number): SalaryAnalysis {
  if (!s || !s.min) return { status: 'not_disclosed', disclosed: false, original: null, ngnMonthlyMin: null, ngnMonthlyMax: null, verified: false, note: 'Salary not disclosed in the listing. No figure has been estimated.', score01: 0.5 };
  const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  const original = `${s.currency ?? '?'} ${fmt(s.min)}${s.max ? '–' + fmt(s.max) : ''} / ${s.period}`;
  if (!s.currency) return { status: 'unconvertible', disclosed: true, original, ngnMonthlyMin: null, ngnMonthlyMax: null, verified: s.source === 'listing', note: 'Currency not stated; cannot convert.', score01: 0.5 };
  const lo = toNgnMonthly(s.min, s.currency, s.period ?? 'year', fx);
  const hi = s.max ? toNgnMonthly(s.max, s.currency, s.period ?? 'year', fx) : lo;
  if (lo === null) return { status: 'unconvertible', disclosed: true, original, ngnMonthlyMin: null, ngnMonthlyMax: null, verified: s.source === 'listing', note: `No exchange rate configured for ${s.currency}.`, score01: 0.5 };
  const best = hi ?? lo;
  let status: SalaryAnalysis['status']; let score01: number;
  if (lo >= targetNgn) { status = 'meets_target'; score01 = 1; }
  else if (best >= targetNgn) { status = 'meets_target'; score01 = 0.9; }
  else if (best >= minNgn) { status = 'meets_minimum'; score01 = 0.7; }
  else { status = 'below_minimum'; score01 = 0.1; }
  const src = s.source === 'listing' ? 'stated in the listing' : 'found in the job description text';
  return { status, disclosed: true, original, ngnMonthlyMin: lo, ngnMonthlyMax: hi, verified: true, note: `Salary ${src}. NGN figures are estimates using configured exchange rates.`, score01 };
}

/** Refresh FX from a free public endpoint. Returns NGN per 1 unit of each currency. */
export async function fetchFxRates(): Promise<Record<string, number> | null> {
  try {
    const d = await fetchJson<{ result: string; rates: Record<string, number> }>('https://open.er-api.com/v6/latest/NGN', { retries: 1 });
    if (d.result !== 'success') return null;
    const out: Record<string, number> = { NGN: 1 };
    for (const c of Object.keys(DEFAULT_FX)) if (d.rates[c]) out[c] = Math.round((1 / d.rates[c]) * 100) / 100;
    return out;
  } catch { return null; }
}
