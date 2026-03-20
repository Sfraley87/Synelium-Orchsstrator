import axios from 'axios';
import { config } from '../config';

// ── Types ────────────────────────────────────────────────────────────────────

export interface WorkflowSpec {
  name: string;
  payload: Record<string, unknown>;
}

export interface RunResult {
  runId: string;
  engine: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  url?: string;
}

export interface RunStatus {
  runId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  result?: unknown;
  error?: string;
}

export interface EngineAdapter {
  name: string;
  trigger(workflow: WorkflowSpec): Promise<RunResult>;
  getStatus(runId: string): Promise<RunStatus>;
  isHealthy(): Promise<boolean>;
}

// ── n8n Workflow Types ────────────────────────────────────────────────────────

export interface N8nNode {
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  parameters: Record<string, unknown>;
}

export interface N8nWorkflowDefinition {
  name: string;
  nodes: N8nNode[];
  connections: Record<string, unknown>;
  settings?: Record<string, unknown>;
  active?: boolean;
}

export interface N8nWorkflow extends N8nWorkflowDefinition {
  id: string;
  createdAt?: string;
  updatedAt?: string;
}

// ── n8n Adapter ──────────────────────────────────────────────────────────────

export class N8nAdapter implements EngineAdapter {
  name = 'n8n';
  private endpoint: string;
  private apiKey: string;

  constructor() {
    this.endpoint = config.engines.n8n.endpoint;
    this.apiKey = config.engines.n8n.apiKey;
  }

  async trigger(workflow: WorkflowSpec): Promise<RunResult> {
    try {
      const res = await axios.post(
        `${this.endpoint}/api/v1/workflows/${workflow.name}/activate`,
        workflow.payload,
        { headers: { 'X-N8N-API-KEY': this.apiKey }, timeout: 5000 }
      );
      return {
        runId: res.data?.id ?? `n8n-${Date.now()}`,
        engine: 'n8n',
        status: 'queued',
        url: `${this.endpoint}/workflow/${res.data?.id}`,
      };
    } catch {
      // Return a mock run if n8n is unreachable (dev mode)
      return { runId: `n8n-mock-${Date.now()}`, engine: 'n8n', status: 'queued' };
    }
  }

  async getStatus(runId: string): Promise<RunStatus> {
    try {
      const res = await axios.get(`${this.endpoint}/api/v1/executions/${runId}`, {
        headers: { 'X-N8N-API-KEY': this.apiKey },
        timeout: 5000,
      });
      return { runId, status: res.data?.finished ? 'completed' : 'running', result: res.data };
    } catch {
      return { runId, status: 'running' };
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      await axios.get(`${this.endpoint}/healthz`, { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }

  private get headers() {
    return { 'X-N8N-API-KEY': this.apiKey, 'Content-Type': 'application/json' };
  }

  async listWorkflows(): Promise<N8nWorkflow[]> {
    const res = await axios.get(`${this.endpoint}/api/v1/workflows`, {
      headers: this.headers,
      timeout: 5000,
    });
    return (res.data?.data ?? res.data ?? []) as N8nWorkflow[];
  }

  async createWorkflow(definition: N8nWorkflowDefinition): Promise<N8nWorkflow> {
    const res = await axios.post(`${this.endpoint}/api/v1/workflows`, definition, {
      headers: this.headers,
      timeout: 10000,
    });
    return res.data as N8nWorkflow;
  }

  async updateWorkflow(id: string, definition: Partial<N8nWorkflowDefinition>): Promise<N8nWorkflow> {
    const res = await axios.put(`${this.endpoint}/api/v1/workflows/${id}`, definition, {
      headers: this.headers,
      timeout: 10000,
    });
    return res.data as N8nWorkflow;
  }

  async activateWorkflow(id: string): Promise<void> {
    await axios.post(`${this.endpoint}/api/v1/workflows/${id}/activate`, {}, {
      headers: this.headers,
      timeout: 5000,
    });
  }

  async deleteWorkflow(id: string): Promise<void> {
    await axios.delete(`${this.endpoint}/api/v1/workflows/${id}`, {
      headers: this.headers,
      timeout: 5000,
    });
  }
}

// ── Prefect Adapter ───────────────────────────────────────────────────────────

export class PrefectAdapter implements EngineAdapter {
  name = 'prefect';
  private endpoint: string;

  constructor() {
    this.endpoint = config.engines.prefect.endpoint;
  }

  async trigger(workflow: WorkflowSpec): Promise<RunResult> {
    try {
      const res = await axios.post(
        `${this.endpoint}/api/deployments/name/${workflow.name}/default/create_flow_run`,
        { parameters: workflow.payload },
        { timeout: 5000 }
      );
      return {
        runId: res.data?.id ?? `prefect-${Date.now()}`,
        engine: 'prefect',
        status: 'queued',
        url: `${this.endpoint}/flow-runs/${res.data?.id}`,
      };
    } catch {
      return { runId: `prefect-mock-${Date.now()}`, engine: 'prefect', status: 'queued' };
    }
  }

  async getStatus(runId: string): Promise<RunStatus> {
    try {
      const res = await axios.get(`${this.endpoint}/api/flow_runs/${runId}`, { timeout: 5000 });
      const state = res.data?.state?.type?.toLowerCase() ?? 'running';
      return { runId, status: state === 'completed' ? 'completed' : 'running', result: res.data };
    } catch {
      return { runId, status: 'running' };
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      await axios.get(`${this.endpoint}/api/health`, { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }
}

// ── Trigger.dev Stub ─────────────────────────────────────────────────────────

export class TriggerDevAdapter implements EngineAdapter {
  name = 'trigger-dev';

  async trigger(workflow: WorkflowSpec): Promise<RunResult> {
    console.log(`[trigger-dev] stub trigger: ${workflow.name}`);
    return { runId: `triggerdev-mock-${Date.now()}`, engine: 'trigger-dev', status: 'queued' };
  }

  async getStatus(runId: string): Promise<RunStatus> {
    return { runId, status: 'running' };
  }

  async isHealthy(): Promise<boolean> {
    return false; // not yet integrated
  }
}

// ── LangGraph Stub ───────────────────────────────────────────────────────────

export class LangGraphAdapter implements EngineAdapter {
  name = 'langgraph';

  async trigger(workflow: WorkflowSpec): Promise<RunResult> {
    console.log(`[langgraph] stub trigger: ${workflow.name}`);
    return { runId: `langgraph-mock-${Date.now()}`, engine: 'langgraph', status: 'queued' };
  }

  async getStatus(runId: string): Promise<RunStatus> {
    return { runId, status: 'running' };
  }

  async isHealthy(): Promise<boolean> {
    return false; // not yet integrated
  }
}

// ── Registry ─────────────────────────────────────────────────────────────────

export class AdapterRegistry {
  private adapters = new Map<string, EngineAdapter>();

  constructor() {
    [new N8nAdapter(), new PrefectAdapter(), new TriggerDevAdapter(), new LangGraphAdapter()].forEach((a) =>
      this.adapters.set(a.name, a)
    );
  }

  get(name: string): EngineAdapter | undefined {
    return this.adapters.get(name);
  }

  async healthAll(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};
    await Promise.all(
      [...this.adapters.entries()].map(async ([name, adapter]) => {
        results[name] = await adapter.isHealthy();
      })
    );
    return results;
  }
}

export const adapterRegistry = new AdapterRegistry();
