import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { adapterRegistry, N8nAdapter, N8nWorkflow } from '../adapters';

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

  async buildWorkflow(req: WorkflowRequest): Promise<WorkflowPlan> {
    const client = this.anthropic;
    if (!client) {
      return this.stubPlan(req);
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

    try {
      const res = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = res.content[0]?.type === 'text' ? res.content[0].text : '{}';
      const parsed = JSON.parse(text);

      const plan: WorkflowPlan = {
        executive: req.executive,
        department: this.department,
        decision: req.decision,
        workflowType: parsed.workflowType ?? 'custom',
        steps: parsed.steps ?? [],
        saasSpec: parsed.saasSpec ?? { name: '', description: '', features: [], dataModels: [], integrations: [], deploymentNotes: '' },
      };

      // Attempt to generate and push a real n8n workflow
      const n8nWorkflow = await this.pushToN8n(client, plan, req);
      if (n8nWorkflow) plan.n8nWorkflow = n8nWorkflow;

      return plan;
    } catch {
      return this.stubPlan(req);
    }
  }

  private async pushToN8n(client: Anthropic, plan: WorkflowPlan, req: WorkflowRequest): Promise<N8nWorkflow | null> {
    const adapter = adapterRegistry.get('n8n');
    if (!(adapter instanceof N8nAdapter)) return null;

    const healthy = await adapter.isHealthy().catch(() => false);
    if (!healthy) return null;

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
}`;

    try {
      const res = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 3000,
        messages: [{ role: 'user', content: n8nPrompt }],
      });

      const text = res.content[0]?.type === 'text' ? res.content[0].text : '{}';
      const definition = JSON.parse(text);
      const created = await adapter.createWorkflow(definition);
      return created;
    } catch {
      return null;
    }
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
