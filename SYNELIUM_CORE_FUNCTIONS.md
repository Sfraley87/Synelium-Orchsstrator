# Synelium Orchestrator — Core Functions Technical Reference

> **Purpose**: This document enables a receiving Claude Code instance to understand, integrate, and extend the Synelium Orchestrator backend. All function signatures, module contracts, data types, and execution flows are documented here.

---

## 1. Project Identity

| Property | Value |
|----------|-------|
| Language | TypeScript 5.3+ |
| Runtime | Node.js 20+ |
| Framework | Express 5 |
| Primary LLM | Claude Sonnet (`claude-sonnet-4-6`) |
| Vector DB | ChromaDB (primary) + pgvector (fallback) |
| Workflow Engines | n8n (prod), Prefect (prod), Trigger.dev (stub), LangGraph (stub) |
| Deployment | Railway (Nixpacks) |

---

## 2. Module Map

```
src/
├── index.ts          — Express app, API routes, server bootstrap
├── config.ts         — Environment config loader
├── router/
│   └── index.ts      — Policy brain, compliance rules, engine selection
├── executives/
│   └── index.ts      — AI executives (ECHO, HARVEY, ROMBUS, LEGCA_STEELE)
├── adapters/
│   └── index.ts      — Workflow engine adapters + AdapterRegistry
├── rag/
│   └── index.ts      — RAG system (ingest, query, ChromaDB/pgvector)
├── subagents/
│   └── index.ts      — Department sub-agents (plan + n8n JSON generation)
└── site-builder/
    └── index.ts      — Dashboard HTML generator
```

---

## 3. Configuration (`src/config.ts`)

```typescript
// Loaded via dotenv at startup
const config = {
  port: number,                        // default: 3000
  postgres: {
    host: string,
    port: number,
    database: string,
    user: string,
    password: string,
    connectionString: string,          // DATABASE_URL from Railway
  },
  chroma: {
    path: string,                      // default: 'http://localhost:8000'
  },
  openai: {
    apiKey: string,                    // OPENAI_API_KEY — required for embeddings
  },
  anthropic: {
    apiKey: string,                    // ANTHROPIC_API_KEY — required for Claude
  },
  engines: {
    n8n: { url: string; apiKey: string },
    prefect: { url: string },
    triggerDev: { url: string; apiKey: string },
    langGraph: { url: string; apiKey: string },
  },
};

export default config;
```

**Required environment variables**:
- `ANTHROPIC_API_KEY` — Claude API access
- `OPENAI_API_KEY` — Embeddings
- `DATABASE_URL` — PostgreSQL (Railway auto-injects)
- `N8N_URL`, `N8N_API_KEY` — n8n integration
- `PREFECT_URL` — Prefect integration

---

## 4. Router / Policy Brain (`src/router/index.ts`)

### Types

```typescript
type ComplianceFlag = 'GDPR' | 'HIPAA' | 'SOX' | 'PCI-DSS';
type EngineType    = 'n8n' | 'prefect' | 'trigger-dev' | 'langgraph';
type TaskType      = 'marketing' | 'legal' | 'operations' | 'finance'
                   | 'workflow' | 'data-pipeline' | 'general';

interface Task {
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

interface PolicyCheckResult {
  rule: string;
  passed: boolean;
  action: 'allow' | 'block' | 'flag' | 'log';
  message: string;
}

interface EngineDecision {
  engine: EngineType;
  executive: string | null;   // null = no executive assigned
  reasoning: string;
  policyChecks: PolicyCheckResult[];
  blocked: boolean;
  blockReason?: string;
}
```

### Class: `OrchestrationRouter`

```typescript
class OrchestrationRouter {
  // Route a task through the policy brain; returns engine + executive assignment
  route(task: Task): EngineDecision

  // Expose current rules and engine config (used by GET /router/status)
  getStatus(): { rules: string[]; engines: Record<string, unknown> }
}
```

### Policy Rules (hardcoded, in priority order)

