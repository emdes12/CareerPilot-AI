/**
 * Initial professional evidence, each claim traced to where it was found.
 *  P = portfolio data (https://alawiyemuritala.xyz — a client-rendered site; content read from its published bundle)
 *  G = public GitHub (https://github.com/emdes12)
 *  B = the user's own written brief (user-stated; treated as user_confirmed unless another source contradicts it)
 * Contradictions are stored as `conflicting` with a shared group and are NOT usable until the user resolves them.
 */
type Status = 'verified' | 'user_confirmed' | 'indicated' | 'missing' | 'conflicting';
export interface SeedClaim { entity_type: string; entity_key: string; field: string; value: string; source_type: string; source_url: string | null; status: Status; conflict_group?: string; note?: string }

const P = 'https://alawiyemuritala.xyz';
const G = 'https://github.com/emdes12';
const p = (entity_type: string, entity_key: string, field: string, value: string, extra: Partial<SeedClaim> = {}): SeedClaim => ({ entity_type, entity_key, field, value, source_type: 'portfolio', source_url: P, status: 'verified', ...extra });
const b = (entity_type: string, entity_key: string, field: string, value: string, extra: Partial<SeedClaim> = {}): SeedClaim => ({ entity_type, entity_key, field, value, source_type: 'user_brief', source_url: null, status: 'user_confirmed', ...extra });
const g = (entity_type: string, entity_key: string, field: string, value: string, url: string): SeedClaim => ({ entity_type, entity_key, field, value, source_type: 'github', source_url: url, status: 'verified' });

