/**
 * Canonical technology taxonomy.
 * - key: canonical id stored in DB
 * - aliases: phrases matched case-insensitively on word boundaries
 * - related: skills that make this one a *transferable* (partial) match
 */
export interface SkillDef { key: string; label: string; category: string; aliases: string[]; related?: string[] }

export const SKILLS: SkillDef[] = [
  // Languages
  { key: 'javascript', label: 'JavaScript', category: 'language', aliases: ['javascript', 'js', 'es6', 'ecmascript', 'es2015'] },
  { key: 'typescript', label: 'TypeScript', category: 'language', aliases: ['typescript', 'ts'], related: ['javascript'] },
  { key: 'python', label: 'Python', category: 'language', aliases: ['python', 'python3'] },
  { key: 'go', label: 'Go', category: 'language', aliases: ['golang', 'go lang', 'go'] },
  { key: 'java', label: 'Java', category: 'language', aliases: ['java'] },
  { key: 'kotlin', label: 'Kotlin', category: 'language', aliases: ['kotlin'] },
  { key: 'ruby', label: 'Ruby', category: 'language', aliases: ['ruby'] },
  { key: 'php', label: 'PHP', category: 'language', aliases: ['php'] },
  { key: 'csharp', label: 'C#', category: 'language', aliases: ['c#', 'csharp', '.net', 'dotnet', 'asp.net'] },
  { key: 'rust', label: 'Rust', category: 'language', aliases: ['rust'] },
  { key: 'scala', label: 'Scala', category: 'language', aliases: ['scala'] },
  { key: 'elixir', label: 'Elixir', category: 'language', aliases: ['elixir'] },
  { key: 'swift', label: 'Swift', category: 'language', aliases: ['swift'] },
  { key: 'sql', label: 'SQL', category: 'data', aliases: ['sql'] },
  { key: 'html', label: 'HTML5', category: 'frontend', aliases: ['html', 'html5'] },
  { key: 'css', label: 'CSS3', category: 'frontend', aliases: ['css', 'css3', 'scss', 'sass'] },
  // Frontend
  { key: 'react', label: 'React.js', category: 'frontend', aliases: ['react', 'react.js', 'reactjs', 'react js', 'react hooks'], related: ['vue'] },
  { key: 'nextjs', label: 'Next.js', category: 'frontend', aliases: ['next.js', 'nextjs', 'next js'], related: ['react', 'nuxt'] },
  { key: 'vue', label: 'Vue.js 3', category: 'frontend', aliases: ['vue', 'vue.js', 'vuejs', 'vue 3', 'vue3', 'vue js'], related: ['react'] },
  { key: 'vue_composition', label: 'Vue Composition API', category: 'frontend', aliases: ['composition api'], related: ['vue'] },
  { key: 'nuxt', label: 'Nuxt', category: 'frontend', aliases: ['nuxt', 'nuxt.js', 'nuxtjs'], related: ['vue', 'nextjs'] },
  { key: 'angular', label: 'Angular', category: 'frontend', aliases: ['angular', 'angularjs'], related: ['react', 'vue'] },
  { key: 'svelte', label: 'Svelte', category: 'frontend', aliases: ['svelte', 'sveltekit'], related: ['vue', 'react'] },
  { key: 'react_native', label: 'React Native', category: 'mobile', aliases: ['react native', 'react-native'], related: ['react'] },
  { key: 'flutter', label: 'Flutter', category: 'mobile', aliases: ['flutter', 'dart'] },
  { key: 'tailwind', label: 'Tailwind CSS', category: 'frontend', aliases: ['tailwind', 'tailwindcss', 'tailwind css'], related: ['css'] },
  { key: 'redux', label: 'Redux', category: 'frontend', aliases: ['redux', 'redux toolkit', 'zustand', 'mobx'], related: ['react'] },
  { key: 'pinia', label: 'Pinia/Vuex', category: 'frontend', aliases: ['pinia', 'vuex'], related: ['vue'] },
  { key: 'astro', label: 'Astro', category: 'frontend', aliases: ['astro'] },
  { key: 'vite', label: 'Vite', category: 'frontend', aliases: ['vite', 'webpack'] },
  { key: 'figma', label: 'Figma', category: 'design', aliases: ['figma'] },
  { key: 'accessibility', label: 'Accessibility (a11y)', category: 'frontend', aliases: ['accessibility', 'a11y', 'wcag'] },
  // Backend
  { key: 'nodejs', label: 'Node.js', category: 'backend', aliases: ['node', 'node.js', 'nodejs', 'node js'] },
  { key: 'express', label: 'Express.js', category: 'backend', aliases: ['express', 'express.js', 'expressjs'], related: ['nodejs', 'nestjs'] },
  { key: 'nestjs', label: 'NestJS', category: 'backend', aliases: ['nestjs', 'nest.js'], related: ['express', 'nodejs'] },
  { key: 'django', label: 'Django', category: 'backend', aliases: ['django'], related: ['python'] },
  { key: 'fastapi', label: 'FastAPI', category: 'backend', aliases: ['fastapi', 'flask'], related: ['python'] },
  { key: 'rails', label: 'Ruby on Rails', category: 'backend', aliases: ['rails', 'ruby on rails'] },
  { key: 'laravel', label: 'Laravel', category: 'backend', aliases: ['laravel'], related: ['php'] },
  { key: 'spring', label: 'Spring', category: 'backend', aliases: ['spring boot', 'spring'] },
  { key: 'rest', label: 'REST APIs', category: 'backend', aliases: ['rest', 'restful', 'rest api', 'rest apis', 'restful api', 'restful apis', 'apis'] },
  { key: 'graphql', label: 'GraphQL', category: 'backend', aliases: ['graphql', 'apollo'], related: ['rest'] },
  { key: 'grpc', label: 'gRPC', category: 'backend', aliases: ['grpc'], related: ['rest'] },
  { key: 'websockets', label: 'WebSockets', category: 'backend', aliases: ['websocket', 'websockets', 'socket.io'] },
  { key: 'auth', label: 'Authentication & Authorisation', category: 'backend', aliases: ['authentication', 'authorization', 'authorisation', 'oauth', 'jwt', 'sso', 'auth0'] },
  { key: 'payments', label: 'Payment integration', category: 'backend', aliases: ['payments', 'payment integration', 'stripe', 'paystack', 'flutterwave', 'billing'] },
  { key: 'microservices', label: 'Microservices', category: 'architecture', aliases: ['microservices', 'microservice', 'distributed systems'] },
  { key: 'system_design', label: 'System design', category: 'architecture', aliases: ['system design', 'software architecture', 'scalable systems', 'scalability'] },
  // Data
  { key: 'postgresql', label: 'PostgreSQL', category: 'data', aliases: ['postgres', 'postgresql', 'psql', 'neondb', 'neon'], related: ['mysql', 'sql'] },
  { key: 'mysql', label: 'MySQL', category: 'data', aliases: ['mysql', 'mariadb'], related: ['postgresql', 'sql'] },
  { key: 'mongodb', label: 'MongoDB', category: 'data', aliases: ['mongodb', 'mongo', 'mongoose'] },
  { key: 'redis', label: 'Redis', category: 'data', aliases: ['redis'] },
  { key: 'firebase', label: 'Firebase', category: 'data', aliases: ['firebase', 'firestore'] },
  { key: 'supabase', label: 'Supabase', category: 'data', aliases: ['supabase'], related: ['postgresql', 'firebase'] },
  { key: 'prisma', label: 'Prisma/ORM', category: 'data', aliases: ['prisma', 'typeorm', 'sequelize', 'drizzle', 'orm'], related: ['postgresql'] },
  { key: 'elasticsearch', label: 'Elasticsearch', category: 'data', aliases: ['elasticsearch', 'opensearch'] },
  { key: 'kafka', label: 'Kafka', category: 'data', aliases: ['kafka', 'rabbitmq', 'sqs', 'message queue', 'message queues'], related: ['redis'] },
  { key: 'object_storage', label: 'Object storage (S3/MinIO)', category: 'cloud', aliases: ['minio', 's3', 'object storage'] },
  // Cloud / DevOps
  { key: 'aws', label: 'AWS', category: 'cloud', aliases: ['aws', 'amazon web services', 'lambda', 'ec2'], related: ['gcp', 'azure'] },
  { key: 'gcp', label: 'Google Cloud', category: 'cloud', aliases: ['gcp', 'google cloud'], related: ['aws', 'azure'] },
  { key: 'azure', label: 'Azure', category: 'cloud', aliases: ['azure'], related: ['aws', 'gcp'] },
  { key: 'docker', label: 'Docker', category: 'devops', aliases: ['docker', 'containers', 'containerization', 'containerisation'] },
  { key: 'kubernetes', label: 'Kubernetes', category: 'devops', aliases: ['kubernetes', 'k8s', 'helm'], related: ['docker'] },
  { key: 'terraform', label: 'Terraform', category: 'devops', aliases: ['terraform', 'infrastructure as code', 'pulumi'] },
  { key: 'cicd', label: 'CI/CD', category: 'devops', aliases: ['ci/cd', 'ci cd', 'github actions', 'continuous integration', 'gitlab ci', 'circleci'] },
  { key: 'paas', label: 'Vercel/Netlify/Railway', category: 'devops', aliases: ['vercel', 'netlify', 'railway', 'heroku', 'render'] },
  { key: 'cloudflare', label: 'Cloudflare', category: 'devops', aliases: ['cloudflare'] },
  { key: 'linux', label: 'Linux', category: 'devops', aliases: ['linux', 'bash', 'unix'] },
  { key: 'git', label: 'Git & GitHub', category: 'tooling', aliases: ['git', 'github', 'gitlab', 'version control'] },
  { key: 'observability', label: 'Monitoring/observability', category: 'devops', aliases: ['observability', 'monitoring', 'datadog', 'sentry', 'grafana', 'prometheus'] },
  // Quality
  { key: 'testing', label: 'Automated testing', category: 'quality', aliases: ['unit testing', 'unit tests', 'automated testing', 'test automation', 'jest', 'vitest', 'mocha', 'tdd', 'testing library', 'integration tests', 'automated tests'] },
  { key: 'e2e', label: 'E2E testing', category: 'quality', aliases: ['cypress', 'playwright', 'selenium', 'end-to-end', 'e2e'], related: ['testing'] },
  // AI
  { key: 'ai_integration', label: 'AI / LLM integration', category: 'ai', aliases: ['llm', 'llms', 'openai', 'gpt', 'generative ai', 'genai', 'ai integration', 'large language models', 'prompt engineering', 'langchain', 'rag', 'anthropic', 'claude'] },
  { key: 'ml', label: 'Machine learning', category: 'ai', aliases: ['machine learning', 'pytorch', 'tensorflow', 'scikit-learn', 'deep learning'], related: ['python'] },
  // Practices
  { key: 'oop', label: 'Object-oriented programming', category: 'practice', aliases: ['object-oriented', 'object oriented', 'oop'] },
  { key: 'agile', label: 'Agile/Scrum', category: 'practice', aliases: ['agile', 'scrum', 'kanban'] },
  { key: 'leadership', label: 'Technical leadership', category: 'practice', aliases: ['mentoring', 'mentor', 'team lead', 'tech lead', 'technical leadership', 'lead a team', 'leading a team'] },
  { key: 'seo', label: 'SEO', category: 'frontend', aliases: ['seo'] },
];

