# CareerPilot AI — Multi-Agent Architecture

## Principles

1. **One agent, one job.** Each agent has a single responsibility, its own system instructions, zod-validated input/output schemas, an allow-list of tools, a retry policy, and declared dependencies.
2. **AI reasons; services decide.** Agents use an LLM for extraction, research synthesis and writing. Database writes, duplicate detection, the 100-point score, eligibility gating, validation, FX conversion and DOCX/PDF export are **deterministic backend services**. That keeps scoring reproducible and makes fabrication impossible at the point where it would matter.
3. **No conversation passing.** Agents never see each other's prompts or chat history. The orchestrator gives each agent a small, typed input object built from upstream agents' **validated outputs stored in PostgreSQL** (`agent_tasks.output`, plus domain tables such as `job_extractions` and `job_research`).
4. **Every agent works without AI.** When no model is configured, or the provider fails, each agent falls back to its deterministic baseline and records `engine: "rules"` in its log.
5. **Swappable models.** Each agent resolves its model as `AGENT_MODEL_<AGENT>` → task-class model (`AI_MODEL_RESEARCH|SCORING|DOCUMENTS`) → `AI_MODEL`, with an `AI_FALLBACK_MODELS` chain. Providers (Gemini, OpenAI, OpenRouter, Anthropic, any OpenAI-compatible endpoint) sit behind one `LlmClient`.
6. **Pluggable.** To add an agent, write one file that exports an `AgentDefinition`, register it, and reference it in a workflow. No other code changes.

## Components

```
                         ┌──────────────────────────────┐
  API / Scheduler ─────► │   Main Orchestrator          │──► workflow_runs, agent_tasks (Postgres)
                         │  - workflow DAGs             │
                         │  - parallel step execution   │◄── Background worker (DB queue; BullMQ if REDIS_URL)
                         │  - retries / skip / fail     │
                         └──────────────┬───────────────┘
                 typed input            │            validated output
        ┌───────────────┬───────────────┼────────────────┬───────────────────┐
        ▼               ▼               ▼                ▼                   ▼
   Agents (LLM + allow-listed tools)                Deterministic services
   profile-intelligence, job-discovery,            scoring (100-pt), eligibility gate,
   jd-extraction, company-research,                dedupe/upsert, salary FX conversion,
   application-research, salary-analysis,          truthfulness guard, DOCX/PDF render,
   skill-matching, cv-generation,                  recheck/expiry, analytics
   cover-letter, skill-gap
```

## Agents

| # | Agent | Responsibility | Input → Output | Tools (allow-list) | Depends on |
|---|---|---|---|---|---|
| 1 | **profile-intelligence** | Turn raw evidence (portfolio, GitHub, CV text) into *suggested* profile updates with evidence. It never overwrites the master profile; you accept suggestions in the UI. | `{sources[]}` → `{skills[{key,proficiencyHint,evidence,sourceUrl}], projects[], flags[]}` | `http.fetchPublic`, `github.listRepos`, `profile.read` | — |
| 2 | **job-discovery** | Query every enabled source, filter for remote software roles, and hand candidates to the store service (which dedupes and upserts). No LLM is needed. | `{settings}` → `{perSource[{source,fetched,relevant,inserted,error}], newJobIds[]}` | `sources.*`, `store.upsertJob` | — |
| 3 | **jd-extraction** | Read the full description and extract structured requirements: required vs preferred skills (mapped to the taxonomy), years, seniority, responsibilities, location/eligibility statements, salary statements, application instructions. LLM output is checked: every claimed requirement must quote text that really appears in the description. | `{jobId,title,description}` → `JobExtraction` | `taxonomy.match`, `job.read` | — |
| 4 | **company-research** | Identify the real employer: official website, careers page, and short company facts, each quoted with its source URL. | `{jobId,company,listingUrl}` → `{website,careersPage,facts[{fact,sourceUrl,verified}]}` | `http.fetchPublic`, `company.lookupDomain`, `company.read/write` | — |
| 5 | **application-research** | Find and verify the real application destination (employer ATS posting, listing-page outbound links, ATS board search), whether it is still open, the apply method, any explicit apply email, real form questions, required documents, deadline, and step-by-step instructions. | `{jobId,…, website?}` → `ApplicationResearch` | `ats.searchBoards`, `ats.getQuestions`, `http.checkUrl`, `http.fetchPublic` | company-research (optional: uses its website for the careers page) |
| 6 | **salary-analysis** | Find the compensation statement (structured fields, then extraction statements, then LLM reading of ambiguous text), then call the deterministic FX service for an NGN estimate against your targets. | `{jobId, structuredSalary, salaryStatements[]}` → `SalaryAnalysis` | `fx.convert`, `settings.read` | jd-extraction |
| 7 | **skill-matching** | Match each requirement against the master profile: proficiency, professional vs project use, evidence, transferable skills. The LLM only judges non-taxonomy requirements (e.g. "built booking systems") against profile text and must cite the profile item. | `{requirements, profile}` → `{matches[]}` | `profile.read` | jd-extraction |
| — | *scoring service* | Deterministic 100-point score with configurable weights, the eligibility hard gate, and classification. | matches + eligibility + salary + freshness → `job_analyses` | — | skill-matching, salary-analysis, application-research |
| 8 | **cv-generation** | Build a tailored ATS CV from the master profile: choose and order skills, experience bullets and projects. The LLM may only rephrase the summary. The truthfulness guard rejects any added technology or number. | `{jobId, matches, extraction}` → `CvContent` (+ warnings) | `profile.read`, `guard.truthfulness`, `documents.save` | scoring |
| 9 | **cover-letter** | Write the cover letter, application email (addressed only to a verified email), short intro and screening answers (real ATS questions when available). Unknown facts become `[PLACEHOLDERS]`. | `{jobId, matches, research}` → `{coverLetter, email, answers}` | `profile.read`, `settings.read`, `guard.truthfulness`, `documents.save` | scoring, application-research |
| 10 | **skill-gap** | Aggregate requirements across relevant vacancies and rank a *short* learning list by demand, how many jobs a skill would unlock, and near-miss jobs. The LLM writes a brief rationale grounded in those numbers. | `{userId}` → `{have[], improve[], missing[], recommendations[]}` | `analytics.requirementStats`, `profile.read` | — |

