import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..');
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true } as any);

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: req('DATABASE_URL', 'postgres://careerpilot@localhost:5433/careerpilot'),
  redisUrl: process.env.REDIS_URL || '',
  // In production a real secret is mandatory; in dev we fall back to a per-boot random secret.
  jwtSecret: isProd ? req('JWT_SECRET') : process.env.JWT_SECRET || cryptoRandom(),
  ownerEmail: process.env.OWNER_EMAIL || 'naijabayz@gmail.com',
  ownerPassword: process.env.OWNER_PASSWORD || '',
  storageDir: path.resolve(ROOT, process.env.STORAGE_DIR || 'storage'),
  backupDir: path.resolve(ROOT, process.env.BACKUP_DIR || 'storage/backups'),
  pgBinDir: process.env.PG_BIN_DIR || '',
  userAgent: process.env.HTTP_USER_AGENT || 'CareerPilotAI/0.1 (personal job research; respects robots and rate limits)',
  appBaseUrl: (process.env.APP_BASE_URL || 'http://localhost:5173').replace(/\/$/, ''),
  resend: {
    apiKey: process.env.RESEND_API_KEY || '',
    // Identity 1 — CareerPilot AI notifications to the owner only.
    fromEmail: process.env.RESEND_FROM_EMAIL || '',
    fromName: process.env.RESEND_FROM_NAME || 'CareerPilot AI',
    replyTo: process.env.RESEND_REPLY_TO || '',
  },
  // Identity 2 — real job applications to employers, sent as the candidate. Never falls back to identity 1.
  jobApplication: {
    fromEmail: process.env.JOB_APPLICATION_FROM_EMAIL || '',
    fromName: process.env.JOB_APPLICATION_FROM_NAME || '',
    replyTo: process.env.JOB_APPLICATION_REPLY_TO || '',
  },
  notificationEmail: process.env.CAREERPILOT_NOTIFICATION_EMAIL || 'me@alawiyemuritala.xyz',
  portfolioUrl: process.env.CAREERPILOT_PORTFOLIO_URL || 'https://alawiyemuritala.xyz',
  whatsapp: {
    // Meta WhatsApp Business Cloud API (official). Business-initiated messages require an approved template.
    provider: process.env.WHATSAPP_PROVIDER || '', // 'meta' | ''
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    to: process.env.WHATSAPP_TO || '',
    templateName: process.env.WHATSAPP_TEMPLATE_NAME || '',
    templateLang: process.env.WHATSAPP_TEMPLATE_LANG || 'en',
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v21.0',
  },
  ai: {
    // Any OpenAI-compatible endpoint works: OpenAI, OpenRouter, Gemini (OpenAI-compat), local LLMs.
    provider: process.env.AI_PROVIDER || '', // openai | openrouter | gemini | anthropic | '' (disabled)
    apiKey: process.env.AI_API_KEY || '',
    baseUrl: process.env.AI_BASE_URL || '',
    models: {
      research: process.env.AI_MODEL_RESEARCH || process.env.AI_MODEL || '',
      scoring: process.env.AI_MODEL_SCORING || process.env.AI_MODEL || '',
      documents: process.env.AI_MODEL_DOCUMENTS || process.env.AI_MODEL || '',
    },
    fallbackModels: (process.env.AI_FALLBACK_MODELS || '').split(',').map((s) => s.trim()).filter(Boolean),
    monthlyBudgetUsd: Number(process.env.AI_MONTHLY_BUDGET_USD || 10),
  },
};

function cryptoRandom() {
  return Array.from({ length: 4 }, () => Math.random().toString(36).slice(2)).join('');
}
