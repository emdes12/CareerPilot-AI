/** Phrases that read as generic or AI-written. Matching is case-insensitive. */
export const BANNED_PHRASES = [
  'i am thrilled to apply', "i'm thrilled to apply", 'thrilled to', 'passionate and results-driven', 'results-driven', 'perfect fit', 'excited to leverage',
  'illustrious career', 'uniquely positioned', 'ideal candidate', 'confident that my extensive experience', 'i am writing to express my interest',
  'i am excited to apply', 'dynamic team', 'fast-paced environment', 'synergy', 'synergies', 'rockstar', 'ninja', 'guru', 'go-getter', 'self-starter',
  'proven track record', 'think outside the box', 'hit the ground running', 'wealth of experience', 'deeply passionate', 'testament to',
  'in today\'s fast-paced', 'cutting-edge', 'leverage my', 'delve', 'tapestry', 'seamlessly', 'game-changer', 'world-class',
];

/**
 * Writing style for every generated application document, based on how the candidate writes:
 * direct, clear, specific, first person, no hype. Shared by all document agents' prompts.
 */
export const STYLE_GUIDE = `Write like the candidate writes: direct, clear and specific, in plain international English.
- First person, short sentences, active voice. Say what was built, for whom, and with what.
- Name real projects, employers and technologies from the source material instead of adjectives.
- No hype, no superlatives, no flattery of the employer, no claims about being a "fit".
- Never use these phrases or close variants: ${BANNED_PHRASES.slice(0, 22).map((b) => `"${b}"`).join(', ')}.
- Vary sentence openings; do not start several sentences the same way.
- Be honest about gaps in one plain sentence, without apologising.`;

/** Deterministic variety: pick a variant by a stable seed (e.g. the job id) so documents don't all read the same. */
export const pick = <T>(seed: number, options: T[]): T => options[Math.abs(Math.trunc(seed)) % options.length];
