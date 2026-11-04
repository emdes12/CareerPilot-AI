import { detectSkills, labelOf } from '../lib/taxonomy.js';
import { splitSections } from '../lib/text.js';

export type Importance = 'required' | 'preferred' | 'mentioned';
export interface Requirement { skill: string; label: string; importance: Importance; mentions: number }

export interface Extracted {
  requirements: Requirement[];
  seniority: 'intern' | 'junior' | 'mid' | 'senior' | 'lead' | 'staff' | 'unknown';
  yearsMin: number | null;
  yearsMax: number | null;
  roleType: 'frontend' | 'backend' | 'fullstack' | 'mobile' | 'devops' | 'data' | 'ml' | 'qa' | 'general' | 'other';
  languageRequirements: string[];
  clearance: boolean;
  responsibilities: string[];
  requirementLines: string[];
  screeningHints: string[];
}

export function detectSeniority(title: string, text: string, hinted?: string | null): Extracted['seniority'] {
  const t = title.toLowerCase();
  if (/\b(intern|internship|trainee|apprentice)\b/.test(t)) return 'intern';
  if (/\b(principal|staff|distinguished|director|head of|vp|chief|architect)\b/.test(t)) return 'staff';
  if (/\b(lead|manager)\b/.test(t)) return 'lead';
  if (/\b(senior|sr\.?|snr|iii|level 3)\b/.test(t)) return 'senior';
  if (/\b(junior|jr\.?|entry|graduate|associate|i)\b/.test(t) && !/\bai\b/.test(t)) return 'junior';
  if (/\b(mid|intermediate|ii)\b/.test(t)) return 'mid';
  const h = (hinted ?? '').toLowerCase();
  if (/senior/.test(h)) return 'senior';
  if (/entry|junior/.test(h)) return 'junior';
  if (/mid/.test(h)) return 'mid';
  if (/\bsenior (engineer|developer|level)\b/i.test(text.slice(0, 600))) return 'senior';
  return 'unknown';
}

export function detectYears(text: string): { min: number | null; max: number | null } {
  const re = /(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*(\d{1,2}))?\s*\+?\s*(?:years?|yrs?)(?:\s+of)?(?:\s+\w+){0,6}?\s+(?:experience|exp\b|building|working|developing|in software|of professional|professional)/gi;
  let min: number | null = null; let max: number | null = null;
  for (const m of text.matchAll(re)) {
    const a = Number(m[1]); const b = m[2] ? Number(m[2]) : null;
    if (a > 20) continue;
    // Use the largest "minimum" stated (most binding requirement).
    if (min === null || a > min) { min = a; max = b; }
  }
  return { min, max };
}

export function detectRoleType(title: string): Extracted['roleType'] {
  const t = title.toLowerCase();
  if (/full[\s-]?stack/.test(t)) return 'fullstack';
  if (/front[\s-]?end|\bui\b|react|vue|angular|web developer|javascript/.test(t)) return 'frontend';
  if (/back[\s-]?end|node|api|platform|server/.test(t)) return 'backend';
  if (/\b(ios|android|mobile|react native|flutter)\b/.test(t)) return 'mobile';
  if (/devops|sre|site reliability|infrastructure|cloud engineer|platform engineer/.test(t)) return 'devops';
  if (/machine learning|\bml\b|\bai engineer|research engineer|llm/.test(t)) return 'ml';
  if (/data engineer|analytics engineer|data platform/.test(t)) return 'data';
  if (/\bqa\b|quality|test(ing)? engineer|sdet/.test(t)) return 'qa';
  if (/software engineer|software developer|developer|engineer|programmer|typescript|python/.test(t)) return 'general';
  return 'other';
}

