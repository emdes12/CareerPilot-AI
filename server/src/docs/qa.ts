import type { FullProfile } from '../engine/profile.js';
import { labelOf } from '../lib/taxonomy.js';
import { unsupportedSkills } from './generate.js';
import { BANNED_PHRASES } from './style.js';

/**
 * Quality gate run on every generated document before it is delivered or submitted.
 * errors   → document is not delivered as "ready" and can never be submitted automatically.
 * warnings → shown to the user; do not block.
 * submittable additionally requires no [PLACEHOLDER] markers and no unresolved evidence conflicts.
 */
export interface QaResult { passed: boolean; submittable: boolean; errors: string[]; warnings: string[]; checks: { check: string; ok: boolean; detail?: string }[]; checkedAt: string }

export { BANNED_PHRASES } from './style.js';

const PLACEHOLDER = /\[(?:[A-Z][A-Z /:–\-0-9]*)[^\]]*\]/g;

function repetition(text: string): string[] {
  const out: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 10);
  const openers = new Map<string, number>();
  for (const s of sentences) { const k = s.split(/\s+/).slice(0, 2).join(' ').toLowerCase(); openers.set(k, (openers.get(k) ?? 0) + 1); }
  for (const [k, n] of openers) if (n >= 3 && !/^i (am|have)$/.test(k)) out.push(`${n} sentences start with “${k}…”`);
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const tri = new Map<string, number>();
  for (let i = 0; i + 2 < words.length; i++) { const t = words.slice(i, i + 3).join(' '); if (t.length > 12) tri.set(t, (tri.get(t) ?? 0) + 1); }
  for (const [t, n] of tri) if (n >= 3) out.push(`Phrase “${t}” repeated ${n} times`);
  return out.slice(0, 4);
}

/** Numbers in the document must appear in the evidence/profile, the job listing, or be dates/contact details. */
function unsupportedNumbers(text: string, allowedCorpus: string, p: FullProfile): string[] {
  const stripped = text.replace(p.profile.phone ?? '', ' ').replace(/https?:\/\/\S+/g, ' ').replace(/\b(19|20)\d{2}\b/g, ' ').replace(/UTC[+-]\d+/g, ' ');
  const nums = stripped.match(/\b\d+(?:[.,]\d+)?\s?(?:%|k\b|x\b|\+)?/gi) ?? [];
  const yrs = String(Math.max(1, Math.floor(p.professionalYears)));
  return [...new Set(nums.map((n) => n.trim()))].filter((n) => {
    const bare = n.replace(/[^\d.,]/g, '');
    return bare && bare !== yrs && !allowedCorpus.includes(bare);
  });
}

export interface QaContext { p: FullProfile; job?: { title: string; company_name: string; description_text?: string | null } | null; attachments?: { kind: string; ok: boolean }[] }

