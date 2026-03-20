import express, { Request, Response, NextFunction } from 'express';
import { config } from './config';
import { router } from './router';
import { adapterRegistry } from './adapters';
import { ragSystem } from './rag';
import { executiveRegistry } from './executives';
import { buildDashboardHTML } from './site-builder';
import type { Task } from './router';

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

// ── Error handler ─────────────────────────────────────────────────────────────

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: err.message });
});

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

start().catch((err) => {
  console.error('[synelium] startup failed:', err);
  process.exit(1);
});
