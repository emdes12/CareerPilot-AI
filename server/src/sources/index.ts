import { himalayas, indeed, jobicy, linkedin, remoteok, remotive, wellfound, weworkremotely, ycombinator } from './aggregators.js';
import { ashby, greenhouse, lever, workable } from './ats.js';
import type { Board, JobSource } from './types.js';

export const SOURCES: JobSource[] = [himalayas, remotive, remoteok, weworkremotely, jobicy, greenhouse, lever, ashby, workable, linkedin, indeed, wellfound, ycombinator];
export const sourceById = (id: string) => SOURCES.find((s) => s.id === id);

/** Default company boards — every slug below was verified to return a live public board. */
export const DEFAULT_BOARDS: Board[] = [
  { ats: 'greenhouse', slug: 'gitlab', company: 'GitLab' },
  { ats: 'greenhouse', slug: 'canonical', company: 'Canonical' },
  { ats: 'greenhouse', slug: 'vercel', company: 'Vercel' },
  { ats: 'greenhouse', slug: 'mozilla', company: 'Mozilla' },
  { ats: 'greenhouse', slug: 'wikimedia', company: 'Wikimedia Foundation' },
  { ats: 'greenhouse', slug: 'moniepoint', company: 'Moniepoint' },
  { ats: 'greenhouse', slug: 'grafanalabs', company: 'Grafana Labs' },
  { ats: 'greenhouse', slug: 'automatticcareers', company: 'Automattic' },
  { ats: 'greenhouse', slug: 'elastic', company: 'Elastic' },
  { ats: 'greenhouse', slug: 'mattermost', company: 'Mattermost' },
  { ats: 'greenhouse', slug: 'cloudflare', company: 'Cloudflare' },
  { ats: 'ashby', slug: 'posthog', company: 'PostHog' },
  { ats: 'ashby', slug: 'supabase', company: 'Supabase' },
  { ats: 'ashby', slug: 'deel', company: 'Deel' },
  { ats: 'ashby', slug: 'zapier', company: 'Zapier' },
  { ats: 'ashby', slug: 'n8n', company: 'n8n' },
  { ats: 'ashby', slug: 'resend', company: 'Resend' },
  { ats: 'ashby', slug: 'sanity', company: 'Sanity' },
  { ats: 'ashby', slug: 'linear', company: 'Linear' },
  { ats: 'ashby', slug: 'kraken.com', company: 'Kraken' },
  { ats: 'lever', slug: 'kraken', company: 'Kraken' },
  { ats: 'workable', slug: 'hotjar', company: 'Hotjar' },
  { ats: 'workable', slug: 'remofirst', company: 'RemoFirst' },
  { ats: 'workable', slug: 'turing', company: 'Turing' },
];