export const seedEvidence: SeedClaim[] = [
  // ---- Luvie LLC ----
  b('experience', 'Luvie LLC', 'title', 'Full-Stack Engineer (Team Lead)', { status: 'conflicting', conflict_group: 'luvie-title', note: 'Brief says Team Lead; portfolio says Fullstack Engineer.' }),
  p('experience', 'Luvie LLC', 'title', 'Full-Stack Engineer', { status: 'conflicting', conflict_group: 'luvie-title', note: 'Portfolio wording ("Fullstack Engineer").' }),
  p('experience', 'Luvie LLC', 'dates', '2026-04|present', { note: 'Brief and portfolio agree: Apr 2026 – Present.' }),
  p('experience', 'Luvie LLC', 'responsibility', 'Build and maintain web application features across the frontend and backend.'),
  p('experience', 'Luvie LLC', 'responsibility', 'Develop responsive interfaces, integrate APIs and manage application data.'),
  p('experience', 'Luvie LLC', 'responsibility', 'Implement backend services and keep features reliable and maintainable in production.'),
  b('experience', 'Luvie LLC', 'responsibility', 'Lead engineering work on the AI-powered beauty and stylist booking platform.', { status: 'conflicting', conflict_group: 'luvie-title', note: 'Depends on confirming the Team Lead title.' }),
  b('experience', 'Luvie LLC', 'responsibility', 'Develop REST APIs, including authentication and authorisation.'),
  b('experience', 'Luvie LLC', 'responsibility', 'Integrate booking and payment flows.'),
  b('experience', 'Luvie LLC', 'responsibility', 'Handle application architecture and deployment.'),
  b('experience', 'Luvie LLC', 'technology', 'react', { status: 'conflicting', conflict_group: 'luvie-frontend', note: 'Brief says React; portfolio project describes a Vue.js booking UI (2025).' }),
  p('experience', 'Luvie LLC', 'technology', 'vue', { status: 'conflicting', conflict_group: 'luvie-frontend', note: 'Portfolio: "product design with Vue.js implementation".' }),
  b('experience', 'Luvie LLC', 'technology', 'nodejs'), b('experience', 'Luvie LLC', 'technology', 'express'), b('experience', 'Luvie LLC', 'technology', 'postgresql'),
  b('experience', 'Luvie LLC', 'technology', 'rest'), b('experience', 'Luvie LLC', 'technology', 'auth'), b('experience', 'Luvie LLC', 'technology', 'payments'),

  // ---- JobBox ----
  p('experience', 'JobBox', 'title', 'Frontend Engineer → Software Engineer', { note: 'Portfolio: Frontend Engineer (2025–2026), Software Engineer (Current).' }),
  p('experience', 'JobBox', 'dates', '2025|present', { status: 'indicated', note: 'Only years are published; brief says dates need verification. Add months to confirm.' }),
  p('experience', 'JobBox', 'responsibility', 'Designed and built Vue.js product interfaces for an AI-native recruitment workspace, from user flows and Figma UI to frontend implementation.'),
  p('experience', 'JobBox', 'responsibility', 'Built the candidate dashboard (job listings, match scores, AI search) and the recruiter workspace (pipeline overview, analytics, applications).'),
  p('experience', 'JobBox', 'responsibility', 'Designed and developed the product UI for veenna, a voice-first productivity workspace, in Figma and Vue.js.'),
  p('experience', 'JobBox', 'technology', 'vue'), p('experience', 'JobBox', 'technology', 'figma'),

  // ---- Skyta LLC ----
  p('experience', 'Skyta LLC', 'title', 'Frontend Engineer (Vue.js)'),
  p('experience', 'Skyta LLC', 'dates', '2025|2026', { note: 'Years only.' }),
  p('experience', 'Skyta LLC', 'responsibility', 'Developed responsive web interfaces for an academy platform and landing pages with Vue 3.'),
  p('experience', 'Skyta LLC', 'responsibility', 'Built reusable components with the Composition API and integrated them with backend APIs.'),
  p('experience', 'Skyta LLC', 'responsibility', 'Handled application state and data flows, improving usability and maintainability across devices.'),
  p('experience', 'Skyta LLC', 'technology', 'vue'), p('experience', 'Skyta LLC', 'technology', 'vue_composition'), p('experience', 'Skyta LLC', 'technology', 'rest'),

  // ---- IvoryLearn ----
  p('experience', 'IvoryLearn', 'title', 'Frontend Developer'),
  p('experience', 'IvoryLearn', 'dates', '2025-09|present'),
  p('experience', 'IvoryLearn', 'responsibility', 'Develop responsive LMS interfaces in Vue.js, Astro and Tailwind CSS, connected to backend APIs.'),
  p('experience', 'IvoryLearn', 'responsibility', 'Built the public site and look after navigation, accessibility and SEO across learning pages.'),
  p('experience', 'IvoryLearn', 'technology', 'vue'), p('experience', 'IvoryLearn', 'technology', 'astro'), p('experience', 'IvoryLearn', 'technology', 'tailwind'),
  p('experience', 'IvoryLearn', 'technology', 'seo'), p('experience', 'IvoryLearn', 'technology', 'accessibility'),

  // ---- KidsClubZone ----
  p('experience', 'KidsClubZone', 'title', 'Frontend Developer · JavaScript Instructor'),
  p('experience', 'KidsClubZone', 'dates', '2024-01|present'),
  p('experience', 'KidsClubZone', 'responsibility', 'Build responsive educational web applications in Vue.js and Tailwind CSS: reusable UI components, dynamic learning pages and interactive features.'),
  p('experience', 'KidsClubZone', 'responsibility', 'Since June 2026, teach HTML5, CSS3 and JavaScript (ES6) to young learners.'),
  p('experience', 'KidsClubZone', 'technology', 'vue'), p('experience', 'KidsClubZone', 'technology', 'tailwind'), p('experience', 'KidsClubZone', 'technology', 'javascript'),

  // ---- DaarulTahseen ----
  p('experience', 'DaarulTahseen', 'title', 'React.js Developer', { note: 'Brief and portfolio agree.' }),
  p('experience', 'DaarulTahseen', 'dates', '2023|2025', { note: 'Years only.' }),
  p('experience', 'DaarulTahseen', 'responsibility', 'Developed responsive, interactive interfaces for an online learning management platform using React.js.'),
  p('experience', 'DaarulTahseen', 'responsibility', 'Built reusable components for learning workflows and connected them to APIs.'),
  p('experience', 'DaarulTahseen', 'responsibility', 'Managed dynamic data and kept functionality consistent across devices.'),
  p('experience', 'DaarulTahseen', 'technology', 'react'), p('experience', 'DaarulTahseen', 'technology', 'javascript'),

  // ---- The Boltcliq Company ----
  b('experience', 'The Boltcliq Company', 'title', 'Frontend Engineer', { status: 'conflicting', conflict_group: 'boltcliq-title', note: 'Brief wording.' }),
  p('experience', 'The Boltcliq Company', 'title', 'Frontend Web Development Intern', { status: 'conflicting', conflict_group: 'boltcliq-title', note: 'Portfolio wording.' }),
  p('experience', 'The Boltcliq Company', 'dates', '2024-01|2024-12'),
  p('experience', 'The Boltcliq Company', 'responsibility', 'Built responsive web pages in HTML, CSS and JavaScript.'),
  p('experience', 'The Boltcliq Company', 'responsibility', 'Optimised UI components for mobile and cross-browser compatibility.'),
  p('experience', 'The Boltcliq Company', 'responsibility', 'Worked with senior developers to debug and improve frontend performance.'),
  p('experience', 'The Boltcliq Company', 'technology', 'html'), p('experience', 'The Boltcliq Company', 'technology', 'css'), p('experience', 'The Boltcliq Company', 'technology', 'javascript'),

  // ---- Projects ----
  p('project', 'Luvie', 'contribution', 'Designed and developed the responsive booking experience so customers can find a stylist and complete a booking on their own devices.', { source_url: 'https://luvie.io' }),
  p('project', 'Luvie', 'technology', 'vue', { source_url: 'https://luvie.io' }),
  p('project', 'StockỌja', 'contribution', 'Built inventory management, sales tracking, transaction recording and reporting workflows, and the merchant dashboard (sales, POS, inventory, orders, reports).', { source_url: 'https://www.stockoja.com' }),
  p('project', 'StockỌja', 'contribution', 'Built a separate affiliate portal with referral links, click analytics (bot traffic filtered out), commissions counted only on verified payments, and payouts.', { source_url: 'https://affiliate.stockoja.com' }),
  { entity_type: 'project', entity_key: 'StockỌja', field: 'technology', value: '', source_type: 'portfolio', source_url: P, status: 'missing', note: 'Technology stack not published. Add it to use StockỌja as evidence for specific technologies.' },
  p('project', 'Routta', 'contribution', 'Designed the application architecture and implemented core features: location-based functionality, ride workflows, pricing logic and user management.', { source_url: 'https://routta.app' }),
  { entity_type: 'project', entity_key: 'Routta', field: 'technology', value: '', source_type: 'portfolio', source_url: P, status: 'missing', note: 'Technology stack not published.' },
  p('project', 'Relate+ CRM', 'contribution', 'Developed the frontend and connected it to a Node.js/Express and PostgreSQL backend; built a form builder, drag-and-drop interactions and data export.', { source_url: 'https://relateplus.netlify.app' }),
  g('project', 'Relate+ CRM', 'technology', 'vue', `${G}/Relateplus-CRM`),
  p('project', 'Relate+ CRM', 'technology', 'nodejs'), p('project', 'Relate+ CRM', 'technology', 'express'), p('project', 'Relate+ CRM', 'technology', 'postgresql'),
  p('project', 'KAFMAF Membership Platform', 'contribution', 'Built a membership platform: account creation, applications with photo upload, admin review, system-assigned membership numbers and downloadable ID cards with QR codes that check live membership status.', { source_url: 'https://kafmaf.vercel.app' }),
  g('project', 'KAFMAF Membership Platform', 'technology', 'vue', `${G}/kafmaf`),
  p('project', 'JobBox Dashboard & Recruiter Workspace', 'contribution', 'Designed in Figma and built in Vue.js the candidate home, job listings with match scores, and the recruiter pipeline and analytics dashboards.', { source_url: 'https://app.getjobbox.com' }),
  p('project', 'JobBox Dashboard & Recruiter Workspace', 'technology', 'vue', { source_url: 'https://app.getjobbox.com' }),

  // ---- Profile-level facts ----
  { entity_type: 'profile', entity_key: 'profile', field: 'education', value: '', source_type: 'portfolio', source_url: P, status: 'missing', note: 'No education or certifications found in any source.' },
  { entity_type: 'profile', entity_key: 'profile', field: 'notice_period', value: '', source_type: 'user_brief', source_url: null, status: 'missing', note: 'Notice period unknown.' },
  g('profile', 'profile', 'fact', 'Public GitHub with TypeScript, Vue, Python and PHP repositories (53 public repos).', G),
];

export const seedSources = [
  { source_type: 'portfolio', url: P, title: 'Portfolio', status: 'reviewed', detail: 'Client-rendered site with no separate case-study pages. Experience, projects and descriptions were read from its published app bundle (all project cards and experience entries).' },
  { source_type: 'cv', url: `${P}/profile/resume.pdf`, title: 'Résumé PDF (from portfolio)', status: 'partial', detail: 'Downloaded, but no text could be extracted yet (may be image-based). Upload a text-based CV to add it as evidence.' },
  { source_type: 'github', url: G, title: 'GitHub', status: 'reviewed', detail: '53 public repositories reviewed via the GitHub API (names, languages, descriptions, live links).' },
  { source_type: 'linkedin', url: 'https://linkedin.com/in/alawiye-muritala', title: 'LinkedIn', status: 'inaccessible', detail: 'LinkedIn does not permit automated access. Paste your LinkedIn experience section or upload a LinkedIn PDF export to add it.' },
];
