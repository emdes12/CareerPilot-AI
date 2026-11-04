/**
 * Nigeria work-eligibility assessment. Conservative by design:
 *  - "eligible" only when the listing explicitly includes Nigeria/Africa/worldwide/anywhere (quoted as evidence)
 *  - "likely" for EMEA / UTC+1-compatible timezone windows / unrestricted structured data
 *  - "unknown" when nothing decisive is stated
 *  - "ineligible" when the listing restricts location to places that exclude Nigeria, or requires on-site/relocation
 */
export type EligibilityStatus = 'eligible' | 'likely' | 'unknown' | 'ineligible';
export interface Evidence { text: string; source: 'location' | 'description' | 'structured'; effect: 'positive' | 'negative' | 'neutral' }
export interface Eligibility { status: EligibilityStatus; confidence: 'high' | 'medium' | 'low'; workArrangement: 'remote' | 'hybrid' | 'onsite' | 'unknown'; evidence: Evidence[]; summary: string }

const NG_UTC = 1;

const POSITIVE: [RegExp, string][] = [
  [/\bnigeria\b|\blagos\b|\babuja\b/i, 'Nigeria explicitly listed'],
  [/\bafrica\b|\bsub-saharan\b|\bwest africa\b/i, 'Africa explicitly listed'],
  [/\bworld\s?wide\b|\banywhere in the world\b|\bwork from anywhere\b|\bremote[ -]?\(?anywhere\)?|\bglobal(ly)? remote\b|\bfrom any country\b|\bany location\b|\banywhere\b|\bglobal\b(?!\s+(company|leader|team|brand|customers|scale|market|economy|payments|platform))/i, 'Worldwide/anywhere'],
];
const EMEA = /\bEMEA\b|europe,? middle east,? (and|&) africa/i;
const NEGATIVE: [RegExp, string][] = [
  [/\b(us|u\.s\.|usa|united states|canada|uk|united kingdom|eu|european union|germany|india|australia|latam|latin america|brazil|mexico|philippines|europe)[- ]?(only|based only|residents only)\b/i, 'Location restricted (… only)'],
  [/\bmust (be|reside|live)\s+(located\s+|based\s+)?(in|within)\s+(the\s+)?(us|u\.s\.|usa|united states|canada|uk|united kingdom|europe|eu|germany|australia|india|one of the following)/i, 'Must reside in a specific country'],
  [/\b(authori[sz]ed|eligible|legally able|right) to work in (the\s+)?(us|u\.s\.|usa|united states|uk|united kingdom|canada|eu|europe|australia)\b(?![^.]{0,60}\b(or|and) (nigeria|africa))/i, 'Requires work authorisation in a specific country'],
  [/\b(u\.s\.|us) citizen(ship)?\b|\bgreen card\b|\bsecurity clearance\b|\bclearance required\b/i, 'Citizenship/clearance requirement'],
  [/\bwe (are )?(unable|not able) to (sponsor|hire)( employees)? (outside|in countries)/i, 'Cannot hire outside listed countries'],
  [/\b(hybrid|on-?site|in[- ]office|office-based|days? (a|per) week in (the )?office)\b/i, 'Hybrid / on-site attendance'],
  [/\brelocat(e|ion) (to|is required)|\bmust relocate\b/i, 'Relocation required'],
];

const NON_NG_PLACES = /\b(united states|usa|u\.s\.|canada|united kingdom|uk|germany|france|spain|portugal|netherlands|poland|ireland|india|brazil|mexico|argentina|colombia|philippines|australia|new zealand|japan|singapore|israel|sweden|italy|romania|ukraine|switzerland|austria|belgium|denmark|norway|finland|czech|turkey|south africa|kenya|egypt|new york|san francisco|london|berlin|toronto|vancouver|paris|amsterdam|madrid|lisbon|dublin|bangalore|bengaluru|sydney|austin|seattle|boston|chicago|los angeles|denver|atlanta|warsaw|krakow|bucharest|tel aviv|ny|ca|tx|wa)\b/i;