## Workflows (DAGs run by the orchestrator)

**`vacancy-analysis`** (per job, background):

```
jd-extraction ─┬─► skill-matching ─┐
               └─► salary-analysis ─┼─► [scoring service]
company-research ─► application-research ┘
```

`jd-extraction` and `company-research` start together. `skill-matching` and `salary-analysis` then run in parallel once extraction finishes. `application-research` follows company research.

**`application-prep`** (per job, background): `vacancy-analysis` steps (reused when fresh) → **cv-generation ∥ cover-letter** → deterministic status update to *Ready to Apply*.

**`discovery`** (scheduled/manual): `job-discovery` → fan out `vacancy-analysis` for new jobs (bounded concurrency) → `skill-gap` refresh.

**`profile-refresh`** (manual): `profile-intelligence` → suggestions waiting for your review.

## How the orchestrator manages a run

1. Creates a `workflow_runs` row and one `agent_tasks` row per step (`pending`).
2. Repeatedly starts every step whose dependencies are `succeeded` (or `skipped`, when the dependency is optional), running them **in parallel** with `Promise.allSettled`.
3. For each step it builds the agent's input from upstream outputs, validates it against the agent's input schema, and runs the agent with its retry policy (exponential backoff). It then validates the output against the output schema; an invalid LLM output gets one repair attempt, after which the agent falls back to rules.
4. On final failure the step becomes `failed`. Steps that **require** it are marked `skipped` with the reason. Steps with optional dependencies continue. The run ends as `succeeded`, `partial` or `failed`.
5. Every attempt is logged in `agent_tasks` (input, output, error, attempt count, engine/model, tokens, duration) and every LLM call in `ai_usage` (cost and budget guard).
6. Runs execute in a background worker that claims `pending` runs from Postgres (`FOR UPDATE SKIP LOCKED`), or via BullMQ when `REDIS_URL` is set. The API responds immediately with a `runId` the UI can poll.

## Safety boundaries (enforced in code)

- Agents get only their allow-listed tools; no agent can submit applications, send email or create accounts. Those tools don't exist.
- Extraction claims must quote the source text. CV and letter output passes the truthfulness guard. Emails are used only when the listing explicitly asks applicants to email them.
- "Verified" flags are set only by tool results (an HTTP/ATS API confirmation), never by LLM text.

---

## Additions: automation, evidence, freshness, sender identities

### New agents
| Agent | Kind | Responsibility |
|---|---|---|
| `application-execution` | deterministic | Re-runs every policy check (`engine/policy.ts`). Email only to an address published in the listing, from the candidate's own verified identity; "submitted" only when Resend returns an id. Portal applications are never automated → handoff package ("Complete Your Application"). Unique index prevents duplicate submissions. |
| `notification` | deterministic | Emails/WhatsApps the owner for matches ≥ threshold, application outcomes and missing configuration. Channels independent, deduplicated, honest `not_configured` status. |
| `tracking` | deterministic | Application tier, automation status and per-application activity history (`application_events`). |

### Workflows (`agents/workflows.ts`)
- `opportunity`: recheck → (jd-extraction ∥ company-research) → application-research; skill-matching ∥ salary-analysis → scoring service → (cv ∥ cover letter, when score ≥ docs threshold) → documents + QA service → application-execution (priority tier, automatic runs only) → tracking → notification.
- `apply`: user-approved attempt for one job (all checks re-run).
- `discovery`: job-discovery → fan-out of `opportunity` for promising new jobs → skill-gap.
- `profile-refresh`: profile-intelligence → suggestions only.

### Professional evidence (`engine/evidence.ts`)
Every claim is stored with source and status (verified / user_confirmed / indicated / missing / conflicting).
`loadProfile()` returns the evidence-backed profile, so every agent and document uses only verified or user-confirmed claims. Conflicts use the conservative public version and are flagged until the user resolves them.

### QA gate (`docs/qa.ts`)
Run on every document. **Errors:** banned generic phrasing, technologies not in the evidence, figures not found in the evidence or listing, wrong titles, wrong contact email, missing company name. **Warnings:** repetition. **`submittable`** additionally requires no placeholders and no unresolved conflicts.

### Freshness (`engine/freshness.ts`)
The effective publication date is the employer's ATS date, else the earliest sighting across sources, so reposts aren't treated as new. `last_verified_open_at` is set only by a conclusive check. Jobs older than 30 days are excluded unless verified open within 48 hours.

### Email identities (`integrations/resend.ts`)
`notifications` (CareerPilot AI <notifications@…>, owner inbox only) and `job_application` (Alawiye Muritala Adeshina <me@…>, employers). They are validated independently against Resend's domain status before every send. There is never a fallback between them. Every attempt is logged in `email_log`.
