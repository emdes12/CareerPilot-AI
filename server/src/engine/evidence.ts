import { json, one, q } from '../db.js';
import { seedEvidence, seedSources } from '../seed/evidence.js';
import { detectSkills } from '../lib/taxonomy.js';

/**
 * Professional evidence base.
 * Every claim (title, dates, responsibility, technology, contribution…) is stored with its source and status.
 * Only `verified` and `user_confirmed` claims may be presented as established facts in documents.
 * `conflicting` claims are never guessed: the CV uses the most conservative public version and flags it.
 */
export type ClaimStatus = 'verified' | 'user_confirmed' | 'indicated' | 'missing' | 'conflicting' | 'rejected';
export interface Claim {
  id: number; entity_type: string; entity_key: string; field: string; value: string; source_type: string;
  source_url: string | null; status: ClaimStatus; conflict_group: string | null; note: string | null;
}
export interface EvidenceRef { claimId: number; entity: string; field: string; value: string; source: string; url: string | null; status: ClaimStatus }
export interface EvidenceIssue { kind: 'conflict' | 'unconfirmed' | 'missing'; entity: string; field: string; message: string; group?: string; claimIds: number[] }
export interface EvidenceView { refs: EvidenceRef[]; issues: EvidenceIssue[]; byEntity: Map<string, Claim[]> }

const USABLE = new Set<ClaimStatus>(['verified', 'user_confirmed']);
export const isUsable = (c: Claim) => USABLE.has(c.status) && c.value.trim() !== '';
// When a conflict is unresolved, the version from the most publicly checkable source is shown (and flagged).
const SOURCE_RANK: Record<string, number> = { user_confirmed: 0, portfolio: 1, github: 2, cv: 3, linkedin: 4, user_brief: 5, conversation: 6 };

export async function seedEvidenceFor(userId: number) {
  const has = await one('SELECT 1 FROM evidence_claims WHERE user_id=$1 LIMIT 1', [userId]);
  if (!has) {
    for (const c of seedEvidence)
      await q(`INSERT INTO evidence_claims (user_id, entity_type, entity_key, field, value, source_type, source_url, status, conflict_group, note, last_verified_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CASE WHEN $8 IN ('verified','user_confirmed') THEN now() END)`,
        [userId, c.entity_type, c.entity_key, c.field, c.value, c.source_type, c.source_url, c.status, c.conflict_group ?? null, c.note ?? null]);
    console.log(`[evidence] Seeded ${seedEvidence.length} evidence claims`);
  }
  const hasSrc = await one('SELECT 1 FROM evidence_sources WHERE user_id=$1 LIMIT 1', [userId]);
  if (!hasSrc) for (const s of seedSources) await q(`INSERT INTO evidence_sources (user_id, source_type, url, title, status, detail) VALUES ($1,$2,$3,$4,$5,$6)`, [userId, s.source_type, s.url, s.title, s.status, s.detail]);
}

export const listClaims = (userId: number) => q<Claim>(`SELECT * FROM evidence_claims WHERE user_id=$1 AND status <> 'rejected' ORDER BY entity_type, entity_key, field, id`, [userId]);

const keyOf = (type: string, key: string) => `${type}:${key.toLowerCase()}`;