function quote(text: string, idx: number, len: number) {
  const s = Math.max(0, idx - 80); const e = Math.min(text.length, idx + len + 80);
  return (s > 0 ? '…' : '') + text.slice(s, e).replace(/\s+/g, ' ').trim() + (e < text.length ? '…' : '');
}

const TITLE_RESTRICTION = /\b(u\.?s\.?a?|united states|canada|uk|united kingdom|eu|europe|emea|latam|latin america|apac|india|germany|brazil|mexico|philippines|australia|americas|north america)\b[\s-]*(based|only|residents?|remote)?|\bremote[\s-]*[-–(,]\s*(u\.?s\.?a?|uk|canada|eu|europe|latam|india|germany|americas|north america)\b/i;

export function assessEligibility(input: { title?: string | null; locationRaw?: string | null; locationRestrictions?: string[]; timezoneRestrictions?: number[]; description?: string | null; source?: string }): Eligibility {
  const ev: Evidence[] = [];
  // 0) Region restrictions written into the title, e.g. "Web Developer (U.S. Based)" or "Engineer – Remote, LATAM".
  const tm = input.title ? TITLE_RESTRICTION.exec(input.title) : null;
  if (tm && !/emea/i.test(tm[0])) ev.push({ text: `Title restricts location: “${input.title}”`, source: 'location', effect: 'negative' });
  else if (tm) ev.push({ text: `Title targets EMEA: “${input.title}”. Nigeria is in EMEA, but confirm.`, source: 'location', effect: 'neutral' });
  const loc = (input.locationRaw ?? '').trim();
  const desc = input.description ?? '';
  const restr = input.locationRestrictions ?? [];
  let arrangement: Eligibility['workArrangement'] = /remote|anywhere|worldwide|distributed/i.test(loc + ' ' + desc.slice(0, 3000)) ? 'remote' : 'unknown';

  // 1) Structured restriction lists (Himalayas etc.) — most reliable.
  if (input.source === 'himalayas') {
    if (restr.length === 0) ev.push({ text: 'Himalayas lists no country restrictions for this role.', source: 'structured', effect: 'positive' });
    else if (restr.some((r) => /nigeria/i.test(r))) ev.push({ text: `Allowed countries include Nigeria (${restr.length} countries listed).`, source: 'structured', effect: 'positive' });
    else ev.push({ text: `Allowed countries: ${restr.slice(0, 12).join(', ')}${restr.length > 12 ? '…' : ''} — Nigeria not included.`, source: 'structured', effect: 'negative' });
  }
  const tz = input.timezoneRestrictions ?? [];
  if (tz.length) {
    const ok = tz.some((z) => Math.abs(z - NG_UTC) <= 1);
    ev.push({ text: `Timezone window: UTC${tz.map((z) => (z >= 0 ? '+' : '') + z).slice(0, 8).join(', ')} — ${ok ? 'includes' : 'excludes'} Nigeria (UTC+1).`, source: 'structured', effect: ok ? 'positive' : 'negative' });
  }

  // 2) Location field.
  for (const [re, label] of POSITIVE) { const m = loc.match(re); if (m) { ev.push({ text: `${label}: “${loc}”`, source: 'location', effect: 'positive' }); break; } }
  if (EMEA.test(loc)) ev.push({ text: `EMEA region listed (“${loc}”). Nigeria is in EMEA, but confirm the employer hires there.`, source: 'location', effect: 'neutral' });
  const locHasPositive = ev.some((e) => e.source === 'location' && e.effect === 'positive') || EMEA.test(loc);
  if (loc && !locHasPositive && input.source !== 'himalayas') {
    const parts = loc.split(/\s*[|;/]\s*/).filter(Boolean);
    const placeParts = parts.filter((p) => NON_NG_PLACES.test(p) || /,\s*[A-Z]{2}\b/.test(p));
    if (placeParts.length && placeParts.length === parts.filter((p) => !/^remote$/i.test(p)).length) {
      ev.push({ text: `Listed location(s): “${loc}” — specific countries/cities that do not include Nigeria.`, source: 'location', effect: 'negative' });
    }
  }
  if (/\bhybrid\b/i.test(loc)) arrangement = 'hybrid';
  if (/\b(on-?site|in office)\b/i.test(loc)) arrangement = 'onsite';

  // 3) Description text.
  for (const [re, label] of POSITIVE.slice(0, 2)) { const m = re.exec(desc); if (m) ev.push({ text: `${label}: ${quote(desc, m.index, m[0].length)}`, source: 'description', effect: 'positive' }); }
  const ww = /(hire|hiring|work|remote|candidates?|located|live)\s[^.]{0,40}\b(anywhere|worldwide|any country|around the world)\b/i.exec(desc);
  if (ww) ev.push({ text: `Worldwide hiring stated: ${quote(desc, ww.index, ww[0].length)}`, source: 'description', effect: 'positive' });
  const emea = EMEA.exec(desc);
  if (emea && !EMEA.test(loc)) ev.push({ text: `EMEA mentioned: ${quote(desc, emea.index, emea[0].length)}`, source: 'description', effect: 'neutral' });
  for (const [re, label] of NEGATIVE) {
    const m = re.exec(desc) ?? re.exec(loc);
    if (!m) continue;
    if (/hybrid|on-?site/i.test(label)) {
      // "no office, not hybrid" style negations shouldn't count.
      const ctx = desc.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + 40);
      if (/\b(no|not|never|without|fully remote|100% remote)\b/i.test(ctx)) continue;
      arrangement = /hybrid/i.test(m[0]) ? 'hybrid' : 'onsite';
    }
    ev.push({ text: `${label}: ${quote(re.exec(desc) ? desc : loc, m.index ?? 0, m[0].length)}`, source: re.exec(desc) ? 'description' : 'location', effect: 'negative' });
  }

  // 4) Decide.
  const pos = ev.filter((e) => e.effect === 'positive');
  const neg = ev.filter((e) => e.effect === 'negative');
  const explicitNg = pos.some((e) => /Nigeria|Africa/.test(e.text));
  const structuredNeg = neg.some((e) => e.source === 'structured' && /not included/.test(e.text));
  const hardNeg = neg.some((e) => /Hybrid|on-site|Relocation|Citizenship|Must reside|only|Cannot hire|work authorisation/.test(e.text)) || structuredNeg || neg.some((e) => e.source === 'location');

  let status: EligibilityStatus; let confidence: Eligibility['confidence']; let summary: string;
  const titleNeg = neg.some((e) => /^Title restricts/.test(e.text));
  if (explicitNg && !structuredNeg && !titleNeg && arrangement !== 'onsite') { status = 'eligible'; confidence = 'high'; summary = 'Nigeria/Africa is explicitly included.'; }
  else if (hardNeg) { status = 'ineligible'; confidence = neg.length > 1 || structuredNeg ? 'high' : 'medium'; summary = neg[0]?.text.split(':')[0] ?? 'Location restricted.'; }
  else if (pos.some((e) => /Worldwide|anywhere|Worldwide hiring/i.test(e.text))) { status = 'eligible'; confidence = 'medium'; summary = 'Listing says worldwide/anywhere. Confirm no country exclusions in the application form.'; }
  else if (pos.length || ev.some((e) => /EMEA/.test(e.text))) { status = 'likely'; confidence = 'low'; summary = 'Signals suggest Nigeria may be accepted (EMEA / timezone / no listed restriction), but it is not explicitly stated.'; }
  else { status = 'unknown'; confidence = 'low'; summary = 'The listing does not state which countries are eligible.'; }
  if (neg.some((e) => /authorisation/.test(e.text)) && status === 'eligible') { status = 'likely'; summary += ' Note: work authorisation wording found.'; }
  return { status, confidence, workArrangement: arrangement, evidence: ev, summary };
}