| Rule | Trigger | Action |
|------|---------|--------|
| GDPR data locality | GDPR flag + critical sensitivity | **Block** n8n/prefect; require on-prem |
| HIPAA PHI protection | HIPAA flag | **Flag** for legal review |
| SOX audit trail | SOX flag + finance task | **Log** — enable audit mode |
| PCI-DSS payment isolation | PCI-DSS flag + critical sensitivity | **Block** external engines |

### Engine Scoring

Base scores: `n8n=50`, `prefect=50`, `trigger-dev=30`, `langgraph=30`

| Condition | Effect |
|-----------|--------|
| Task type = marketing/workflow | n8n +30 |
| Task type = data-pipeline | prefect +30 |
| Latency = realtime | trigger-dev +20 |
| Latency = batch | prefect +20 |
| `preferredEngine` set | that engine +100 |

### Executive Mapping

| Task Type | Executive |
|-----------|-----------|
| `marketing` | ECHO |
| `legal` | HARVEY |
| `operations` | ROMBUS |
| `finance` | LEGCA_STEELE |
| `workflow`, `data-pipeline`, `general` | `null` |

---

## 5. Executives (`src/executives/index.ts`)

### Types

```typescript
interface ExecutiveTask {
  prompt: string;
  context?: string;    // optional pre-fetched RAG context
  useRag?: boolean;    // default false for chat, true for /task route
  sessionId?: string;  // conversation session ID
}

interface ExecutiveResult {
  executive: string;
  role: string;
  response: string;
  ragContext?: QueryResult;  // included if useRag=true
}

interface BoardMessage {
  role: 'user' | 'assistant';
  executive?: string;
  content: string;
}
```

### Session Functions

```typescript
// Returns existing session or creates empty array
function getSession(sessionId: string): BoardMessage[]

// Appends message; trims to max 40 messages
function appendToSession(sessionId: string, message: BoardMessage): void

// Deletes session (used by DELETE /board/chat)
function clearSession(sessionId: string): void
```

### Abstract Base Class

```typescript
abstract class BaseExecutive {
  readonly name: string;
  readonly role: string;
  protected readonly systemPrompt: string;

  // Main entry point — handles a task, optionally with RAG
  async handle(task: ExecutiveTask): Promise<ExecutiveResult>

  // Contribute a round to a multi-executive board discussion
  async boardReply(
    topic: string,
    otherResponses: Array<{ executive: string; response: string }>
  ): Promise<string>

  // Raw Claude call — override model/token settings per executive
  protected async callClaude(
    messages: Anthropic.MessageParam[],
    maxTokens?: number
  ): Promise<string>
}
```

### The Four Executives

| Export Name | Role | Key Personas |
|-------------|------|-------------|
| `echo` | Chief Marketing Officer | Seth Godin, Simon Sinek, Byron Sharp, David Ogilvy |
| `harvey` | Chief Legal & Compliance Officer | Harvey Specter |
| `rombus` | Chief Operations Officer | Jeff Bezos, W. Edwards Deming, Goldratt, Andy Grove |
| `legcaSteele` | Chief Financial Officer | Warren Buffett, Charlie Munger, Graham, Peter Lynch |

### Executive Registry

```typescript
// Map used internally for route dispatch
const executiveMap: Record<string, BaseExecutive> = {
  ECHO: echo,
  HARVEY: harvey,
  ROMBUS: rombus,
  LEGCA_STEELE: legcaSteele,
};
```

### Workflow Signal Protocol

Executives signal readiness with an embedded token in their response:

```
[[WORKFLOW_READY: <one-sentence decision summary>]]
```

This is detected by `extractWorkflowSignal()` in `src/index.ts`:

```typescript
function extractWorkflowSignal(text: string): {
  clean: string;       // response with the signal token stripped
  decision: string | null;  // extracted decision text, or null
}
```

### Conversation Behavior Contract

All four executives follow this protocol — **important for prompt design**:

- **Direct command** (e.g., "create a workflow for X") → emit `[[WORKFLOW_READY: ...]]` immediately, no clarifying questions
- **Exploratory** (e.g., "should we expand to Y?") → ask 1-2 focused questions, present 2-3 options with trade-offs, then signal on alignment
- **Never** explain system internals, argue after a decision is made, or say "I can't deploy"

