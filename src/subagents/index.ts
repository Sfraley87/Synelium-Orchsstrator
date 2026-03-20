import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { adapterRegistry, N8nAdapter, N8nWorkflow } from '../adapters';

/** Strip ```json ... ``` or ``` ... ``` fences Claude sometimes wraps around JSON */
function stripJsonFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface WorkflowRequest {
  executive: string;
  decision: string;       // what was decided
  context?: string;       // conversation context
  orgName?: string;
}

export interface WorkflowPlan {
  executive: string;
  department: string;
  decision: string;
  workflowType: string;
  steps: WorkflowStep[];
  saasSpec: SaaSSpec;
  n8nWorkflow?: N8nWorkflow;   // set when the workflow was pushed to n8n
  error?: string;              // set when something failed along the way
}

export interface WorkflowStep {
  order: number;
  name: string;
  description: string;
  owner: string;
  tooling?: string;
  automated: boolean;
}

export interface SaaSSpec {
  name: string;
  description: string;
  features: string[];
  dataModels: string[];
  integrations: string[];
  deploymentNotes: string;
}

// ── Sub-Agent Base ────────────────────────────────────────────────────────────

abstract class DepartmentSubAgent {
  abstract executive: string;
  abstract department: string;
  abstract agentPrompt: string;

  protected get anthropic(): Anthropic | null {
    return config.anthropic.apiKey ? new Anthropic({ apiKey: config.anthropic.apiKey }) : null;
  }

