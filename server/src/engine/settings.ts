import { json, one, q } from '../db.js';
import { DEFAULT_BOARDS, SOURCES } from '../sources/index.js';
import { defaultKeywords } from '../seed/profile.js';
import { DEFAULT_FX } from './salary.js';
import { DEFAULT_WEIGHTS } from './scoring.js';

export interface Settings {
  user_id: number; keywords: string[]; remote_only: boolean; levels: string[]; employment_types: string[];
  min_salary_ngn_monthly: number; target_salary_ngn_monthly: number; enabled_sources: string[]; company_boards: any[];
  schedule_cron: string; schedule_enabled: boolean; max_age_days: number; scoring_weights: typeof DEFAULT_WEIGHTS;
  fx_rates: Record<string, number>; fx_updated_at: string | null; ai_config: any;
}

export async function ensureSettings(userId: number) {
  await q(
    `INSERT INTO search_settings (user_id, keywords, levels, employment_types, enabled_sources, company_boards, scoring_weights, fx_rates)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (user_id) DO NOTHING`,
    [userId, json(defaultKeywords), json(['mid', 'unknown', 'senior', 'junior']), json(['full-time', 'contract', 'part-time']),
      json(SOURCES.filter((s) => s.available).map((s) => s.id)), json(DEFAULT_BOARDS), json(DEFAULT_WEIGHTS), json(DEFAULT_FX)],
  );
}

export async function getSettings(userId: number): Promise<Settings> {
  await ensureSettings(userId);
  return (await one<Settings>('SELECT * FROM search_settings WHERE user_id=$1', [userId]))!;
}
