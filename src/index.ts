import express, { Request, Response, NextFunction } from 'express';
import { config } from './config';
import { router } from './router';
import { adapterRegistry, N8nAdapter } from './adapters';
import { ragSystem } from './rag';
import { executiveRegistry, getSession, appendToSession, clearSession } from './executives';
import { subAgentRegistry } from './subagents';
import { buildDashboardHTML } from './site-builder';
import { learningTutor } from './learning';
import type { UserProfile } from './learning';
import type { Task } from './router';

// ── Pending workflows (keyed by sessionId) ───────────────────────────────────

interface PendingWorkflow {
  executive: string;
  decision: string;
}
const pendingWorkflows = new Map<string, PendingWorkflow>();

const WORKFLOW_READY_RE = /\[\[WORKFLOW_READY:\s*(.+?)\]\]/;

function extractWorkflowSignal(text: string): { clean: string; decision: string | null } {
  const match = WORKFLOW_READY_RE.exec(text);
  if (!match) return { clean: text, decision: null };
  return {
    clean: text.replace(WORKFLOW_READY_RE, '').trim(),
    decision: match[1]!.trim(),
  };
}

// ── Task log (in-memory, last 50) ─────────────────────────────────────────────

interface TaskLogEntry {
  id: string;
  type: string;
  executive: string | null;
  ts: string;
}
const taskLog: TaskLogEntry[] = [];
function logTask(entry: TaskLogEntry) {
  taskLog.unshift(entry);
  if (taskLog.length > 50) taskLog.pop();
}

// ── App ───────────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/health', async (_req: Request, res: Response) => {
  const engineHealth = await adapterRegistry.healthAll();
  const ragHealthy = await ragSystem.isHealthy();

  res.json({
    status: 'ok',
    version: '0.1.0-mvp',
    services: {
      ...engineHealth,
      rag: ragHealthy,
    },
    executives: executiveRegistry.list(),
  });
});

// ── Root redirect ─────────────────────────────────────────────────────────────

app.get('/', (_req: Request, res: Response) => {
  res.redirect('/dashboard');
});

// ── Dashboard ─────────────────────────────────────────────────────────────────