  async buildWorkflow(req: WorkflowRequest): Promise<WorkflowPlan & { error?: string }> {
    const client = this.anthropic;
    if (!client) {
      return { ...this.stubPlan(req), error: 'No Anthropic API key configured — returned stub plan.' };
    }

    const prompt = `You are a ${this.department} workflow architect sub-agent reporting to ${this.executive}.

A decision has been made: "${req.decision}"
${req.context ? `\nContext:\n${req.context}` : ''}
${req.orgName ? `\nOrganization: ${req.orgName}` : ''}

Design a production-ready workflow and mini SaaS spec for this decision.

Respond with a JSON object matching this exact structure:
{
  "workflowType": "string (e.g. campaign-launch, compliance-audit, ops-process, financial-model)",
  "steps": [
    {
      "order": 1,
      "name": "Step name",
      "description": "What happens",
      "owner": "who/what does this",
      "tooling": "tool or platform",
      "automated": true
    }
  ],
  "saasSpec": {
    "name": "App name",
    "description": "One line description",
    "features": ["feature 1", "feature 2"],
    "dataModels": ["Model: fields"],
    "integrations": ["integration 1"],
    "deploymentNotes": "Railway/Docker deployment notes"
  }
}

Return only valid JSON, no markdown, no explanation.`;

    const res = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    if (res.stop_reason === 'max_tokens') {
      throw new Error('Workflow plan response was truncated. Try a simpler workflow description.');
    }
    const raw = res.content[0]?.type === 'text' ? res.content[0].text : '{}';
    const text = stripJsonFences(raw);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Claude returned invalid JSON for workflow plan. Raw: ${text.slice(0, 200)}`);
    }

    const plan: WorkflowPlan = {
      executive: req.executive,
      department: this.department,
      decision: req.decision,
      workflowType: parsed.workflowType ?? 'custom',
      steps: parsed.steps ?? [],
      saasSpec: parsed.saasSpec ?? { name: '', description: '', features: [], dataModels: [], integrations: [], deploymentNotes: '' },
    };

    // Attempt to generate and push a real n8n workflow
    const { workflow: n8nWorkflow, error: n8nError } = await this.pushToN8n(client, plan, req);
    if (n8nWorkflow) plan.n8nWorkflow = n8nWorkflow;

    return n8nError ? { ...plan, error: n8nError } : plan;
  }

  private async pushToN8n(
    client: Anthropic,
    plan: WorkflowPlan,
    req: WorkflowRequest
  ): Promise<{ workflow: N8nWorkflow | null; error?: string }> {
    const adapter = adapterRegistry.get('n8n');
    if (!(adapter instanceof N8nAdapter)) {
      return { workflow: null, error: 'n8n adapter not registered.' };
    }

    const healthy = await adapter.isHealthy().catch(() => false);
    if (!healthy) {
      return { workflow: null, error: `n8n is unreachable. Check N8N_ENDPOINT and that n8n is running.` };
    }

    const n8nPrompt = `You are an n8n workflow JSON generator.

Based on this workflow plan, generate a valid n8n workflow JSON object.

Decision: "${req.decision}"
Department: ${plan.department}
Steps:
${plan.steps.map((s) => `${s.order}. ${s.name} — ${s.description} (tooling: ${s.tooling ?? 'n/a'}, automated: ${s.automated})`).join('\n')}
Integrations: ${plan.saasSpec.integrations.join(', ') || 'none'}

Generate a complete n8n workflow with:
- A descriptive "name"
- Realistic nodes using n8n node types (e.g. n8n-nodes-base.httpRequest, n8n-nodes-base.slack, n8n-nodes-base.gmail, n8n-nodes-base.googleSheets, n8n-nodes-base.webhook, etc.)
- Proper "connections" wiring the nodes in order
- Each node must have: id (uuid-style), name, type, typeVersion (1), position ([x,y] spaced 200px apart), parameters

Return only valid JSON matching this structure:
{
  "name": "...",
  "nodes": [...],
  "connections": {...},
  "settings": { "executionOrder": "v1" },
  "active": false
}

Return only valid JSON, no markdown, no explanation.`;

    const res = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [{ role: 'user', content: n8nPrompt }],
    });

    if (res.stop_reason === 'max_tokens') {
      return { workflow: null, error: 'n8n workflow JSON was truncated (too large). Workflow plan was saved but not pushed to n8n.' };
    }
    const raw = res.content[0]?.type === 'text' ? res.content[0].text : '{}';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let definition: any;
    try {
      definition = JSON.parse(stripJsonFences(raw));
    } catch {
      return { workflow: null, error: `Claude returned invalid JSON for n8n workflow. Raw snippet: ${raw.slice(0, 200)}` };
    }
    const created = await adapter.createWorkflow(definition);
    return { workflow: created };
  }

  private stubPlan(req: WorkflowRequest): WorkflowPlan {
    return {
      executive: req.executive,
      department: this.department,
      decision: req.decision,
      workflowType: 'custom',
      steps: [
        { order: 1, name: 'Define requirements', description: 'Gather specs', owner: 'Team', automated: false },
        { order: 2, name: 'Build & deploy', description: 'Implement solution', owner: 'Engineering', automated: true },
      ],
      saasSpec: {
        name: `${this.department} Solution`,
        description: 'Auto-generated workflow',
        features: ['Core workflow', 'Dashboard', 'Reporting'],
        dataModels: [],
        integrations: [],
        deploymentNotes: 'Deploy via Railway',
      },
    };
  }
}

// ── Marketing Sub-Agent (ECHO's dept) ────────────────────────────────────────

class MarketingSubAgent extends DepartmentSubAgent {
  executive = 'ECHO';
  department = 'Marketing';
  agentPrompt = 'Campaign builder, content workflow, audience segmentation, analytics pipeline';
}

// ── Legal Sub-Agent (HARVEY's dept) ──────────────────────────────────────────

class LegalSubAgent extends DepartmentSubAgent {
  executive = 'HARVEY';
  department = 'Legal & Compliance';
  agentPrompt = 'Contract workflow, compliance checklist, audit trail, policy management';
}

// ── Operations Sub-Agent (ROMBUS's dept) ─────────────────────────────────────

class OperationsSubAgent extends DepartmentSubAgent {
  executive = 'ROMBUS';
  department = 'Operations';
  agentPrompt = 'Process automation, SLA tracking, incident management, ops dashboard';
}

// ── Finance Sub-Agent (LEGCA_STEELE's dept) ───────────────────────────────────

class FinanceSubAgent extends DepartmentSubAgent {
  executive = 'LEGCA_STEELE';
  department = 'Finance';
  agentPrompt = 'Financial model, budget tracker, ROI calculator, reporting pipeline';
}

// ── Registry ─────────────────────────────────────────────────────────────────

class SubAgentRegistry {
  private agents = new Map<string, DepartmentSubAgent>();

  constructor() {
    [
      new MarketingSubAgent(),
      new LegalSubAgent(),
      new OperationsSubAgent(),
      new FinanceSubAgent(),
    ].forEach((a) => this.agents.set(a.executive.toUpperCase(), a));
  }

  getByExecutive(executiveName: string): DepartmentSubAgent | undefined {
    return this.agents.get(executiveName.toUpperCase());
  }

  list(): Array<{ executive: string; department: string }> {
    return [...this.agents.values()].map((a) => ({ executive: a.executive, department: a.department }));
  }
}

export const subAgentRegistry = new SubAgentRegistry();