const BY_KEY = new Map(SKILLS.map((s) => [s.key, s]));
export const skillDef = (k: string) => BY_KEY.get(k);

// Aliases that are too ambiguous as plain words need extra context.
const AMBIGUOUS = new Set(['go', 'ts', 'js', 'rest', 'apis', 'spring', 'swift', 'rust', 'node', 'express', 'react', 'vue', 'astro', 'render', 'git', 'sso', 's3', 'e2e', 'orm', 'java', 'ruby', 'scala', 'kanban', 'mentor', 'containers', 'neon', 'rag', 'claude', 'gpt']);

function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\#/]/g, '\\$&'); }

const MATCHERS: { key: string; re: RegExp }[] = SKILLS.flatMap((s) =>
  s.aliases.map((a) => {
    const body = escapeRe(a).replace(/\\ /g, '[\\s-]?').replace(/ /g, '[\\s-]?');
    // Custom boundaries so "c#", ".net", "node.js" work.
    let re = new RegExp(`(?<![a-z0-9+#.])${body}(?![a-z0-9+#]|\\.[a-z])`, 'gi');
    if (a === 'go') re = /(?<![a-z0-9])(?:golang|go(?=\s*(?:,|\/|\)|lang|\s+(?:and|or|developer|engineer|services|backend|programming|experience))))(?![a-z])/gi;
    if (a === 'rest') re = /(?<![a-z])rest(?:ful)?(?=\s*(?:ful|api|apis|services|endpoints|\/|,|\s+and\s+graphql))/gi;
    if (a === 'apis') re = /(?<![a-z])(?:building|design(?:ing)?|develop(?:ing)?|integrat(?:e|ing))\s+(?:\w+\s+){0,2}apis\b/gi;
    if (a === 'java') re = /(?<![a-z])java(?!\s*script)(?![a-z])/gi;
    if (a === 'spring') re = /(?<![a-z])spring(?:\s+boot|\s+framework)(?![a-z])/gi;
    if (a === 'swift') re = /(?<![a-z])swift(?:ui)?(?=\s*(?:,|\/|\)|and|or|developer|engineer|ios))/gi;
    if (a === 'rust') re = /(?<![a-z])rust(?=\s*(?:,|\/|\)|and|or|developer|engineer|programming|experience|\.))/gi;
    if (a === 'render') re = /(?!x)x/g; // too generic to detect
    if (a === 'containers') re = /(?<![a-z])containers?(?=\s*(?:and|,|\/|orchestration))/gi;
    if (a === 'neon') re = /(?<![a-z])neon(?:db)?(?=\s*(?:,|\/|postgres|database))/gi;
    if (a === 'rag') re = /(?<![a-z])RAG(?![a-z])/g; // case-sensitive
    if (a === 'claude') re = /(?<![a-z])claude(?=\s*(?:,|\/|api|code|and))/gi;
    if (a === 'mentor') re = /(?<![a-z])mentor(?:ing|ship)?\s+(?:junior|other|engineers|developers|team)/gi;
    if (a === 'kanban') re = /(?<![a-z])kanban(?![a-z])/gi;
    if (a === 'sso') re = /(?<![a-z])SSO(?![a-z])/g;
    if (a === 's3') re = /(?<![a-z0-9])S3(?![a-z0-9])/g;
    if (a === 'ts') re = /(?<![a-z])TS(?![a-z])/g;
    if (a === 'js') re = /(?<![a-z.])JS(?![a-z])/g;
    void AMBIGUOUS;
    return { key: s.key, re };
  }),
);

/** Return canonical skill keys mentioned in a text with counts. */
export function detectSkills(text: string): Map<string, number> {
  const out = new Map<string, number>();
  if (!text) return out;
  for (const m of MATCHERS) {
    m.re.lastIndex = 0;
    const hits = text.match(m.re);
    if (hits?.length) out.set(m.key, (out.get(m.key) ?? 0) + hits.length);
  }
  // Implications: Next.js implies React, Nuxt implies Vue, Express implies Node.
  if (out.has('nextjs') && !out.has('react')) out.set('react', 1);
  if (out.has('nuxt') && !out.has('vue')) out.set('vue', 1);
  return out;
}

export function labelOf(key: string) { return BY_KEY.get(key)?.label ?? key; }
