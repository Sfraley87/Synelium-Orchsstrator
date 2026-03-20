/**
 * Integration tests for the n8n workflow management routes and /board/chat.
 * The N8nAdapter and Anthropic SDK are mocked so no live services are needed.
 */

import request from 'supertest';

// ── Mock adapters before importing the app ────────────────────────────────────

jest.mock('./adapters', () => {
  const original = jest.requireActual('./adapters') as typeof import('./adapters');

  const mockN8n = {
    name: 'n8n',
    listWorkflows: jest.fn().mockResolvedValue([{ id: 'wf-1', name: 'Existing WF' }]),
    createWorkflow: jest.fn().mockResolvedValue({ id: 'wf-new', name: 'New WF', nodes: [], connections: {} }),
    updateWorkflow: jest.fn().mockResolvedValue({ id: 'wf-1', name: 'Updated WF', nodes: [], connections: {} }),
    activateWorkflow: jest.fn().mockResolvedValue(undefined),
    deleteWorkflow: jest.fn().mockResolvedValue(undefined),
    trigger: jest.fn().mockResolvedValue({ runId: 'run-1', engine: 'n8n', status: 'queued' }),
    getStatus: jest.fn().mockResolvedValue({ runId: 'run-1', status: 'running' }),
    isHealthy: jest.fn().mockResolvedValue(true),
  };

  const registry = {
    get: jest.fn((name: string) => name === 'n8n' ? mockN8n : undefined),
    healthAll: jest.fn().mockResolvedValue({ n8n: true }),
  };

  return { ...original, adapterRegistry: registry, N8nAdapter: original.N8nAdapter };
});

// ── Mock RAG so it doesn't need storage ──────────────────────────────────────

jest.mock('./rag', () => ({
  ragSystem: {
    init: jest.fn().mockResolvedValue(undefined),
    isHealthy: jest.fn().mockResolvedValue(false),
    query: jest.fn().mockResolvedValue({ context: '', sources: [] }),
    ingest: jest.fn().mockResolvedValue({ id: 'doc-1' }),
  },
}));

// ── Mock Anthropic SDK ────────────────────────────────────────────────────────

jest.mock('@anthropic-ai/sdk', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: {
        create: jest.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'Mock executive response.' }],
        }),
      },
    })),
  };
});

import { app } from './index';

// ── /n8n/workflows routes ─────────────────────────────────────────────────────

describe('GET /n8n/workflows', () => {
  it('returns list of workflows', async () => {
    const res = await request(app).get('/n8n/workflows');
    expect(res.status).toBe(200);
    expect(res.body.workflows).toBeInstanceOf(Array);
    expect(res.body.workflows[0].id).toBe('wf-1');
  });
});

describe('POST /n8n/workflows', () => {
  const validDef = { name: 'My Workflow', nodes: [], connections: {} };

  it('creates a workflow and returns 201', async () => {
    const res = await request(app).post('/n8n/workflows').send(validDef);
    expect(res.status).toBe(201);
    expect(res.body.workflow.id).toBe('wf-new');
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app).post('/n8n/workflows').send({ nodes: [] });
    expect(res.status).toBe(400);
  });

  it('returns 400 when nodes is not an array', async () => {
    const res = await request(app).post('/n8n/workflows').send({ name: 'Test', nodes: 'bad' });
    expect(res.status).toBe(400);
  });
});

describe('PUT /n8n/workflows/:id', () => {
  it('updates a workflow', async () => {
    const res = await request(app).put('/n8n/workflows/wf-1').send({ name: 'Updated WF' });
    expect(res.status).toBe(200);
    expect(res.body.workflow.name).toBe('Updated WF');
  });
});

describe('POST /n8n/workflows/:id/activate', () => {
  it('activates a workflow', async () => {
    const res = await request(app).post('/n8n/workflows/wf-1/activate');
    expect(res.status).toBe(200);
    expect(res.body.activated).toBe(true);
    expect(res.body.id).toBe('wf-1');
  });
});

describe('DELETE /n8n/workflows/:id', () => {
  it('deletes a workflow', async () => {
    const res = await request(app).delete('/n8n/workflows/wf-1');
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
  });
});

// ── /board/chat conversation ──────────────────────────────────────────────────

describe('POST /board/chat', () => {
  it('returns 400 when message is missing', async () => {
    const res = await request(app).post('/board/chat').send({});
    expect(res.status).toBe(400);
  });

  it('returns responses from all executives when no executive is specified', async () => {
    const res = await request(app).post('/board/chat').send({ message: 'Lets launch a product' });
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBeDefined();
    expect(res.body.responses).toBeInstanceOf(Array);
    expect(res.body.responses.length).toBeGreaterThan(0);
  });

  it('returns a single response when executive is specified', async () => {
    const res = await request(app).post('/board/chat').send({ message: 'Hello', executive: 'ECHO' });
    expect(res.status).toBe(200);
    expect(res.body.responses).toHaveLength(1);
    expect(res.body.responses[0].executive).toBe('ECHO');
  });

  it('persists sessionId across turns', async () => {
    const first = await request(app).post('/board/chat').send({ message: 'Turn 1', executive: 'ECHO' });
    const sid = first.body.sessionId as string;

    const second = await request(app).post('/board/chat').send({ message: 'Turn 2', executive: 'ECHO', sessionId: sid });
    expect(second.body.sessionId).toBe(sid);
  });

  it('returns 404 for unknown executive', async () => {
    const res = await request(app).post('/board/chat').send({ message: 'Hi', executive: 'NOBODY' });
    expect(res.status).toBe(404);
  });

  it('returns 400 for confirmWorkflow with no pending workflow', async () => {
    const res = await request(app).post('/board/chat').send({
      message: 'confirm',
      sessionId: 'nonexistent-session',
      confirmWorkflow: true,
    });
    expect(res.status).toBe(400);
  });
});

// ── GET /board/chat/:sessionId ────────────────────────────────────────────────

describe('GET /board/chat/:sessionId', () => {
  it('returns session history', async () => {
    const chatRes = await request(app).post('/board/chat').send({ message: 'hello', executive: 'ECHO' });
    const sid = chatRes.body.sessionId as string;

    const historyRes = await request(app).get(`/board/chat/${sid}`);
    expect(historyRes.status).toBe(200);
    expect(historyRes.body.messages).toBeInstanceOf(Array);
    expect(historyRes.body.messages.length).toBeGreaterThanOrEqual(1);
  });
});

// ── DELETE /board/chat/:sessionId ────────────────────────────────────────────

describe('DELETE /board/chat/:sessionId', () => {
  it('clears the session', async () => {
    const chatRes = await request(app).post('/board/chat').send({ message: 'hello', executive: 'ECHO' });
    const sid = chatRes.body.sessionId as string;

    const delRes = await request(app).delete(`/board/chat/${sid}`);
    expect(delRes.body.cleared).toBe(true);

    const historyRes = await request(app).get(`/board/chat/${sid}`);
    expect(historyRes.body.messages).toHaveLength(0);
  });
});
