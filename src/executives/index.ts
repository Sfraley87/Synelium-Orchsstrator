import { OpenAI } from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { ragSystem, QueryResult } from '../rag';
import { config } from '../config';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ExecutiveTask {
  prompt: string;
  context?: string;
  useRag?: boolean;
}

export interface ExecutiveResult {
  executive: string;
  response: string;
  ragContext?: QueryResult;
  provider: 'openai' | 'anthropic' | 'stub';
}

// ── Base Executive ────────────────────────────────────────────────────────────

abstract class BaseExecutive {
  abstract name: string;
  abstract systemPrompt: string;
  abstract provider: 'openai' | 'anthropic';

  protected openai: OpenAI | null;
  protected anthropic: Anthropic | null;

  constructor() {
    this.openai = config.openai.apiKey ? new OpenAI({ apiKey: config.openai.apiKey }) : null;
    this.anthropic = config.anthropic.apiKey ? new Anthropic({ apiKey: config.anthropic.apiKey }) : null;
  }

  async handle(task: ExecutiveTask): Promise<ExecutiveResult> {
    let ragContext: QueryResult | undefined;

    if (task.useRag !== false) {
      try {
        ragContext = await ragSystem.query({ question: task.prompt, topK: 3 });
      } catch {
        // RAG unavailable — proceed without context
      }
    }

    const fullPrompt = ragContext?.context
      ? `Context from knowledge base:\n${ragContext.context}\n\nTask:\n${task.prompt}`
      : task.prompt;

    const response = await this.callLLM(fullPrompt);

    return { executive: this.name, response, ragContext, provider: this.provider };
  }

  protected abstract callLLM(prompt: string): Promise<string>;
}

// ── ECHO — Marketing Executive ────────────────────────────────────────────────

export class EchoExecutive extends BaseExecutive {
  name = 'ECHO';
  provider = 'openai' as const;
  systemPrompt = `You are ECHO, the AI Marketing Executive for Synelium.
You specialize in campaign strategy, copywriting, brand messaging, audience analysis, and growth marketing.
Be concise, creative, and data-driven. Always align recommendations with business goals.`;

  protected async callLLM(prompt: string): Promise<string> {
    if (!this.openai) return '[ECHO] OpenAI API key not configured.';
    const res = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: this.systemPrompt },
        { role: 'user', content: prompt },
      ],
      max_tokens: 1000,
    });
    return res.choices[0]?.message?.content ?? '[ECHO] No response generated.';
  }
}

// ── HARVEY — Legal & Compliance Executive ────────────────────────────────────

export class HarveyExecutive extends BaseExecutive {
  name = 'HARVEY';
  provider = 'anthropic' as const;
  systemPrompt = `You are HARVEY, the AI Legal & Compliance Executive for Synelium.
You specialize in contract analysis, GDPR/HIPAA/SOX/PCI-DSS compliance, regulatory risk assessment, and legal strategy.
Be precise, thorough, and risk-aware. Always note limitations and recommend human legal review for binding decisions.`;

  protected async callLLM(prompt: string): Promise<string> {
    if (!this.anthropic) return '[HARVEY] Anthropic API key not configured.';
    const res = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system: this.systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    });
    const block = res.content[0];
    return block.type === 'text' ? block.text : '[HARVEY] No response generated.';
  }
}

// ── ROMBUS — Operations (stub) ────────────────────────────────────────────────

export class RombusExecutive {
  name = 'ROMBUS';
  async handle(_task: ExecutiveTask): Promise<ExecutiveResult> {
    return { executive: 'ROMBUS', response: 'ROMBUS (Operations) is coming soon.', provider: 'stub' };
  }
}

// ── LEGCA STEELE — Finance (stub) ─────────────────────────────────────────────

export class LegcaSteeleExecutive {
  name = 'LEGCA_STEELE';
  async handle(_task: ExecutiveTask): Promise<ExecutiveResult> {
    return { executive: 'LEGCA_STEELE', response: 'LEGCA STEELE (Finance) is coming soon.', provider: 'stub' };
  }
}

// ── Registry ─────────────────────────────────────────────────────────────────

type AnyExecutive = { name: string; handle(task: ExecutiveTask): Promise<ExecutiveResult> };

export class ExecutiveRegistry {
  private executives = new Map<string, AnyExecutive>();

  constructor() {
    [new EchoExecutive(), new HarveyExecutive(), new RombusExecutive(), new LegcaSteeleExecutive()].forEach((e) =>
      this.executives.set(e.name.toUpperCase(), e)
    );
  }

  get(name: string): AnyExecutive | undefined {
    return this.executives.get(name.toUpperCase());
  }

  list(): string[] {
    return [...this.executives.keys()];
  }
}

export const executiveRegistry = new ExecutiveRegistry();
