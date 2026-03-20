/**
 * Tests for N8nAdapter — workflow CRUD + trigger.
 * Axios is mocked so no real n8n instance is required.
 */

import axios from 'axios';
import { N8nAdapter } from './index';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('N8nAdapter', () => {
  let adapter: N8nAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new N8nAdapter();
  });

  // ── isHealthy ─────────────────────────────────────────────────────────────

  it('isHealthy returns true when /healthz responds', async () => {
    mockedAxios.get.mockResolvedValueOnce({ status: 200 });
    expect(await adapter.isHealthy()).toBe(true);
  });

  it('isHealthy returns false when /healthz throws', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await adapter.isHealthy()).toBe(false);
  });

  // ── trigger ───────────────────────────────────────────────────────────────

  it('trigger returns a RunResult with the workflow id', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { id: 'wf-123' } });
    const result = await adapter.trigger({ name: 'my-workflow', payload: { foo: 'bar' } });
    expect(result.engine).toBe('n8n');
    expect(result.runId).toBe('wf-123');
    expect(result.status).toBe('queued');
  });

  it('trigger falls back to mock run when n8n is unreachable', async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error('timeout'));
    const result = await adapter.trigger({ name: 'my-workflow', payload: {} });
    expect(result.runId).toMatch(/^n8n-mock-/);
    expect(result.engine).toBe('n8n');
  });

  // ── listWorkflows ─────────────────────────────────────────────────────────

  it('listWorkflows returns array from data.data', async () => {
    const workflows = [{ id: '1', name: 'WF 1' }, { id: '2', name: 'WF 2' }];
    mockedAxios.get.mockResolvedValueOnce({ data: { data: workflows } });
    const result = await adapter.listWorkflows();
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe('1');
  });

  it('listWorkflows handles flat array response', async () => {
    const workflows = [{ id: '1', name: 'WF 1' }];
    mockedAxios.get.mockResolvedValueOnce({ data: workflows });
    const result = await adapter.listWorkflows();
    expect(result).toHaveLength(1);
  });

  // ── createWorkflow ────────────────────────────────────────────────────────

  it('createWorkflow POSTs and returns the created workflow', async () => {
    const created = { id: 'new-wf', name: 'My Workflow', nodes: [], connections: {} };
    mockedAxios.post.mockResolvedValueOnce({ data: created });

    const result = await adapter.createWorkflow({
      name: 'My Workflow',
      nodes: [],
      connections: {},
    });

    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/workflows'),
      expect.objectContaining({ name: 'My Workflow' }),
      expect.objectContaining({ headers: expect.objectContaining({ 'X-N8N-API-KEY': expect.any(String) }) })
    );
    expect(result.id).toBe('new-wf');
  });

  // ── updateWorkflow ────────────────────────────────────────────────────────

  it('updateWorkflow PUTs to the correct endpoint', async () => {
    const updated = { id: 'wf-42', name: 'Updated', nodes: [], connections: {} };
    mockedAxios.put.mockResolvedValueOnce({ data: updated });

    const result = await adapter.updateWorkflow('wf-42', { name: 'Updated' });

    expect(mockedAxios.put).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/workflows/wf-42'),
      { name: 'Updated' },
      expect.anything()
    );
    expect(result.name).toBe('Updated');
  });

  // ── activateWorkflow ──────────────────────────────────────────────────────

  it('activateWorkflow POSTs to /:id/activate', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: {} });
    await adapter.activateWorkflow('wf-99');
    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/workflows/wf-99/activate'),
      expect.anything(),
      expect.anything()
    );
  });

  // ── deleteWorkflow ────────────────────────────────────────────────────────

  it('deleteWorkflow DELETEs the correct endpoint', async () => {
    mockedAxios.delete.mockResolvedValueOnce({ data: {} });
    await adapter.deleteWorkflow('wf-55');
    expect(mockedAxios.delete).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/workflows/wf-55'),
      expect.anything()
    );
  });

  // ── getStatus ─────────────────────────────────────────────────────────────

  it('getStatus returns completed when execution is finished', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { finished: true } });
    const status = await adapter.getStatus('exec-1');
    expect(status.status).toBe('completed');
  });

  it('getStatus returns running when execution is not finished', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { finished: false } });
    const status = await adapter.getStatus('exec-2');
    expect(status.status).toBe('running');
  });
});