/** Pick the value for a single-valued field (title, dates). Returns the claim to use and any issue. */
function pickSingle(claims: Claim[], entity: string, field: string): { claim: Claim | null; issue: EvidenceIssue | null } {
  const fc = claims.filter((c) => c.field === field && c.value.trim());
  if (!fc.length) return { claim: null, issue: null };
  const usable = fc.filter(isUsable);
  const conflicting = fc.filter((c) => c.status === 'conflicting');
  if (conflicting.length) {
    const pick = [...conflicting].sort((a, b) => (SOURCE_RANK[a.source_type] ?? 9) - (SOURCE_RANK[b.source_type] ?? 9))[0];
    return { claim: pick, issue: { kind: 'conflict', entity, field, group: pick.conflict_group ?? undefined, claimIds: conflicting.map((c) => c.id),
      message: `${entity} ${field}: sources disagree (${conflicting.map((c) => `“${c.value}” from ${c.source_type}`).join(' vs ')}). Using “${pick.value}” until you confirm which is correct.` } };
  }
  if (usable.length) return { claim: usable[0], issue: null };
  const ind = fc[0];
  return { claim: ind, issue: { kind: 'unconfirmed', entity, field, claimIds: fc.map((c) => c.id), message: `${entity} ${field} “${ind.value}” is only indicated (${ind.source_type}) — confirm it.` } };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (d: string) => { if (d === 'present') return 'Present'; const [y, m] = d.split('-'); return m ? `${MONTHS[Number(m) - 1]} ${y}` : y; };
export const formatDates = (v: string) => { const [a, b] = v.split('|'); return `${fmt(a)} – ${fmt(b ?? 'present')}`; };

/**
 * Build the evidence-backed view of a raw profile. Experiences and projects that have evidence get their
 * title, dates, bullets and technologies replaced by usable claims only; anything user-entered directly in
 * the profile with no evidence rows is treated as user-confirmed (the user typed it themselves).
 */
export function applyEvidence<P extends { experiences: any[]; projects: any[] }>(p: P, claims: Claim[]): P & { evidence: EvidenceView } {
  const byEntity = new Map<string, Claim[]>();
  for (const c of claims) { const k = keyOf(c.entity_type, c.entity_key); byEntity.set(k, [...(byEntity.get(k) ?? []), c]); }
  const refs: EvidenceRef[] = []; const issues: EvidenceIssue[] = [];
  const ref = (c: Claim) => refs.push({ claimId: c.id, entity: c.entity_key, field: c.field, value: c.value, source: c.source_type, url: c.source_url, status: c.status });

  const experiences = p.experiences.map((e) => {
    const ec = byEntity.get(keyOf('experience', e.company));
    if (!ec?.length) return { ...e, evidenceBacked: false };
    const t = pickSingle(ec, e.company, 'title'); if (t.claim) ref(t.claim); if (t.issue) issues.push(t.issue);
    const d = pickSingle(ec, e.company, 'dates'); if (d.issue) issues.push(d.issue);
    let start = e.start_date, end = e.end_date, isCurrent = e.is_current, datesText: string | null = null;
    if (d.claim) {
      const [a, b] = d.claim.value.split('|');
      start = a; end = b === 'present' ? null : b; isCurrent = b === 'present';
      if (isUsable(d.claim)) { ref(d.claim); } else datesText = `[CONFIRM DATES: ${formatDates(d.claim.value)}]`;
    }
    const bulletClaims = ec.filter((c) => (c.field === 'responsibility' || c.field === 'achievement') && isUsable(c));
    bulletClaims.forEach(ref);
    for (const c of ec.filter((c) => (c.field === 'responsibility' || c.field === 'achievement') && c.status === 'conflicting'))
      issues.push({ kind: 'conflict', entity: e.company, field: c.field, group: c.conflict_group ?? undefined, claimIds: [c.id], message: `${e.company}: “${c.value}” is left out until the related conflict is resolved.` });
    const techClaims = ec.filter((c) => c.field === 'technology' && isUsable(c));
    techClaims.forEach(ref);
    const techConf = ec.filter((c) => c.field === 'technology' && c.status === 'conflicting');
    if (techConf.length) issues.push({ kind: 'conflict', entity: e.company, field: 'technology', group: techConf[0].conflict_group ?? undefined, claimIds: techConf.map((c) => c.id),
      message: `${e.company} technology: sources disagree (${techConf.map((c) => `${c.value} from ${c.source_type}`).join(' vs ')}). Neither is claimed for this role until you confirm.` });
    return {
      ...e, evidenceBacked: true,
      title: t.claim?.value ?? e.title, start_date: start, end_date: end, is_current: isCurrent, datesText,
      bullets: bulletClaims.map((c) => c.value), technologies: [...new Set(techClaims.map((c) => c.value))],
      bulletRefs: bulletClaims.map((c) => c.id),
    };
  });

  const projects = p.projects.map((pr) => {
    const pc = byEntity.get(keyOf('project', pr.name));
    if (!pc?.length) return { ...pr, evidenceBacked: false };
    const contrib = pc.filter((c) => c.field === 'contribution' && isUsable(c)); contrib.forEach(ref);
    const tech = pc.filter((c) => c.field === 'technology' && isUsable(c)); tech.forEach(ref);
    for (const m of pc.filter((c) => c.status === 'missing')) issues.push({ kind: 'missing', entity: pr.name, field: m.field, claimIds: [m.id], message: m.note ?? `${pr.name}: ${m.field} not documented.` });
    // Technologies are only those with evidence; any declared in the profile row without evidence are dropped.
    return { ...pr, evidenceBacked: true, contribution: contrib.map((c) => c.value).join(' ') || pr.contribution, problem: contrib.length ? null : pr.problem, technologies: [...new Set(tech.map((c) => c.value))] };
  });

  for (const c of claims.filter((c) => c.entity_type === 'profile' && c.status === 'missing')) issues.push({ kind: 'missing', entity: 'Profile', field: c.field, claimIds: [c.id], message: c.note ?? `${c.field} missing.` });
  return { ...p, experiences, projects, evidence: { refs, issues, byEntity } };
}

// ---------------- User actions (suggestions are never applied silently) ----------------

export async function confirmClaim(userId: number, id: number) {
  return one(`UPDATE evidence_claims SET status='user_confirmed', last_verified_at=now(), updated_at=now() WHERE id=$1 AND user_id=$2 AND status IN ('indicated','user_confirmed','verified') RETURNING *`, [id, userId]);
}

/** Resolve a conflict group: the chosen claim becomes user-confirmed, the others are rejected (kept for audit). */
export async function resolveConflict(userId: number, group: string, keepId: number, correctedValue?: string) {
  const rows = await q<Claim>(`SELECT * FROM evidence_claims WHERE user_id=$1 AND conflict_group=$2`, [userId, group]);
  if (!rows.some((r) => r.id === keepId)) throw new Error('Claim is not part of this conflict');
  const keep = rows.find((r) => r.id === keepId)!;
  // Linked claims from the same source (e.g. "lead" duties that depend on the Team Lead title) follow the decision.
  for (const r of rows.filter((r) => r.id !== keepId)) {
    const follows = r.source_type === keep.source_type && r.field !== keep.field;
    await q(`UPDATE evidence_claims SET status=$3, last_verified_at=CASE WHEN $3='user_confirmed' THEN now() END, updated_at=now() WHERE id=$1 AND user_id=$2`, [r.id, userId, follows ? 'user_confirmed' : 'rejected']);
  }
  return one(`UPDATE evidence_claims SET status='user_confirmed', value=COALESCE($3, value), last_verified_at=now(), updated_at=now(), note=COALESCE(note,'') || ' — resolved by user' WHERE id=$1 AND user_id=$2 RETURNING *`, [keepId, userId, correctedValue ?? null]);
}

export async function addClaim(userId: number, c: { entity_type: string; entity_key: string; field: string; value: string; source_url?: string | null; note?: string | null }) {
  return one(`INSERT INTO evidence_claims (user_id, entity_type, entity_key, field, value, source_type, source_url, status, note, last_verified_at)
              VALUES ($1,$2,$3,$4,$5,'user_confirmed',$6,'user_confirmed',$7, now()) RETURNING *`, [userId, c.entity_type, c.entity_key, c.field, c.value, c.source_url ?? null, c.note ?? null]);
}

export async function updateClaim(userId: number, id: number, value: string) {
  // Editing a claim means the user is stating it themselves.
  return one(`UPDATE evidence_claims SET value=$3, source_type=CASE WHEN status='conflicting' THEN source_type ELSE 'user_confirmed' END,
              status=CASE WHEN status='conflicting' THEN status ELSE 'user_confirmed' END, last_verified_at=now(), updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *`, [id, userId, value]);
}

export const rejectClaim = (userId: number, id: number) => one(`UPDATE evidence_claims SET status='rejected', updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING id`, [id, userId]);

// ---------------- CV upload → indicated claims + conflict detection ----------------

const DATE_RE = /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}|\b\d{4}\b)\s*(?:–|-|—|to)\s*((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}|\b\d{4}\b|present|current|now)/i;
const toYm = (s: string) => {
  if (/present|current|now/i.test(s)) return 'present';
  const m = /([a-z]+)\.?\s+(\d{4})/i.exec(s);
  if (m) { const i = MONTHS.findIndex((x) => m[1].toLowerCase().startsWith(x.toLowerCase())); return i >= 0 ? `${m[2]}-${String(i + 1).padStart(2, '0')}` : m[2]; }
  return s.trim();
};