/** Is this job a software-engineering role at all? Used to filter aggregator noise before storing. */
export function isSoftwareRole(title: string, text: string): boolean {
  const t = title.toLowerCase();
  if (!/(engineer|developer|programmer|\bswe\b|full[\s-]?stack|front[\s-]?end|back[\s-]?end|coder)/.test(t)) return false;
  if (/(sales|account exec|account manager|recruit|marketing|customer|support engineer|solutions? (engineer|consultant)|sales engineer|hardware|mechanical|electrical|civil|chemical|structural|firmware|embedded|network engineer|field engineer|process engineer|manufacturing|technical writer|designer|developer relations|devrel|advocate|game|unity|unreal|salesforce|servicenow|sap |dynamics 365|blockchain|solidity|web3|smart contract|data annotat|ai trainer|ai train|training data|model training|rlhf|tutor|evaluator|rater|copywriter)/.test(t)) return false;
  const skills = detectSkills(`${title}\n${text.slice(0, 6000)}`);
  const core = ['javascript', 'typescript', 'react', 'vue', 'nodejs', 'python', 'postgresql', 'nextjs', 'express', 'rest', 'go', 'java', 'ruby', 'php', 'csharp', 'rust', 'kotlin', 'html', 'graphql', 'django', 'rails'];
  return core.some((k) => skills.has(k)) || /software/.test(t);
}

export function extractRequirements(title: string, text: string): Extracted {
  const sections = splitSections(text);
  const imp = new Map<string, Requirement>();
  const bump = (key: string, importance: Importance, n: number) => {
    const rank = { required: 3, mentioned: 2, preferred: 1 } as const;
    const cur = imp.get(key);
    if (!cur) imp.set(key, { skill: key, label: labelOf(key), importance, mentions: n });
    else {
      cur.mentions += n;
      if (rank[importance] > rank[cur.importance]) cur.importance = importance;
    }
  };
  const hasStructure = sections.some((s) => s.kind === 'required' || s.kind === 'preferred');
  for (const s of sections) {
    if (s.kind === 'benefits' || s.kind === 'about') continue;
    const kind: Importance = s.kind === 'required' ? 'required' : s.kind === 'preferred' ? 'preferred' : hasStructure ? 'mentioned' : 'required';
    // Within a required section, lines saying "bonus/nice to have/plus" are preferred.
    for (const line of s.text.split('\n')) {
      if (!line.trim()) continue;
      const lineKind: Importance = /(nice to have|bonus|a plus|is a plus|preferred|desirable|ideally|familiarity with)/i.test(line) ? 'preferred' : kind;
      for (const [k, n] of detectSkills(line)) bump(k, lineKind, n);
    }
  }
  for (const [k, n] of detectSkills(title)) bump(k, 'required', n);

  const lines = (re: RegExp) => sections.filter((s) => re.test(s.kind)).flatMap((s) => s.text.split('\n').map((l) => l.replace(/^[•\-*\s]+/, '').trim()).filter((l) => l.length > 15)).slice(0, 20);
  const years = detectYears(text);
  const langs = [...text.matchAll(/(fluent|native|professional|business)[- ]?(?:level)?\s+(?:in\s+)?(german|french|spanish|portuguese|dutch|italian|japanese|mandarin|chinese|polish|swedish|korean|arabic|hebrew|turkish)/gi)].map((m) => m[2]);
  const questions = text.split('\n').filter((l) => /\?\s*$/.test(l.trim()) && l.length < 200).slice(0, 10);

  return {
    requirements: [...imp.values()].sort((a, b) => ({ required: 0, mentioned: 1, preferred: 2 }[a.importance] - { required: 0, mentioned: 1, preferred: 2 }[b.importance]) || b.mentions - a.mentions),
    seniority: detectSeniority(title, text),
    yearsMin: years.min, yearsMax: years.max,
    roleType: detectRoleType(title),
    languageRequirements: [...new Set(langs.map((l) => l[0].toUpperCase() + l.slice(1).toLowerCase()))],
    clearance: /security clearance|clearance required|active (secret|ts\/sci)|public trust/i.test(text),
    responsibilities: lines(/responsibilities/),
    requirementLines: lines(/required|preferred/),
    screeningHints: questions,
  };
}
