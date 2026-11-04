import type { z } from 'zod';
import type { AiTask } from '../../ai/provider.js';
import type { ToolName, Tools } from './tools.js';

/** The contract every specialised agent implements. */
export interface AgentDefinition<I = any, O = any> {
  name: string;
  version: string;
  description: string;
  /** Which model class the agent uses; null = deterministic agent (no LLM). */
  modelClass: AiTask | null;
  /** The agent's own system instructions (only this agent ever sees them). */
  systemPrompt: string | null;
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  /** Allow-list: the agent can only call these tools. */
  tools: readonly ToolName[];
  /** Agents whose outputs this agent consumes (documentation + workflow validation). */
  dependsOn: readonly string[];
  retry: { attempts: number; backoffMs: number };
  timeoutMs: number;
  run(ctx: AgentContext, input: I): Promise<O>;
}

export interface AgentContext {
  userId: number;
  runId: number | null;
  taskId: number | null;
  agent: string;
  /** Scoped tool access — calling a tool outside the allow-list throws. */
  tools: Tools;
  /** LLM helpers bound to this agent's system prompt and model. Return null when AI is unavailable. */
  llm: {
    enabled: boolean;
    json<T>(schema: z.ZodType<T>, prompt: string, opts?: { maxTokens?: number }): Promise<T | null>;
    text(prompt: string, opts?: { maxTokens?: number; system?: string }): Promise<string | null>;
  };
  log(message: string, data?: unknown): void;
  /** Records which engine produced the result: 'rules', 'ai:<model>', or 'mixed'. */
  markEngine(engine: string): void;
}

export const defineAgent = <I, O>(a: AgentDefinition<I, O>) => a;
