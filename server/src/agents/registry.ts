import type { AgentDefinition } from './core/types.js';
import { applicationExecutionAgent } from './application-execution.js';
import { applicationResearchAgent } from './application-research.js';
import { companyResearchAgent } from './company-research.js';
import { coverLetterAgent } from './cover-letter.js';
import { cvGenerationAgent } from './cv-generation.js';
import { jdExtractionAgent } from './jd-extraction.js';
import { jobDiscoveryAgent } from './job-discovery.js';
import { notificationAgent } from './notification.js';
import { profileIntelligenceAgent } from './profile-intelligence.js';
import { salaryAnalysisAgent } from './salary-analysis.js';
import { skillGapAgent } from './skill-gap.js';
import { skillMatchingAgent } from './skill-matching.js';
import { trackingAgent } from './tracking.js';

/**
 * Agent registry. Adding an agent = write a defineAgent() module and add it here; workflows reference agents
 * by name, so models (AGENT_MODEL_<NAME>) and implementations can be swapped without touching the orchestrator.
 */
const AGENTS = new Map<string, AgentDefinition>();
export function registerAgent(a: AgentDefinition) {
  if (AGENTS.has(a.name)) throw new Error(`Duplicate agent ${a.name}`);
  AGENTS.set(a.name, a);
}
for (const a of [
  profileIntelligenceAgent, jobDiscoveryAgent, jdExtractionAgent, companyResearchAgent, applicationResearchAgent,
  salaryAnalysisAgent, skillMatchingAgent, cvGenerationAgent, coverLetterAgent, skillGapAgent,
  applicationExecutionAgent, notificationAgent, trackingAgent,
] as AgentDefinition[]) registerAgent(a);

export const getAgent = (name: string) => AGENTS.get(name);
export const listAgents = () => [...AGENTS.values()].map((a) => ({
  name: a.name, version: a.version, description: a.description, modelClass: a.modelClass, usesAi: !!a.modelClass,
  tools: a.tools, dependsOn: a.dependsOn, retry: a.retry, timeoutMs: a.timeoutMs,
}));
