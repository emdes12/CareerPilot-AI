const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', hellip: '…', bull: '•' };

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

/** Convert job-description HTML into readable plain text with line structure preserved. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  let s = html;
  // Some APIs return entity-encoded HTML (Greenhouse); decode once first if needed.
  if (/&lt;\w/.test(s) && !/<\w/.test(s)) s = decodeEntities(s);
  s = s
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|h[1-6]|li|ul|ol|tr|section)>/gi, '\n')
    .replace(/<h[1-6][^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  return s.replace(/[ \t ]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').replace(/^ +| +$/gm, '').trim();
}

export function normKey(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(inc|llc|ltd|limited|gmbh|corp|corporation|co|plc|sa|bv|technologies|technology|labs|hq)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

export function normTitle(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b(remote|worldwide|global|anywhere|contract|full[- ]?time|part[- ]?time|m\/f\/d|f\/m\/d|w\/m\/d|us|uk|emea|europe|latam|apac)\b/g, ' ')
    .replace(/sr\.?/g, 'senior')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function fingerprint(company: string, title: string): string {
  return `${normKey(company)}::${normTitle(title)}`;
}

export interface Section { heading: string; kind: 'required' | 'preferred' | 'responsibilities' | 'about' | 'benefits' | 'other'; text: string }

const HEADING_KINDS: [RegExp, Section['kind']][] = [
  [/(nice[- ]to[- ]have|bonus|preferred|plus(es)?\b|desirable|good to have|extra credit|would be great|not required)/i, 'preferred'],
  [/(requirement|qualification|what you('|’)?ll need|you have|you bring|must[- ]have|what we('|’)?re looking for|skills|about you|who you are|you should|experience|what you bring|ideal candidate|you are)/i, 'required'],
  [/(responsibilit|what you('|’)?ll do|the role|your role|day[- ]to[- ]day|you will|in this role|what you will)/i, 'responsibilities'],
  [/(benefit|perks|what we offer|compensation|salary|why join|we offer)/i, 'benefits'],
  [/(about (us|the company)|who we are|our mission|company)/i, 'about'],
];

/** Split a description into sections by heading-like lines. */
export function splitSections(text: string): Section[] {
  const lines = text.split('\n');
  const sections: Section[] = [];
  let cur: Section = { heading: '', kind: 'other', text: '' };
  for (const raw of lines) {
    const line = raw.trim();
    const isHeading = line.length > 2 && line.length < 80 && !line.startsWith('•') && (/:$/.test(line) || (/^[A-Z][^.!?]*$/.test(line) && line.split(' ').length <= 9));
    const kind = isHeading ? HEADING_KINDS.find(([re]) => re.test(line))?.[1] : undefined;
    if (isHeading && kind) {
      if (cur.text.trim() || cur.heading) sections.push(cur);
      cur = { heading: line.replace(/:$/, ''), kind, text: '' };
    } else {
      cur.text += raw + '\n';
    }
  }
  sections.push(cur);
  return sections.filter((s) => s.text.trim());
}

export function truncate(s: string, n: number) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

export function extractEmails(text: string): string[] {
  const m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return [...new Set(m.map((e) => e.toLowerCase()))].filter((e) => !/\.(png|jpg|gif|svg)$/.test(e) && !/example\.com$/.test(e));
}
