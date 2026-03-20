// Dashboard HTML generator — MVP scope (full site builder is post-MVP)

export interface DashboardData {
  services: Record<string, boolean>;
  executives: string[];
  recentTasks: Array<{ id: string; type: string; executive: string | null; ts: string }>;
}

export function buildDashboardHTML(data: DashboardData): string {
  const serviceRows = Object.entries(data.services)
    .map(([name, healthy]) => {
      const dot = healthy ? '🟢' : '🔴';
      return `<tr><td>${dot}</td><td>${name}</td><td>${healthy ? 'healthy' : 'unreachable'}</td></tr>`;
    })
    .join('');

  const executiveCards = data.executives
    .map((name) => `<div class="exec-card">${name}</div>`)
    .join('');

  const taskRows = data.recentTasks
    .map(
      (t) =>
        `<tr><td>${t.ts}</td><td>${t.type}</td><td>${t.executive ?? '—'}</td><td>${t.id}</td></tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Synelium Orchestrator</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0d0d0d; color: #e0e0e0; padding: 24px; }
    h1 { color: #7c3aed; font-size: 1.6rem; margin-bottom: 4px; }
    .subtitle { color: #666; font-size: 0.85rem; margin-bottom: 32px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px; }
    .card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px; padding: 20px; }
    .card h2 { font-size: 0.75rem; text-transform: uppercase; letter-spacing: .08em; color: #888; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    td { padding: 6px 8px; border-bottom: 1px solid #2a2a2a; }
    .exec-card { display: inline-block; background: #2a1a4a; color: #a78bfa; border-radius: 8px;
                 padding: 6px 14px; margin: 4px; font-size: 0.85rem; font-weight: 600; }
    .rag-box { display: flex; gap: 8px; margin-top: 12px; }
    .rag-box input { flex: 1; background: #111; border: 1px solid #333; border-radius: 8px;
                     color: #e0e0e0; padding: 8px 12px; font-size: 0.85rem; }
    .rag-box button { background: #7c3aed; color: white; border: none; border-radius: 8px;
                       padding: 8px 16px; cursor: pointer; font-size: 0.85rem; }
    #rag-result { margin-top: 12px; font-size: 0.8rem; color: #aaa; white-space: pre-wrap; }
    .badge { font-size: 0.65rem; background: #1a2a1a; color: #4ade80; border-radius: 4px; padding: 2px 6px; margin-left: 8px; }
  </style>
</head>
<body>
  <h1>Synelium Orchestrator <span class="badge">MVP</span></h1>
  <p class="subtitle">The AI Operating System for Enterprises — live status dashboard</p>

  <div class="grid">
    <div class="card">
      <h2>Service Health</h2>
      <table>
        <tbody id="services">${serviceRows}</tbody>
      </table>
    </div>

    <div class="card">
      <h2>AI Executives</h2>
      <div id="executives">${executiveCards}</div>
    </div>

    <div class="card" style="grid-column: 1 / -1;">
      <h2>Recent Tasks</h2>
      <table>
        <thead><tr><td>Time</td><td>Type</td><td>Executive</td><td>Task ID</td></tr></thead>
        <tbody id="tasks">${taskRows || '<tr><td colspan="4" style="color:#555;text-align:center;padding:16px;">No tasks yet</td></tr>'}</tbody>
      </table>
    </div>

    <div class="card" style="grid-column: 1 / -1;">
      <h2>RAG Knowledge Query</h2>
      <div class="rag-box">
        <input id="rag-input" type="text" placeholder="Ask the knowledge base anything..." />
        <button onclick="queryRag()">Ask</button>
      </div>
      <pre id="rag-result"></pre>
    </div>
  </div>

  <script>
    async function queryRag() {
      const q = document.getElementById('rag-input').value;
      if (!q) return;
      document.getElementById('rag-result').textContent = 'Querying...';
      try {
        const res = await fetch('/rag/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: q, topK: 3 }),
        });
        const data = await res.json();
        document.getElementById('rag-result').textContent =
          data.context || '(no relevant context found)';
      } catch (e) {
        document.getElementById('rag-result').textContent = 'Error: ' + e.message;
      }
    }

    // Auto-refresh health every 10s
    async function refreshHealth() {
      try {
        const res = await fetch('/health');
        const data = await res.json();
        const tbody = document.getElementById('services');
        if (data.services) {
          tbody.innerHTML = Object.entries(data.services)
            .map(([name, ok]) =>
              '<tr><td>' + (ok ? '🟢' : '🔴') + '</td><td>' + name + '</td><td>' + (ok ? 'healthy' : 'unreachable') + '</td></tr>'
            ).join('');
        }
      } catch {}
    }
    setInterval(refreshHealth, 10000);
  </script>
</body>
</html>`;
}