### Claude API Configuration per Executive

| Setting | Value |
|---------|-------|
| Model | `claude-sonnet-4-6` |
| Max tokens (standard) | 1500 |
| Max tokens (workflow planning, sub-agents) | 4096–8192 |
| History window | Last 40 messages (auto-truncated) |
| Session storage | In-memory `Map<string, BoardMessage[]>` |

---

## 6. Adapters (`src/adapters/index.ts`)

### Unified Interface

```typescript
interface EngineAdapter {
  name: string;
  trigger(workflow: WorkflowSpec): Promise<RunResult>;
  getStatus(runId: string): Promise<RunStatus>;
  isHealthy(): Promise<boolean>;
}

interface WorkflowSpec {
  name: string;
  payload: Record<string, unknown>;
}

interface RunResult {
  runId: string;
  engine: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  url?: string;
}

interface RunStatus {
  runId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  details?: Record<string, unknown>;
}
```

### n8n Adapter (Production-ready)

```typescript
class N8nAdapter implements EngineAdapter {
  // Workflow CRUD
  async listWorkflows(): Promise<N8nWorkflowDefinition[]>
  async createWorkflow(def: N8nWorkflowDefinition): Promise<{ id: string }>
  async updateWorkflow(id: string, def: Partial<N8nWorkflowDefinition>): Promise<void>
  async deleteWorkflow(id: string): Promise<void>
  async activateWorkflow(id: string): Promise<void>

  // EngineAdapter interface
  async trigger(workflow: WorkflowSpec): Promise<RunResult>
  async getStatus(runId: string): Promise<RunStatus>
  async isHealthy(): Promise<boolean>
}
```

**n8n Node Types used in generated workflows**:
- `n8n-nodes-base.httpRequest` — Generic HTTP calls
- `n8n-nodes-base.slack` — Slack notifications
- `n8n-nodes-base.emailSend` — Email sending
- `n8n-nodes-base.googleSheets` — Spreadsheet operations
- `n8n-nodes-base.postgres` — Database operations
- `n8n-nodes-base.if` — Conditional branching
- `n8n-nodes-base.set` — Data transformation
- `n8n-nodes-base.noOp` — Terminal nodes
- `n8n-nodes-base.manualTrigger` — Manual start trigger
- `n8n-nodes-base.scheduleTrigger` — Time-based triggers
- `n8n-nodes-base.webhook` — HTTP webhook entry

### Prefect Adapter (Production-ready)

```typescript
class PrefectAdapter implements EngineAdapter {
  // POST /api/deployments/name/{name}/default/create_flow_run
  async trigger(workflow: WorkflowSpec): Promise<RunResult>
  // GET /api/flow_runs/{runId}
  async getStatus(runId: string): Promise<RunStatus>
  async isHealthy(): Promise<boolean>
}
```

### Stub Adapters

```typescript
class TriggerDevAdapter implements EngineAdapter  // isHealthy() = false always
class LangGraphAdapter  implements EngineAdapter  // isHealthy() = false always
```

### Registry

```typescript
class AdapterRegistry {
  get(name: EngineType): EngineAdapter | undefined
  async healthAll(): Promise<Record<string, boolean>>
}

// Singleton export
export const registry: AdapterRegistry;
```

---

## 7. RAG System (`src/rag/index.ts`)

### Types

```typescript
interface IngestRequest {
  text: string;
  metadata?: Record<string, string>;
  id?: string;  // auto-generated UUID if omitted
}

interface QueryRequest {
  question: string;
  topK?: number;  // default: 3
}

interface QueryResult {
  context: string;  // concatenated text from top-K sources
  sources: Array<{
    id: string;
    text: string;
    metadata: Record<string, string>;
    score: number;  // cosine similarity
  }>;
}
```

### Class: `RAGSystem`

