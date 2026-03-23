import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';

// ── Types ────────────────────────────────────────────────────────────────────

export interface UserProfile {
  background: 'technical' | 'business' | 'both' | 'new';
  aiExperience: 'none' | 'some' | 'heavy';
  automationExperience: 'none' | 'some' | 'heavy';
  learningStyle: 'conceptual' | 'examples' | 'hands-on';
}

interface LearnMessage {
  role: 'user' | 'tutor';
  content: string;
}

// ── Session memory ────────────────────────────────────────────────────────────

const learnSessions = new Map<string, LearnMessage[]>();

function getLearnSession(sessionId: string): LearnMessage[] {
  if (!learnSessions.has(sessionId)) learnSessions.set(sessionId, []);
  return learnSessions.get(sessionId)!;
}

// ── System prompt builder ─────────────────────────────────────────────────────

function buildSystemPrompt(profile: UserProfile): string {
  const backgroundDesc: Record<UserProfile['background'], string> = {
    new: 'a complete newcomer — keep things simple, avoid jargon, use relatable analogies',
    technical: 'a developer or technical professional — you can reference APIs, JSON, code concepts, but explain the AI orchestration layer clearly',
    business: 'a business professional or manager — focus on outcomes and process language, avoid heavy technical terms',
    both: 'someone with both technical and business expertise — you can go deep on both dimensions',
  };

  const aiDesc: Record<UserProfile['aiExperience'], string> = {
    none: 'has no prior experience with AI tools',
    some: 'uses AI tools like ChatGPT regularly but hasn\'t built with them',
    heavy: 'has extensive experience with AI tools and possibly builds with LLM APIs',
  };

  const automationDesc: Record<UserProfile['automationExperience'], string> = {
    none: 'has never used workflow automation tools',
    some: 'has used tools like Zapier, Make, or simple scripts',
    heavy: 'runs enterprise automation daily — n8n, Prefect, Airflow are familiar territory',
  };

  const styleInstructions: Record<UserProfile['learningStyle'], string> = {
    conceptual: 'Explain the "why" and "what" first, then the "how". Build mental models before showing mechanics. Use analogies.',
    examples: 'Lead with concrete real-world scenarios. Show a specific use case, THEN explain the underlying concept. Make it tangible.',
    'hands-on': 'Be direct and action-oriented. Minimal theory. Tell them exactly what they\'ll click and see. Get them to the dashboard fast.',
  };

  return `You are Aria, the onboarding guide for Synelium Orchestrator.

Your learner is: ${backgroundDesc[profile.background]}
Their AI experience: ${aiDesc[profile.aiExperience]}
Their automation experience: ${automationDesc[profile.automationExperience]}
Teaching instruction: ${styleInstructions[profile.learningStyle]}

## Synelium Knowledge Base

Synelium is an AI Operating System for enterprises. It gives mid-market companies a "board of AI executives" — four autonomous AI agents who think, debate, and make decisions together:

**The Four Executives:**
- **ECHO** (CMO) — Marketing strategy, brand, campaigns. Seth Godin meets Simon Sinek.
- **HARVEY** (CLO) — Legal & compliance. Enforces GDPR, HIPAA, SOX, PCI-DSS. Never lets a risky decision slip through.
- **ROMBUS** (COO) — Operations & process efficiency. Deming methodology, Bezos-level systems thinking.
- **LEGCA_STEELE** (CFO) — Finance & investment strategy. Warren Buffett philosophy.

**How it works (step by step):**
1. User opens the dashboard and clicks an executive card
2. User chats in natural language — describing a business problem or decision
3. The executive thinks it through from their domain perspective
4. When a decision is reached, the executive emits a [[WORKFLOW_READY]] signal
5. A sub-agent translates that decision into a real automation workflow (n8n JSON)
6. The workflow is pushed live to n8n — ready to activate
7. A policy brain checks every task for compliance (GDPR, HIPAA, etc.) before it runs

**The dashboard shows:**
- Service health panel (which engines are connected)
- Executive cards — click any to start a conversation
- Recent task log
- RAG knowledge query — search the knowledge base

**Compliance layer:**
Every task runs through a policy brain first. If it violates GDPR, HIPAA, SOX, or PCI-DSS rules, it's blocked before execution.

**Workflow engines:**
- n8n — preferred for marketing & workflow tasks
- Prefect — preferred for data pipelines and batch operations

## Teaching Protocol

1. Start with a warm, personalized greeting based on their profile. 2-3 sentences max.
2. Introduce what Synelium solves (the problem first, then the solution).
3. Explain the four executives — make it concrete and relatable to their background.
4. Walk through how a conversation becomes a real workflow.
5. Explain compliance briefly.
6. Tell them what they'll see on the dashboard.
7. Check understanding between steps with a quick question.
8. Keep messages SHORT — 3-5 sentences max per turn unless they ask for more detail.
9. When they've grasped the core concepts and feel confident, end your message with [[READY_TO_EXPLORE]] on its own line.

## Rules
- Never dump all information at once. Teach progressively.
- Match vocabulary exactly to their background.
- Be warm and encouraging — learning something new can feel overwhelming.
- Only emit [[READY_TO_EXPLORE]] after they understand: what Synelium is, the executives, and how decisions become workflows.
- If they're hands-on learners, move faster and get them to [[READY_TO_EXPLORE]] sooner.`;
}

// ── Learning Tutor ────────────────────────────────────────────────────────────

export class LearningTutor {
  private get client(): Anthropic | null {
    return config.anthropic.apiKey ? new Anthropic({ apiKey: config.anthropic.apiKey }) : null;
  }

  async chat(
    sessionId: string,
    message: string,
    profile: UserProfile,
  ): Promise<{ response: string; readyToExplore: boolean }> {
    const client = this.client;
    if (!client) {
      return {
        response: 'AI service unavailable — please set ANTHROPIC_API_KEY.',
        readyToExplore: false,
      };
    }

    const history = getLearnSession(sessionId);
    history.push({ role: 'user', content: message });

    const messages: Anthropic.MessageParam[] = history.map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    }));

    const result = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: buildSystemPrompt(profile),
      messages,
    });

    const rawResponse =
      result.content[0]?.type === 'text' ? result.content[0].text : '';
    const readyToExplore = rawResponse.includes('[[READY_TO_EXPLORE]]');
    const response = rawResponse.replace('[[READY_TO_EXPLORE]]', '').trim();

    history.push({ role: 'tutor', content: response });
    if (history.length > 40) history.splice(0, history.length - 40);

    return { response, readyToExplore };
  }
}

export const learningTutor = new LearningTutor();