/**
 * Parse an uploaded CV's text. For each known employer found in the CV, the surrounding lines are read for
 * a title and a date range. New information becomes `indicated` (needs confirmation); a disagreement with an
 * existing usable claim marks both as `conflicting` — nothing is overwritten.
 */
export async function ingestCvText(userId: number, filename: string, text: string) {
  const up = await one<{ id: number }>(`INSERT INTO cv_uploads (user_id, filename, text) VALUES ($1,$2,$3) RETURNING id`, [userId, filename, text]);
  const claims = await listClaims(userId);
  const companies = [...new Set(claims.filter((c) => c.entity_type === 'experience').map((c) => c.entity_key))];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const found: { company: string; title: string | null; dates: string | null; result: string }[] = [];
  for (const company of companies) {
    const idx = lines.findIndex((l) => l.toLowerCase().includes(company.toLowerCase().replace(/ llc$| company$/i, '').replace(/^the /i, '')));
    if (idx < 0) continue;
    const win = lines.slice(Math.max(0, idx - 2), idx + 3);
    const dm = win.map((l) => DATE_RE.exec(l)).find(Boolean);
    const dates = dm ? `${toYm(dm[1])}|${toYm(dm[2])}` : null;
    const titleLine = win.find((l) => /(engineer|developer|intern|lead|instructor|designer)/i.test(l) && l.length < 90);
    const title = titleLine ? titleLine.replace(DATE_RE, '').replace(new RegExp(company, 'i'), '').replace(/[|,–—@-]+\s*$/g, '').replace(/^\s*[|,–—@-]+/, '').trim() : null;
    const notes: string[] = [];
    for (const [field, value] of [['title', title], ['dates', dates]] as const) {
      if (!value) continue;
      const existing = claims.filter((c) => c.entity_key === company && c.field === field && c.status !== 'missing');
      if (existing.some((c) => c.value.toLowerCase() === value.toLowerCase())) { notes.push(`${field} matches existing evidence`); continue; }
      const usable = existing.filter(isUsable);
      const group = existing.find((c) => c.conflict_group)?.conflict_group ?? (usable.length ? `${company.toLowerCase().replace(/\W+/g, '-')}-${field}-cv${up!.id}` : null);
      await q(`INSERT INTO evidence_claims (user_id, entity_type, entity_key, field, value, source_type, source_url, status, conflict_group, note)
               VALUES ($1,'experience',$2,$3,$4,'cv',$5,$6,$7,$8)`,
        [userId, company, field, value, `upload:${filename}`, group ? 'conflicting' : 'indicated', group, `From uploaded CV "${filename}"`]);
      if (group && usable.length) await q(`UPDATE evidence_claims SET status='conflicting', conflict_group=$3, updated_at=now() WHERE user_id=$1 AND id = ANY($2)`, [userId, usable.map((c) => c.id), group]);
      notes.push(group ? `${field} “${value}” CONFLICTS with existing evidence — flagged for you to resolve` : `${field} “${value}” added as indicated`);
    }
    found.push({ company, title, dates, result: notes.join('; ') || 'nothing new' });
  }
  const skills = [...detectSkills(text).keys()];
  await q(`INSERT INTO evidence_sources (user_id, source_type, url, title, status, detail) VALUES ($1,'cv',$2,$3,'reviewed',$4)`,
    [userId, `upload:${filename}`, `Uploaded CV: ${filename}`, `${found.length} employers recognised; technologies mentioned: ${skills.join(', ') || 'none'}`]);
  return { uploadId: up!.id, employers: found, technologiesMentioned: skills, note: 'Technologies in a CV are listed for review only — they are not added to your skills automatically.' };
}

export async function evidenceSummary(userId: number) {
  const claims = await listClaims(userId);
  const sources = await q(`SELECT * FROM evidence_sources WHERE user_id=$1 ORDER BY reviewed_at DESC`, [userId]);
  const counts = claims.reduce<Record<string, number>>((a, c) => ((a[c.status] = (a[c.status] ?? 0) + 1), a), {});
  const conflicts = [...new Set(claims.filter((c) => c.status === 'conflicting' && c.conflict_group).map((c) => c.conflict_group!))]
    .map((g) => ({ group: g, claims: claims.filter((c) => c.conflict_group === g) }));
  return { counts, conflicts, claims, sources };
}