```typescript
class RAGSystem {
  // Initialize — tries ChromaDB first, falls back to pgvector
  async init(): Promise<void>

  // Chunk text and store embeddings
  async ingest(req: IngestRequest): Promise<{ ids: string[] }>

  // Semantic search
  async query(req: QueryRequest): Promise<QueryResult>

  async isHealthy(): Promise<boolean>
}

export const ragSystem: RAGSystem;
```

### Technical Specs

| Property | Value |
|----------|-------|
| Embedding model | `text-embedding-3-small` (OpenAI) |
| Embedding dimensions | 1536 |
| Chunk size | 500 characters |
| Chunk overlap | 50 characters |
| Default top-K | 3 |
| Similarity metric | Cosine |
| Primary store | ChromaDB (collection: `synelium`) |
| Fallback store | PostgreSQL + pgvector (table: `documents`) |

### Graceful Degradation

- Server starts even if both ChromaDB and pgvector are unavailable
- `isHealthy()` returns `false` — executives still respond, just without RAG context
- `useRag: false` is the default for all board chat calls

---

## 8. Sub-Agents (`src/subagents/index.ts`)

### Types

```typescript
interface WorkflowRequest {
  executive: string;   // e.g., 'ECHO', 'HARVEY'
  decision: string;    // the [[WORKFLOW_READY]] text extracted from exec response
  context?: string;    // optional conversation context
  orgName?: string;    // organization name for personalization
}

interface WorkflowStep {
  order: number;
  name: string;
  description: string;
  owner: string;       // department or role responsible
  tooling?: string;    // suggested SaaS tools
  automated: boolean;
}

interface SaaSSpec {
  name: string;
  description: string;
  features: string[];
  dataModels: string[];
  integrations: string[];
  deploymentNotes: string;
}

interface WorkflowPlan {
  executive: string;
  department: string;
  decision: string;
  workflowType: string;
  steps: WorkflowStep[];
  saasSpec: SaaSSpec;
  n8nWorkflow?: N8nWorkflow;  // undefined if Stage 2 fails
  error?: string;
}
```

### Abstract Base Class

```typescript
abstract class DepartmentSubAgent {
  readonly executive: string;
  readonly department: string;

  // Two-stage process: plan → n8n JSON
  async buildWorkflow(req: WorkflowRequest): Promise<WorkflowPlan>
}
```

### Sub-Agent Registry

```typescript
const subAgentMap: Record<string, DepartmentSubAgent> = {
  ECHO:          MarketingSubAgent,
  HARVEY:        LegalSubAgent,
  ROMBUS:        OperationsSubAgent,
  LEGCA_STEELE:  FinanceSubAgent,
};
```

### Two-Stage Workflow Generation

**Stage 1 — Planning** (Claude call, max 4096 tokens):
```
Input:  executive name + decision text + org name
Output: JSON { workflowType, steps[], saasSpec{} }
```

**Stage 2 — n8n JSON** (Claude call, max 8192 tokens):
```
Input:  Stage 1 plan
Output: N8nWorkflowDefinition { name, nodes[], connections{} }
```

- All generated workflows default to `active: false`
- Nodes are positioned 200px apart horizontally
- Human must manually activate in n8n UI

---

## 9. HTTP API Reference (`src/index.ts`)

All requests/responses use `Content-Type: application/json`.

### Health & Dashboard

```
GET  /health       → { status, services: { n8n, prefect, triggerDev, langGraph, rag } }
GET  /dashboard    → HTML page (also served at GET /)
GET  /router/status → { rules[], engines{} }
```

### Board / Executive Chat

```
POST /board/chat
Body: {
  message: string,
  executive?: string,          // 'ECHO'|'HARVEY'|'ROMBUS'|'LEGCA_STEELE', default: ECHO
  sessionId?: string,          // omit to start new session
  confirmWorkflow?: boolean,   // true = build n8n workflow from pending decision
}
Response: {
  response: string,
  executive: string,
  sessionId: string,
  workflowSignal?: string,     // set if [[WORKFLOW_READY]] detected
  workflowPlan?: WorkflowPlan  // set if confirmWorkflow=true
}

GET  /board/chat?sessionId=<id>  → { history: BoardMessage[] }
DELETE /board/chat?sessionId=<id> → { cleared: true }
```

