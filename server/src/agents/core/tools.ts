import { one, q, json } from '../../db.js';
import { checkUrl, fetchJson, fetchText } from '../../lib/http.js';
import { detectSkills, labelOf, SKILLS } from '../../lib/taxonomy.js';
import { loadProfile } from '../../engine/profile.js';
import { getSettings } from '../../engine/settings.js';
import { analyseSalary, toNgnMonthly } from '../../engine/salary.js';
import { BOARD_FETCHERS } from '../../sources/ats.js';
import { SOURCES } from '../../sources/index.js';
import { upsertJob } from '../../engine/store.js';
import { unsupportedSkills } from '../../docs/generate.js';
import type { Board } from '../../sources/types.js';
import { identityStatus, sendEmail } from '../../integrations/resend.js';
import { sendWhatsApp, whatsappStatus } from '../../integrations/whatsapp.js';
import { evaluateSubmission, getAutomation, recordEvent } from '../../engine/policy.js';
import { cvPdf, letterPdf } from '../../docs/render.js';

/**
 * Tool registry. Agents never import services directly; they receive a scoped proxy
 * exposing only the tools listed in their definition. Nothing here can create accounts, accept terms,
 * fill third-party portal forms or bypass CAPTCHAs — those capabilities do not exist.
 * Outbound messaging tools are allow-listed ONLY to the Application Execution Agent (job-application
 * identity) and the Notification Agent (notifications identity), and each call is policy-checked and logged.
 */
export const TOOL_IMPLS = {
  'http.fetchPublic': (url: string) => fetchText(url, { accept: 'text/html' }),
  'http.fetchJson': (url: string) => fetchJson(url),
  'http.checkUrl': (url: string) => checkUrl(url),
  'github.listRepos': (user: string) => fetchJson<any[]>(`https://api.github.com/users/${encodeURIComponent(user)}/repos?per_page=100&sort=updated`),
  'company.lookupDomain': (name: string) => fetchJson<{ name: string; domain: string }[]>(`https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(name)}`, { retries: 1 }),
  'company.read': (id: number) => one('SELECT * FROM companies WHERE id=$1', [id]),
  'job.read': (userId: number, id: number) => one('SELECT * FROM jobs WHERE id=$1 AND user_id=$2', [id, userId]),
  'job.readExtraction': (id: number) => one('SELECT * FROM job_extractions WHERE job_id=$1', [id]),
  'job.readResearch': (id: number) => one('SELECT * FROM job_research WHERE job_id=$1', [id]),
  'job.readAnalysis': (id: number) => one('SELECT * FROM job_analyses WHERE job_id=$1', [id]),
  'profile.read': (userId: number) => loadProfile(userId),
  'settings.read': (userId: number) => getSettings(userId),
  'taxonomy.detect': (text: string) => detectSkills(text),
  'taxonomy.list': () => SKILLS.map((s) => ({ key: s.key, label: s.label, category: s.category })),
  'taxonomy.label': (k: string) => labelOf(k),
  'ats.fetchBoard': (b: Board) => BOARD_FETCHERS[b.ats](b),
  'ats.greenhouseQuestions': (board: string, id: string) => fetchJson<any>(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${id}?questions=true`),
  'sources.list': () => SOURCES,
  'store.upsertJob': upsertJob,
  'fx.toNgnMonthly': toNgnMonthly,
  'fx.analyse': analyseSalary,
  'guard.unsupportedSkills': unsupportedSkills,
  'analytics.query': (sql: string, params: unknown[]) => {
    if (!/^\s*select/i.test(sql)) throw new Error('analytics.query is read-only');
    return q(sql, params);
  },
  'profile.saveSuggestion': (userId: number, kind: string, payload: unknown, evidence: string | null, sourceUrl: string | null) =>
    one(`INSERT INTO profile_suggestions (user_id, kind, payload, evidence, source_url) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [userId, kind, json(payload), evidence, sourceUrl]),
  'policy.evaluateSubmission': evaluateSubmission,
  'automation.read': getAutomation,
  'events.record': recordEvent,
  'identity.status': identityStatus,
  'whatsapp.status': whatsappStatus,
  'docs.latest': (userId: number, jobId: number) => q(`SELECT DISTINCT ON (kind) * FROM documents WHERE user_id=$1 AND job_id=$2 ORDER BY kind, version DESC`, [userId, jobId]),
  'docs.renderCvPdf': cvPdf,
  'docs.renderLetterPdf': letterPdf,
  'email.sendApplication': (m: Omit<Parameters<typeof sendEmail>[0], 'identity'>) => sendEmail({ ...m, identity: 'job_application' }),
  'email.sendNotification': (m: Omit<Parameters<typeof sendEmail>[0], 'identity'>) => sendEmail({ ...m, identity: 'notifications' }),
  'whatsapp.send': sendWhatsApp,
} as const;

export type Tools = typeof TOOL_IMPLS;
export type ToolName = keyof Tools;

export function scopedTools(agent: string, allowed: readonly ToolName[], onCall: (tool: string) => void): Tools {
  const set = new Set<string>(allowed);
  return new Proxy(TOOL_IMPLS, {
    get(target, prop: string) {
      if (!set.has(prop)) throw new Error(`Agent "${agent}" is not permitted to use tool "${prop}"`);
      onCall(prop);
      return (target as any)[prop];
    },
  }) as Tools;
}