export function qaDocument(kind: 'cv' | 'cover_letter' | 'email' | 'answers' | 'handoff', content: any, ctx: QaContext): QaResult {
  const { p, job } = ctx;
  const errors: string[] = []; const warnings: string[] = []; const checks: QaResult['checks'] = [];
  const check = (name: string, ok: boolean, detail?: string, severity: 'error' | 'warning' = 'error') => {
    checks.push({ check: name, ok, detail });
    if (!ok && detail) (severity === 'error' ? errors : warnings).push(detail);
  };
  const text = docText(kind, content);
  const evidenceCorpus = [
    ...(p.evidence?.refs ?? []).map((r) => r.value), ...p.experiences.flatMap((e: any) => [e.title, e.start_date, e.end_date, ...(e.bullets ?? [])]),
    ...p.projects.map((x: any) => `${x.contribution ?? ''} ${x.problem ?? ''}`), p.profile.summary ?? '', JSON.stringify(p.profile.links ?? {}),
    job?.description_text ?? '', job?.title ?? '',
  ].join('\n');

  // 1. Banned / generic phrasing
  const banned = BANNED_PHRASES.filter((b) => text.toLowerCase().includes(b));
  check('No generic AI phrasing', banned.length === 0, banned.length ? `Generic phrasing found: ${banned.map((b) => `“${b}”`).join(', ')}` : undefined);

  // 2. Technologies supported by the profile/evidence
  const leak = unsupportedSkills(text.replace(job?.description_text ?? '', ''), p);
  // Technologies only listed in a gaps sentence ("X would be new to me") are honest, not claims.
  const claimed = leak.filter((k) => !new RegExp(`(haven't used|would be new to me|not used)[^.]*${labelOf(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|${labelOf(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^.]*(would be new to me|in production, but)`, 'i').test(text));
  check('Technologies supported by evidence', claimed.length === 0, claimed.length ? `Mentions ${claimed.map(labelOf).join(', ')}, which is not supported by your evidence` : undefined);

  // 3. No invented metrics
  const nums = kind === 'answers' ? [] : unsupportedNumbers(text, evidenceCorpus, p);
  check('No unsupported figures', nums.length === 0, nums.length ? `Figures not found in your evidence or the job listing: ${nums.slice(0, 5).join(', ')}` : undefined);

  // 4. Titles and dates match evidence (CV)
  if (kind === 'cv') {
    for (const e of content.experience ?? []) {
      const src = p.experiences.find((x: any) => x.company === e.company);
      check(`Title matches evidence: ${e.company}`, !!src && src.title === e.title, src && src.title !== e.title ? `${e.company}: title “${e.title}” differs from evidence “${src.title}”` : !src ? `${e.company} is not in your profile` : undefined);
    }
  }

  // 5. Company and role specific
  if (job && (kind === 'cover_letter' || kind === 'email')) {
    check('Mentions the company', text.includes(job.company_name), `Does not mention ${job.company_name}`);
    check('Mentions the role', text.toLowerCase().includes(job.title.toLowerCase().slice(0, 25)), `Does not mention the role “${job.title}”`, 'warning');
    const projectNamed = p.projects.some((x: any) => text.includes(x.name)) || p.experiences.some((x: any) => text.includes(x.company));
    check('References real work', projectNamed, 'Does not reference any of your real projects or employers', 'warning');
  }

  // 6. Contact details correct
  const emails = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? [];
  const wrongEmail = emails.filter((e) => e.toLowerCase() !== String(p.profile.email).toLowerCase() && !(kind === 'email' && e === content.to) && !/example\.com$/.test(e));
  check('Contact email correct', wrongEmail.length === 0, wrongEmail.length ? `Unexpected email address(es): ${wrongEmail.join(', ')}` : undefined);

  // 7. Repetition / length
  const rep = repetition(text);
  check('Natural, non-repetitive', rep.length === 0, rep.join('; '), 'warning');
  if (kind === 'cover_letter') {
    const words = text.split(/\s+/).length;
    check('Length', words <= 420, `Cover letter is ${words} words — aim for under 400`, 'warning');
  }

  // 8. Attachments (email/handoff)
  for (const a of ctx.attachments ?? []) check(`Attachment ${a.kind} ready`, a.ok, `${a.kind} is missing or failed QA`);

  // 9. Evidence conflicts affecting what the document says
  const conflicts = (p.evidence?.issues ?? []).filter((i) => i.kind === 'conflict' && (text.includes(i.entity) || kind === 'cv'));
  for (const c of conflicts) warnings.push(`Unresolved: ${c.message}`);
  const unconfirmed = (p.evidence?.issues ?? []).filter((i) => i.kind === 'unconfirmed' && text.includes(i.entity));
  for (const u of unconfirmed) warnings.push(`Needs confirmation: ${u.message}`);

  const placeholders = text.match(PLACEHOLDER) ?? [];
  if (placeholders.length) warnings.push(`${placeholders.length} item(s) need your input: ${[...new Set(placeholders)].slice(0, 4).join(', ')}`);

  const passed = errors.length === 0;
  return { passed, submittable: passed && placeholders.length === 0 && conflicts.length === 0, errors, warnings, checks, checkedAt: new Date().toISOString() };
}

export function docText(kind: string, c: any): string {
  if (!c) return '';
  if (kind === 'cv') return [c.header?.headline, c.summary, ...(c.skills ?? []).flatMap((s: any) => s.items), ...(c.experience ?? []).flatMap((e: any) => [`${e.title} ${e.company} ${e.period}`, ...e.bullets]), ...(c.projects ?? []).map((x: any) => `${x.name} ${x.description} ${(x.technologies ?? []).join(' ')}`)].filter(Boolean).join('\n');
  if (kind === 'cover_letter') return [...(c.paragraphs ?? []), c.signoff].join('\n\n');
  if (kind === 'email') return `${c.subject}\n${c.body}`;
  if (kind === 'answers') return [...(c.formQuestions ?? []), ...(c.common ?? [])].map((a: any) => a.answer).join('\n');
  return typeof c === 'string' ? c : JSON.stringify(c);
}