### Task Routing

```
POST /task
Body: { type: TaskType, prompt: string, metadata?: TaskMetadata }
Response: {
  task: Task,
  decision: EngineDecision,
  executiveResult?: ExecutiveResult
}

POST /executive/:name/task
Body: { prompt: string, context?: string, useRag?: boolean, sessionId?: string }
Response: ExecutiveResult
```

### Board Discussion

```
POST /board/discuss
Body: { topic: string, executives?: string[] }
Response: {
  topic: string,
  round1: Array<{ executive, response }>,
  round2: Array<{ executive, response }>   // cross-responses
}
```

### Executive Decision → Workflow

```
POST /executive/:name/decide
Body: { prompt: string, orgName?: string }
Response: WorkflowPlan
```

### RAG Knowledge Base

```
POST /rag/ingest
Body: IngestRequest
Response: { ids: string[] }

POST /rag/query
Body: QueryRequest
Response: QueryResult
```

### n8n Workflow Management

```
GET    /n8n/workflows           → N8nWorkflowDefinition[]
POST   /n8n/workflows           Body: N8nWorkflowDefinition → { id }
PUT    /n8n/workflows/:id       Body: Partial<N8nWorkflowDefinition> → { ok }
DELETE /n8n/workflows/:id       → { ok }
POST   /n8n/workflows/:id/activate → { ok }
```

---

## 10. End-to-End Execution Flow

```
1. User sends:  POST /board/chat { message: "Launch a drip campaign for Q3", executive: "ECHO" }

2. System:
   a. appendToSession(sid, { role: 'user', content: message })
   b. echo.handle({ prompt: message, sessionId: sid, useRag: false })
      - Builds message history from session (excludes current message to avoid duplicate)
      - Calls Claude with ECHO system prompt + history
      - Returns ExecutiveResult { response: "...[[WORKFLOW_READY: Q3 drip campaign for leads]]" }
   c. appendToSession(sid, { role: 'assistant', content: response })
   d. extractWorkflowSignal(response)
      → { clean: "Got it. I'll map it out...", decision: "Q3 drip campaign for leads" }
   e. Store pendingWorkflow[sid] = { executive: 'ECHO', decision: '...' }

3. Response to user:
   { response: "Got it...", workflowSignal: "Q3 drip campaign for leads", sessionId: sid }

4. User sees green banner: "Build workflow in n8n →"

5. User sends:  POST /board/chat { message: "confirm", sessionId: sid, confirmWorkflow: true }

6. System:
   a. Load pendingWorkflow[sid]
   b. MarketingSubAgent.buildWorkflow({ executive: 'ECHO', decision: '...' })
      - Stage 1: Claude → JSON plan with steps[]
      - Stage 2: Claude → N8nWorkflowDefinition JSON
   c. N8nAdapter.createWorkflow(n8nWorkflow)
      → { id: "abc123" }
   d. Return WorkflowPlan (including n8nWorkflow.id)

7. Response: { workflowPlan: { n8nWorkflow: { id: "abc123", active: false, ... }, ... } }

8. User opens n8n at configured URL and activates workflow "abc123" manually.
```

---

## 11. Integration Points for Backend Wiring

When integrating Synelium Orchestrator into a larger backend:

### A. Calling Executives Programmatically

```typescript
import { echo, harvey, rombus, legcaSteele } from './src/executives';

const result = await echo.handle({
  prompt: 'Create an email campaign for our new product launch',
  sessionId: 'session-abc',
  useRag: false,
});
// result.response may contain [[WORKFLOW_READY: ...]]
```

### B. Running the Policy Brain

```typescript
import { OrchestrationRouter } from './src/router';

const router = new OrchestrationRouter();
const decision = router.route({
  id: 'task-001',
  type: 'marketing',
  prompt: 'Run a retargeting ad campaign',
  metadata: { dataSensitivity: 'low', latencyRequirement: 'fast' },
});
// decision.engine = 'n8n', decision.executive = 'ECHO'
```

