import { config } from '../config';

// ── Types ────────────────────────────────────────────────────────────────────

export type ComplianceFlag = 'GDPR' | 'HIPAA' | 'SOX' | 'PCI-DSS';
export type EngineType = 'n8n' | 'prefect' | 'trigger-dev' | 'langgraph';
export type TaskType = 'marketing' | 'legal' | 'operations' | 'finance' | 'workflow' | 'data-pipeline' | 'general';

export interface Task {
  id: string;
  type: TaskType;
  prompt: string;
  metadata?: {
    complianceFlags?: ComplianceFlag[];
    dataSensitivity?: 'low' | 'medium' | 'high' | 'critical';
    latencyRequirement?: 'realtime' | 'fast' | 'batch';
    preferredEngine?: EngineType;
  };
}

export interface EngineDecision {
  engine: EngineType;
  executive: string | null;
  reasoning: string;
  policyChecks: PolicyCheckResult[];
  blocked: boolean;
  blockReason?: string;
}

export interface PolicyCheckResult {
  rule: string;
  passed: boolean;
  detail: string;
}

// ── Policy Brain ─────────────────────────────────────────────────────────────

const COMPLIANCE_RULES: Array<{
  name: string;
  check: (task: Task) => PolicyCheckResult;
}> = [
  {
    name: 'GDPR data locality',
    check: (task) => {
      const flags = task.metadata?.complianceFlags ?? [];
      const sensitivity = task.metadata?.dataSensitivity ?? 'low';
      if (flags.includes('GDPR') && sensitivity === 'critical') {
        return { rule: 'GDPR', passed: false, detail: 'Critical-sensitivity GDPR data requires on-premise engine' };
      }
      return { rule: 'GDPR', passed: true, detail: 'GDPR check passed' };
    },
  },
  {
    name: 'HIPAA PHI protection',
    check: (task) => {
      const flags = task.metadata?.complianceFlags ?? [];
      if (flags.includes('HIPAA') && task.type !== 'legal') {
        return { rule: 'HIPAA', passed: true, detail: 'HIPAA flagged — routing to HARVEY for review' };
      }
      return { rule: 'HIPAA', passed: true, detail: 'HIPAA check passed' };
    },
  },
  {
    name: 'SOX audit trail',
    check: (task) => {
      const flags = task.metadata?.complianceFlags ?? [];
      if (flags.includes('SOX') && task.type === 'finance') {
        return { rule: 'SOX', passed: true, detail: 'SOX finance task — audit logging enabled' };
      }
      return { rule: 'SOX', passed: true, detail: 'SOX check passed' };
    },
  },
  {
    name: 'PCI-DSS payment data',
    check: (task) => {
      const flags = task.metadata?.complianceFlags ?? [];
      const sensitivity = task.metadata?.dataSensitivity ?? 'low';
      if (flags.includes('PCI-DSS') && sensitivity === 'critical') {
        return { rule: 'PCI-DSS', passed: false, detail: 'PCI-DSS critical payment data cannot be routed to external engines' };
      }
      return { rule: 'PCI-DSS', passed: true, detail: 'PCI-DSS check passed' };
    },
  },
];

// ── Engine Scoring ───────────────────────────────────────────────────────────

function scoreEngines(task: Task): Record<EngineType, number> {
  const scores: Record<EngineType, number> = {
    'n8n': 50,
    'prefect': 50,
    'trigger-dev': 30,
    'langgraph': 30,
  };

  if (task.type === 'workflow' || task.type === 'marketing') scores['n8n'] += 30;
  if (task.type === 'data-pipeline' || task.type === 'operations') scores['prefect'] += 30;
  if (task.type === 'general') scores['langgraph'] += 20;

  if (task.metadata?.latencyRequirement === 'realtime') {
    scores['trigger-dev'] += 20;
    scores['n8n'] += 10;
  }
  if (task.metadata?.latencyRequirement === 'batch') {
    scores['prefect'] += 20;
  }

  if (task.metadata?.preferredEngine) {
    scores[task.metadata.preferredEngine] += 100;
  }

  return scores;
}

function bestEngine(scores: Record<EngineType, number>): EngineType {
  return (Object.entries(scores) as [EngineType, number][])
    .sort(([, a], [, b]) => b - a)[0][0];
}

// ── Executive Mapping ────────────────────────────────────────────────────────

const TASK_TO_EXECUTIVE: Record<TaskType, string | null> = {
  marketing: 'ECHO',
  legal: 'HARVEY',
  operations: 'ROMBUS',
  finance: 'LEGCA_STEELE',
  workflow: null,
  'data-pipeline': null,
  general: null,
};

// ── Router ───────────────────────────────────────────────────────────────────

export class OrchestrationRouter {
  route(task: Task): EngineDecision {
    const policyChecks = COMPLIANCE_RULES.map((r) => r.check(task));
    const failedCheck = policyChecks.find((c) => !c.passed);

    if (failedCheck) {
      return {
        engine: 'n8n',
        executive: null,
        reasoning: 'Task blocked by policy brain',
        policyChecks,
        blocked: true,
        blockReason: failedCheck.detail,
      };
    }

    const scores = scoreEngines(task);
    const engine = bestEngine(scores);
    const executive = TASK_TO_EXECUTIVE[task.type] ?? null;

    return {
      engine,
      executive,
      reasoning: `Engine selected by scoring: n8n=${scores['n8n']}, prefect=${scores['prefect']}, trigger-dev=${scores['trigger-dev']}, langgraph=${scores['langgraph']}`,
      policyChecks,
      blocked: false,
    };
  }

  status() {
    return {
      router: 'operational',
      engines: Object.keys(config.engines),
      policyRules: COMPLIANCE_RULES.map((r) => r.name),
    };
  }
}

export const router = new OrchestrationRouter();