app.get('/dashboard', async (_req: Request, res: Response) => {
  const engineHealth = await adapterRegistry.healthAll();
  const ragHealthy = await ragSystem.isHealthy();

  const html = buildDashboardHTML({
    services: { ...engineHealth, rag: ragHealthy },
    executives: executiveRegistry.list(),
    recentTasks: taskLog.slice(0, 10),
  });

  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// ── Route a task ──────────────────────────────────────────────────────────────

app.post('/task', async (req: Request, res: Response) => {
  const body = req.body as Partial<Task>;
  if (!body.type || !body.prompt) {
    res.status(400).json({ error: 'type and prompt are required' });
    return;
  }

  const task: Task = {
    id: `task-${Date.now()}`,
    type: body.type,
    prompt: body.prompt,
    metadata: body.metadata,
  };

  const decision = router.route(task);
  logTask({ id: task.id, type: task.type, executive: decision.executive, ts: new Date().toISOString() });

  if (decision.blocked) {
    res.status(403).json({ taskId: task.id, blocked: true, reason: decision.blockReason, policyChecks: decision.policyChecks });
    return;
  }

  // If an executive handles this task type, run it
  let executiveResult = null;
  if (decision.executive) {
    const exec = executiveRegistry.get(decision.executive);
    if (exec) {
      executiveResult = await exec.handle({ prompt: task.prompt, useRag: true });
    }
  }

  // Trigger the selected engine adapter
  const adapter = adapterRegistry.get(decision.engine);
  const runResult = adapter
    ? await adapter.trigger({ name: task.type, payload: { taskId: task.id, prompt: task.prompt } })
    : null;

  res.json({
    taskId: task.id,
    decision,
    executiveResult,
    runResult,
  });
});

// ── Executive direct endpoint ─────────────────────────────────────────────────

app.post('/executive/:name/task', async (req: Request, res: Response) => {
  const name = req.params['name'] as string;
  const { prompt, useRag } = req.body as { prompt?: string; useRag?: boolean };

  if (!prompt) {
    res.status(400).json({ error: 'prompt is required' });
    return;
  }

  const exec = executiveRegistry.get(name);
  if (!exec) {
    res.status(404).json({ error: `Executive '${name}' not found`, available: executiveRegistry.list() });
    return;
  }

  const result = await exec.handle({ prompt, useRag: useRag ?? true });
  res.json(result);
});

// ── Board endpoints ───────────────────────────────────────────────────────────

// POST /board/discuss — all execs weigh in on a topic, then respond to each other
app.post('/board/discuss', async (req: Request, res: Response) => {
  const { topic, executives: names } = req.body as { topic?: string; executives?: string[] };
  if (!topic) {
    res.status(400).json({ error: 'topic is required' });
    return;
  }

  const board = names && names.length
    ? names.map((n) => executiveRegistry.get(n)).filter(Boolean)
    : executiveRegistry.all();

  if (!board.length) {
    res.status(400).json({ error: 'No valid executives found' });
    return;
  }

  // Round 1: each exec gives initial take
  const initialResponses = await Promise.all(
    board.map(async (exec) => {
      const result = await exec!.handle({ prompt: topic, useRag: false });
      return { executive: result.executive, role: result.role, response: result.response };
    })
  );

  // Round 2: each exec sees what others said and responds
  const debateResponses = await Promise.all(
    board.map(async (exec) => {
      const others = initialResponses.filter((r) => r.executive !== exec!.name);
      const reply = await exec!.boardReply(topic, others);
      return { executive: exec!.name, role: exec!.role, response: reply };
    })
  );

  res.json({
    topic,
    executives: board.map((e) => ({ name: e!.name, role: e!.role })),
    round1: initialResponses,
    round2: debateResponses,
  });
});

// POST /board/chat — ongoing conversation with the full board or one exec
app.post('/board/chat', async (req: Request, res: Response) => {
  const { message, sessionId, executive: execName, confirmWorkflow } = req.body as {
    message?: string;
    sessionId?: string;
    executive?: string;
    confirmWorkflow?: boolean;
  };

  if (!message) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  const sid = sessionId ?? `session-${Date.now()}`;

  // ── Workflow confirmation path ─────────────────────────────────────────────
  if (confirmWorkflow) {
    const pending = pendingWorkflows.get(sid);
    if (!pending) {
      res.status(400).json({ error: 'No pending workflow found for this session. Have the executive reach alignment first.' });
      return;
    }

    const subAgent = subAgentRegistry.getByExecutive(pending.executive);
    if (!subAgent) {
      res.status(404).json({ error: `No sub-agent found for executive '${pending.executive}'` });
      return;
    }

    const sessionHistory = getSession(sid);
    const context = sessionHistory.map((m) => `${m.role === 'user' ? 'User' : m.executive ?? 'Executive'}: ${m.content}`).join('\n');

    try {
      const plan = await subAgent.buildWorkflow({ executive: pending.executive, decision: pending.decision, context });
      pendingWorkflows.delete(sid);

      appendToSession(sid, { role: 'user', content: message! });
      appendToSession(sid, { role: 'assistant', executive: pending.executive, content: `Workflow pushed. Decision: "${pending.decision}"` });

      res.json({ sessionId: sid, workflowPushed: true, executive: pending.executive, decision: pending.decision, plan });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Workflow build failed: ${msg}` });
    }
    return;
  }

  // ── Normal chat path ───────────────────────────────────────────────────────
  appendToSession(sid, { role: 'user', content: message });

  if (execName) {
    const exec = executiveRegistry.get(execName);
    if (!exec) {
      res.status(404).json({ error: `Executive '${execName}' not found`, available: executiveRegistry.list() });
      return;
    }
    const result = await exec.handle({ prompt: message, sessionId: sid, useRag: false });
    const { clean, decision } = extractWorkflowSignal(result.response);
    result.response = clean;

    let workflowReady = false;
    if (decision) {
      pendingWorkflows.set(sid, { executive: exec.name, decision });
      workflowReady = true;
    }

    res.json({ sessionId: sid, responses: [result], workflowReady, pendingDecision: decision ?? undefined });
  } else {
    const results = await Promise.all(
      executiveRegistry.all().map((exec) => exec.handle({ prompt: message, sessionId: sid, useRag: false }))
    );

    let workflowReady = false;
    let pendingDecision: string | undefined;

    const responses = results.map((result) => {
      const { clean, decision } = extractWorkflowSignal(result.response);
      result.response = clean;
      if (decision && !workflowReady) {
        pendingWorkflows.set(sid, { executive: result.executive, decision });
        workflowReady = true;
        pendingDecision = decision;
      }
      return result;
    });

    res.json({ sessionId: sid, responses, workflowReady, pendingDecision });
  }
});

// DELETE /board/chat/:sessionId — clear session history
app.delete('/board/chat/:sessionId', (req: Request, res: Response) => {
  clearSession(req.params['sessionId'] as string);
  res.json({ cleared: true });
});

// GET /board/chat/:sessionId — get session history
app.get('/board/chat/:sessionId', (req: Request, res: Response) => {
  const history = getSession(req.params['sessionId'] as string);
  res.json({ sessionId: req.params['sessionId'], messages: history });
});

// ── Sub-agent: decision → workflow plan ───────────────────────────────────────

// POST /executive/:name/decide — exec makes a decision, sub-agent builds the workflow
app.post('/executive/:name/decide', async (req: Request, res: Response) => {
  const execName = req.params['name'] as string;
  const { decision, context, orgName } = req.body as {
    decision?: string;
    context?: string;
    orgName?: string;
  };

  if (!decision) {
    res.status(400).json({ error: 'decision is required' });
    return;
  }

  const exec = executiveRegistry.get(execName);
  if (!exec) {
    res.status(404).json({ error: `Executive '${execName}' not found`, available: executiveRegistry.list() });
    return;
  }

  const subAgent = subAgentRegistry.getByExecutive(execName);
  if (!subAgent) {
    res.status(404).json({ error: `No sub-agent found for executive '${execName}'` });
    return;
  }

  const plan = await subAgent.buildWorkflow({ executive: execName, decision, context, orgName });
  res.json({ executive: execName, plan });
});

// GET /subagents — list available sub-agents
app.get('/subagents', (_req: Request, res: Response) => {
  res.json({ subAgents: subAgentRegistry.list() });
});

// ── RAG endpoints ─────────────────────────────────────────────────────────────

app.post('/rag/ingest', async (req: Request, res: Response) => {
  const { text, metadata, id } = req.body as { text?: string; metadata?: Record<string, string>; id?: string };
  if (!text) {
    res.status(400).json({ error: 'text is required' });
    return;
  }
  const result = await ragSystem.ingest({ text, metadata, id });
  res.json(result);
});

app.post('/rag/query', async (req: Request, res: Response) => {
  const { question, topK } = req.body as { question?: string; topK?: number };
  if (!question) {
    res.status(400).json({ error: 'question is required' });
    return;
  }
  const result = await ragSystem.query({ question, topK });
  res.json(result);
});

// ── Router status ─────────────────────────────────────────────────────────────

app.get('/router/status', (_req: Request, res: Response) => {
  res.json(router.status());
});

// ── n8n Workflow Management ───────────────────────────────────────────────────

function getN8nAdapter(): N8nAdapter | null {
  const adapter = adapterRegistry.get('n8n');
  return adapter ? (adapter as N8nAdapter) : null;
}

// GET /n8n/workflows — list all workflows in n8n
app.get('/n8n/workflows', async (_req: Request, res: Response) => {
  const n8n = getN8nAdapter();
  if (!n8n) { res.status(503).json({ error: 'n8n adapter not available' }); return; }
  try {
    const workflows = await n8n.listWorkflows();
    res.json({ workflows });
  } catch (err) {
    res.status(502).json({ error: 'Failed to reach n8n', detail: (err as Error).message });
  }
});

// POST /n8n/workflows — create a workflow in n8n
app.post('/n8n/workflows', async (req: Request, res: Response) => {
  const n8n = getN8nAdapter();
  if (!n8n) { res.status(503).json({ error: 'n8n adapter not available' }); return; }
  const definition = req.body;
  if (!definition?.name || !Array.isArray(definition?.nodes)) {
    res.status(400).json({ error: 'Workflow definition requires at least name and nodes' });
    return;
  }
  try {
    const workflow = await n8n.createWorkflow(definition);
    res.status(201).json({ workflow });
  } catch (err) {
    res.status(502).json({ error: 'Failed to create workflow in n8n', detail: (err as Error).message });
  }
});

// PUT /n8n/workflows/:id — update an existing workflow
app.put('/n8n/workflows/:id', async (req: Request, res: Response) => {
  const n8n = getN8nAdapter();
  if (!n8n) { res.status(503).json({ error: 'n8n adapter not available' }); return; }
  try {
    const workflow = await n8n.updateWorkflow(req.params['id'] as string, req.body);
    res.json({ workflow });
  } catch (err) {
    res.status(502).json({ error: 'Failed to update workflow', detail: (err as Error).message });
  }
});

// POST /n8n/workflows/:id/activate — activate a workflow
app.post('/n8n/workflows/:id/activate', async (req: Request, res: Response) => {
  const n8n = getN8nAdapter();
  if (!n8n) { res.status(503).json({ error: 'n8n adapter not available' }); return; }
  try {
    await n8n.activateWorkflow(req.params['id'] as string);
    res.json({ activated: true, id: req.params['id'] });
  } catch (err) {
    res.status(502).json({ error: 'Failed to activate workflow', detail: (err as Error).message });
  }
});

// DELETE /n8n/workflows/:id — delete a workflow
app.delete('/n8n/workflows/:id', async (req: Request, res: Response) => {
  const n8n = getN8nAdapter();
  if (!n8n) { res.status(503).json({ error: 'n8n adapter not available' }); return; }
  try {
    await n8n.deleteWorkflow(req.params['id'] as string);
    res.json({ deleted: true, id: req.params['id'] });
  } catch (err) {
    res.status(502).json({ error: 'Failed to delete workflow', detail: (err as Error).message });
  }
});

// ── Learning / Onboarding ─────────────────────────────────────────────────────

app.post('/learn/chat', async (req: Request, res: Response) => {
  const { message, sessionId, profile } = req.body as {
    message?: string;
    sessionId?: string;
    profile?: UserProfile;
  };

  if (!message) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  if (!profile?.background || !profile?.aiExperience || !profile?.automationExperience || !profile?.learningStyle) {
    res.status(400).json({ error: 'profile is required (background, aiExperience, automationExperience, learningStyle)' });
    return;
  }

  const sid = sessionId ?? `learn-${Date.now()}`;

  try {
    const result = await learningTutor.chat(sid, message, profile);
    res.json({ sessionId: sid, response: result.response, readyToExplore: result.readyToExplore });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Learning session failed: ${msg}` });
  }
});

// ── Error handler ─────────────────────────────────────────────────────────────

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: err.message });
});

// Export app for testing (must come before start() so tests can import without booting)
export { app };

// ── Start ─────────────────────────────────────────────────────────────────────

async function start() {
  // RAG init is best-effort — server must start even if storage is unavailable
  try {
    await ragSystem.init();
  } catch (err) {
    console.warn('[synelium] RAG init failed, continuing without RAG:', (err as Error).message);
  }

  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`[synelium] listening on port ${config.port}`);
    console.log(`[synelium] dashboard → http://localhost:${config.port}/dashboard`);
    console.log(`[synelium] health   → http://localhost:${config.port}/health`);
  });

  process.on('SIGTERM', () => {
    console.log('[synelium] shutting down...');
    server.close(() => process.exit(0));
  });
}

// Only start the server when running directly (not when imported by tests)
if (require.main === module) {
  start().catch((err) => {
    console.error('[synelium] startup failed:', err);
    process.exit(1);
  });
}