### C. Triggering Workflow Engines

```typescript
import { registry } from './src/adapters';

const n8n = registry.get('n8n');
const run = await n8n.trigger({ name: 'my-workflow', payload: { key: 'value' } });
// run.runId, run.status
```

### D. Querying the Knowledge Base

```typescript
import { ragSystem } from './src/rag';

await ragSystem.ingest({ text: 'Q3 revenue target is $2M', metadata: { source: 'finance' } });
const result = await ragSystem.query({ question: 'What is Q3 revenue target?', topK: 3 });
// result.context = concatenated matched text
```

### E. Building a Workflow from a Decision

```typescript
import { subAgentMap } from './src/subagents';

const agent = subAgentMap['ECHO'];
const plan = await agent.buildWorkflow({
  executive: 'ECHO',
  decision: 'Q3 email drip for leads',
  orgName: 'Acme Corp',
});
// plan.n8nWorkflow = full N8nWorkflowDefinition, ready to push to n8n
```

---

## 12. Key Invariants & Constraints

| Constraint | Detail |
|-----------|--------|
| No external tool calls from executives | Executives are "signal only" — they emit decisions, never call APIs directly |
| Session isolation | Each `sessionId` has independent history; no shared state between sessions |
| Workflow default state | All generated n8n workflows are created `active: false` |
| Claude model | Hard-coded to `claude-sonnet-4-6` — change in `BaseExecutive.callClaude()` |
| RAG optional | `useRag: false` is the safe default; system functions without it |
| n8n node positions | Auto-positioned at 200px horizontal intervals; `[i * 200, 0]` |
| Session max size | 40 messages; oldest messages auto-dropped |
| Pending workflows | Stored in-memory `Map<sessionId, PendingWorkflow>` — lost on server restart |

---

## 13. Extending the System

### Adding a New Executive

1. Create a class extending `BaseExecutive` in `src/executives/index.ts`
2. Define `name`, `role`, and `systemPrompt` (include the signal protocol)
3. Add to `executiveMap` and export the instance
4. Add a corresponding sub-agent in `src/subagents/index.ts` extending `DepartmentSubAgent`
5. Add to `subAgentMap`

### Adding a New Workflow Engine

1. Create a class implementing `EngineAdapter` in `src/adapters/index.ts`
2. Implement `trigger()`, `getStatus()`, `isHealthy()`
3. Register in `AdapterRegistry`
4. Add to `EngineType` union in `src/router/index.ts`
5. Add scoring logic to `OrchestrationRouter`

### Adding Compliance Rules

In `src/router/index.ts`, add a new entry to the `policyRules` array:

```typescript
{
  name: 'My Rule',
  check: (task: Task): PolicyCheckResult => ({
    rule: 'My Rule',
    passed: <condition>,
    action: 'block' | 'flag' | 'allow' | 'log',
    message: '<explanation>',
  }),
}
```

---

## 14. Dependencies Quick Reference

```json
{
  "@anthropic-ai/sdk": "^0.80.0",
  "express": "^5.2.1",
  "chromadb": "^1.8.0",
  "openai": "^4.28.0",
  "pg": "^8.11.0",
  "axios": "^1.6.0",
  "dotenv": "^17.3.1",
  "typescript": "^5.3.0"
}
```

---

## 15. Local Development Stack

Services started via `docker-compose up`:

| Service | Port | Purpose |
|---------|------|---------|
| PostgreSQL 16 + pgvector | 5432 | Relational DB + vector fallback |
| ChromaDB | 8000 | Primary vector DB |
| n8n | 5678 | Workflow automation UI + API |
| Prefect | 4200 | Data pipeline orchestration UI + API |

Build: `npm run build` → `dist/`
Start: `npm start` (runs `node dist/index.js`)
Test: `npm test`
Health: `GET /health`

---

*Document generated from source at `/home/user/Synelium-Orchsstrator` — branch `claude/document-synelium-functions-HlB3B`*
