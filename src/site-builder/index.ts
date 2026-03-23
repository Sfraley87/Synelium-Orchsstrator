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
    .map((name) => `<div class="exec-card" onclick="openExec('${name}')">${name}</div>`)
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
                 padding: 6px 14px; margin: 4px; font-size: 0.85rem; font-weight: 600;
                 cursor: pointer; transition: background 0.15s; }
    .exec-card:hover { background: #3d1f6e; }

    /* ── Chat Modal ────────────────────────────────────────────── */
    .modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.75);
                     z-index: 100; align-items: center; justify-content: center; }
    .modal-overlay.open { display: flex; }
    .modal { background: #1a1a1a; border: 1px solid #3a2a5a; border-radius: 16px;
             width: min(520px, 95vw); height: min(640px, 90vh);
             display: flex; flex-direction: column; overflow: hidden; }

    .modal-header { display: flex; justify-content: space-between; align-items: center;
                    padding: 16px 20px; border-bottom: 1px solid #2a2a2a; flex-shrink: 0; }
    .modal-header-left { display: flex; align-items: center; gap: 10px; }
    .modal-title { color: #a78bfa; font-weight: 700; font-size: 1rem; }
    .modal-role { color: #555; font-size: 0.75rem; }
    .modal-header-right { display: flex; align-items: center; gap: 10px; }
    .btn-new-chat { background: none; border: 1px solid #333; color: #888; font-size: 0.72rem;
                    border-radius: 6px; padding: 4px 10px; cursor: pointer; transition: all 0.15s; }
    .btn-new-chat:hover { border-color: #a78bfa; color: #a78bfa; }
    .modal-close { background: none; border: none; color: #555; font-size: 1.4rem;
                   cursor: pointer; line-height: 1; transition: color 0.15s; }
    .modal-close:hover { color: #e0e0e0; }

    /* ── Chat thread ───────────────────────────────────────────── */
    .chat-thread { flex: 1; overflow-y: auto; padding: 16px 20px; display: flex;
                   flex-direction: column; gap: 12px; scroll-behavior: smooth; }
    .chat-thread::-webkit-scrollbar { width: 4px; }
    .chat-thread::-webkit-scrollbar-track { background: transparent; }
    .chat-thread::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }

    .msg { max-width: 88%; display: flex; flex-direction: column; gap: 3px; }
    .msg.user { align-self: flex-end; align-items: flex-end; }
    .msg.exec { align-self: flex-start; align-items: flex-start; }

    .msg-bubble { padding: 10px 14px; border-radius: 14px; font-size: 0.84rem;
                  line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
    .msg.user .msg-bubble { background: #3d1f6e; color: #e0e0e0; border-bottom-right-radius: 4px; }
    .msg.exec .msg-bubble { background: #1e1e2e; border: 1px solid #2a2a3a; color: #ccc;
                             border-bottom-left-radius: 4px; }

    .msg-label { font-size: 0.68rem; color: #555; padding: 0 4px; }

    .typing-indicator { display: flex; gap: 4px; padding: 12px 14px;
                        background: #1e1e2e; border: 1px solid #2a2a3a;
                        border-radius: 14px; border-bottom-left-radius: 4px;
                        width: fit-content; }
    .typing-indicator span { width: 6px; height: 6px; background: #555; border-radius: 50%;
                              animation: bounce 1.2s infinite; }
    .typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
    .typing-indicator span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes bounce {
      0%, 60%, 100% { transform: translateY(0); }
      30% { transform: translateY(-5px); }
    }

    .empty-state { flex: 1; display: flex; flex-direction: column; align-items: center;
                   justify-content: center; gap: 8px; color: #444; }
    .empty-state .icon { font-size: 2rem; }
    .empty-state p { font-size: 0.8rem; }

    /* ── Workflow ready banner ─────────────────────────────────── */
    .workflow-banner { margin: 0 20px 12px; background: #1a2a1a; border: 1px solid #2d4a2d;
                       border-radius: 10px; padding: 12px 16px; display: none; }
    .workflow-banner.show { display: block; }
    .workflow-banner p { font-size: 0.8rem; color: #4ade80; margin-bottom: 8px; }
    .workflow-banner small { color: #555; font-size: 0.75rem; display: block; margin-bottom: 10px; }
    .btn-confirm { background: #166534; color: #4ade80; border: 1px solid #2d4a2d;
                   border-radius: 6px; padding: 6px 14px; font-size: 0.8rem; cursor: pointer;
                   transition: background 0.15s; }
    .btn-confirm:hover { background: #14532d; }

    /* ── Input area ────────────────────────────────────────────── */
    .chat-input-area { padding: 12px 16px; border-top: 1px solid #2a2a2a;
                       display: flex; gap: 8px; align-items: flex-end; flex-shrink: 0; }
    .chat-input { flex: 1; background: #111; border: 1px solid #333; border-radius: 10px;
                  color: #e0e0e0; padding: 9px 12px; font-size: 0.84rem; resize: none;
                  font-family: inherit; max-height: 120px; overflow-y: auto; line-height: 1.4;
                  transition: border-color 0.15s; }
    .chat-input:focus { outline: none; border-color: #5b21b6; }
    .chat-input::placeholder { color: #444; }
    .btn-send { background: #7c3aed; color: white; border: none; border-radius: 10px;
                padding: 9px 16px; cursor: pointer; font-size: 0.84rem; flex-shrink: 0;
                transition: background 0.15s; }
    .btn-send:hover:not(:disabled) { background: #6d28d9; }
    .btn-send:disabled { opacity: 0.4; cursor: not-allowed; }
    .input-hint { font-size: 0.68rem; color: #444; margin-top: 4px; text-align: right; }

    /* ── Misc ──────────────────────────────────────────────────── */
    .rag-box { display: flex; gap: 8px; margin-top: 12px; }
    .rag-box input { flex: 1; background: #111; border: 1px solid #333; border-radius: 8px;
                     color: #e0e0e0; padding: 8px 12px; font-size: 0.85rem; }
    .rag-box button { background: #7c3aed; color: white; border: none; border-radius: 8px;
                       padding: 8px 16px; cursor: pointer; font-size: 0.85rem; }
    #rag-result { margin-top: 12px; font-size: 0.8rem; color: #aaa; white-space: pre-wrap; }
    .badge { font-size: 0.65rem; background: #1a2a1a; color: #4ade80;
             border-radius: 4px; padding: 2px 6px; margin-left: 8px; }

    /* ── Onboarding overlay ────────────────────────────────────── */
    .onboard-overlay { display: none; position: fixed; inset: 0;
                       background: rgba(0,0,0,0.92); z-index: 200;
                       align-items: center; justify-content: center; }
    .onboard-overlay.open { display: flex; }
    .onboard-modal { background: #111; border: 1px solid #2a2a3a; border-radius: 20px;
                     width: min(560px, 96vw); max-height: 90vh; overflow-y: auto;
                     display: flex; flex-direction: column; padding: 32px 32px 24px; gap: 24px; }

    .onboard-logo { font-size: 0.8rem; font-weight: 700; color: #7c3aed;
                    letter-spacing: .06em; text-transform: uppercase; margin-bottom: 4px; }
    .onboard-modal h2 { color: #e0e0e0; font-size: 1.3rem; font-weight: 700; margin-bottom: 6px; }
    .onboard-modal > p, .onboard-header > p { color: #666; font-size: 0.85rem; line-height: 1.5; }

    .quiz-questions { display: flex; flex-direction: column; gap: 20px; }
    .quiz-q label { display: block; font-size: 0.8rem; color: #888;
                    text-transform: uppercase; letter-spacing: .06em; margin-bottom: 8px; }
    .quiz-options { display: flex; flex-wrap: wrap; gap: 8px; }
    .quiz-opt { background: #1a1a1a; border: 1px solid #2a2a2a; color: #aaa;
                border-radius: 8px; padding: 7px 14px; font-size: 0.82rem; cursor: pointer;
                transition: all 0.15s; font-family: inherit; }
    .quiz-opt:hover { border-color: #5b21b6; color: #c4b5fd; }
    .quiz-opt.selected { background: #2a1a4a; border-color: #7c3aed; color: #a78bfa; font-weight: 600; }

    .onboard-btn { background: #7c3aed; color: white; border: none; border-radius: 10px;
                   padding: 12px 24px; font-size: 0.9rem; font-weight: 600; cursor: pointer;
                   transition: background 0.15s; align-self: flex-start; }
    .onboard-btn:hover:not(:disabled) { background: #6d28d9; }
    .onboard-btn:disabled { opacity: 0.35; cursor: not-allowed; }

    .onboard-skip { background: none; border: none; color: #3a3a3a; font-size: 0.75rem;
                    cursor: pointer; text-decoration: underline; align-self: flex-start;
                    margin-top: -12px; transition: color 0.15s; font-family: inherit; }
    .onboard-skip:hover { color: #666; }

    .learn-thread { flex: 1; overflow-y: auto; padding: 4px 0 12px;
                    display: flex; flex-direction: column; gap: 12px;
                    min-height: 280px; max-height: 340px; scroll-behavior: smooth; }
    .learn-thread::-webkit-scrollbar { width: 4px; }
    .learn-thread::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }

    .onboard-grad { display: flex; flex-direction: column; align-items: center;
                    justify-content: center; text-align: center; gap: 16px; padding: 16px 0; }
    .onboard-grad .grad-icon { font-size: 3rem; }
    .onboard-grad h2 { color: #a78bfa; }
    .onboard-grad p { color: #666; max-width: 340px; font-size: 0.85rem; line-height: 1.5; }
  </style>
</head>
<body>
  <h1>Synelium Orchestrator <span class="badge">MVP</span></h1>
  <p class="subtitle">The AI Operating System for Enterprises — live status dashboard</p>

  <!-- ── Onboarding overlay ─────────────────────────────────── -->
  <div class="onboard-overlay" id="onboard-overlay">
    <div class="onboard-modal">

      <!-- Step 1: Experience quiz -->
      <div id="onboard-step-1">
        <div>
          <div class="onboard-logo">⚡ Synelium Orchestrator</div>
          <h2>Let's personalize your experience.</h2>
          <p>4 quick questions so we can teach you exactly what you need to know — no more, no less.</p>
        </div>

        <div class="quiz-questions">
          <div class="quiz-q">
            <label>Your background</label>
            <div class="quiz-options" data-key="background">
              <button class="quiz-opt" onclick="selectQuizOpt(this,'background','new')">Brand new to this</button>
              <button class="quiz-opt" onclick="selectQuizOpt(this,'background','business')">Business / operations</button>
              <button class="quiz-opt" onclick="selectQuizOpt(this,'background','technical')">Developer / technical</button>
              <button class="quiz-opt" onclick="selectQuizOpt(this,'background','both')">Both worlds</button>
            </div>
          </div>

          <div class="quiz-q">
            <label>Experience with AI tools (ChatGPT, Claude, Copilot…)</label>
            <div class="quiz-options" data-key="aiExperience">
              <button class="quiz-opt" onclick="selectQuizOpt(this,'aiExperience','none')">Little to none</button>
              <button class="quiz-opt" onclick="selectQuizOpt(this,'aiExperience','some')">Use them regularly</button>
              <button class="quiz-opt" onclick="selectQuizOpt(this,'aiExperience','heavy')">Build with them</button>
            </div>
          </div>

          <div class="quiz-q">
            <label>Experience with workflow automation (Zapier, n8n, scripts…)</label>
            <div class="quiz-options" data-key="automationExperience">
              <button class="quiz-opt" onclick="selectQuizOpt(this,'automationExperience','none')">Never used any</button>
              <button class="quiz-opt" onclick="selectQuizOpt(this,'automationExperience','some')">Used some tools</button>
              <button class="quiz-opt" onclick="selectQuizOpt(this,'automationExperience','heavy')">Run automation daily</button>
            </div>
          </div>

          <div class="quiz-q">
            <label>How do you learn best?</label>
            <div class="quiz-options" data-key="learningStyle">
              <button class="quiz-opt" onclick="selectQuizOpt(this,'learningStyle','conceptual')">Explain the concept first</button>
              <button class="quiz-opt" onclick="selectQuizOpt(this,'learningStyle','examples')">Show me examples</button>
              <button class="quiz-opt" onclick="selectQuizOpt(this,'learningStyle','hands-on')">Just let me try it</button>
            </div>
          </div>
        </div>

        <button class="onboard-btn" id="onboard-start-btn" onclick="startLearning()" disabled>Start Learning →</button>
        <button class="onboard-skip" onclick="skipOnboarding()">I already know Synelium — skip</button>
      </div>

      <!-- Step 2: Adaptive learning chat -->
      <div id="onboard-step-2" style="display:none; flex-direction:column; gap:16px;">
        <div>
          <div class="onboard-logo">🎓 Aria · Your Guide</div>
          <p style="color:#555; font-size:0.78rem;">Adaptive learning session · powered by Synelium AI</p>
        </div>

        <div class="learn-thread" id="learn-thread"></div>

        <div class="chat-input-area" style="padding:0;">
          <textarea class="chat-input" id="learn-input" rows="1"
            placeholder="Ask Aria anything, or just say 'next'…"
            onkeydown="handleLearnKey(event)" oninput="autoResize(this)"></textarea>
          <button class="btn-send" id="learn-send-btn" onclick="sendLearnMessage()">Send</button>
        </div>
        <button class="onboard-skip" onclick="skipOnboarding()">Skip — take me to the dashboard</button>
      </div>

      <!-- Step 3: Graduation -->
      <div id="onboard-step-3" style="display:none;">
        <div class="onboard-grad">
          <div class="grad-icon">🚀</div>
          <h2>You're ready.</h2>
          <p>You understand how Synelium works. Click any executive card to start a real conversation and build your first workflow.</p>
          <button class="onboard-btn" onclick="enterDashboard()">Enter Dashboard →</button>
        </div>
      </div>

    </div>
  </div>

  <!-- Executive chat modal -->
  <div class="modal-overlay" id="exec-modal" onclick="closeExecOnBackdrop(event)">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-header-left">
          <div>
            <div class="modal-title" id="modal-exec-name">ECHO</div>
            <div class="modal-role" id="modal-exec-role"></div>
          </div>
        </div>
        <div class="modal-header-right">
          <button class="btn-new-chat" onclick="newChat()">New chat</button>
          <button class="modal-close" onclick="closeModal()">&#x2715;</button>
        </div>
      </div>

      <div class="chat-thread" id="chat-thread">
        <div class="empty-state" id="empty-state">
          <div class="icon">💬</div>
          <p>Ask anything — this executive will guide you to a decision.</p>
        </div>
      </div>

      <div class="workflow-banner" id="workflow-banner">
        <p>✅ Alignment reached — workflow is ready to build.</p>
        <small id="pending-decision-text"></small>
        <button class="btn-confirm" onclick="confirmWorkflow()">Build workflow in n8n →</button>
      </div>

      <div class="chat-input-area">
        <textarea class="chat-input" id="chat-input" rows="1"
          placeholder="Message..." onkeydown="handleInputKey(event)"
          oninput="autoResize(this)"></textarea>
        <button class="btn-send" id="btn-send" onclick="sendMessage()">Send</button>
      </div>
    </div>
  </div>

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
    // ── Onboarding / Learning ─────────────────────────────────────
    const PROFILE_KEY = 'synelium_user_profile';
    let userProfile = null;
    let learnSessionId = null;
    let learnWaiting = false;
    const quizAnswers = {};
    const QUIZ_KEYS = ['background', 'aiExperience', 'automationExperience', 'learningStyle'];

    (function initOnboarding() {
      try {
        const stored = localStorage.getItem(PROFILE_KEY);
        if (stored) { userProfile = JSON.parse(stored); return; }
      } catch {}
      document.getElementById('onboard-overlay').classList.add('open');
    })();

    function selectQuizOpt(el, key, val) {
      el.closest('.quiz-options').querySelectorAll('.quiz-opt').forEach(function(b) { b.classList.remove('selected'); });
      el.classList.add('selected');
      quizAnswers[key] = val;
      document.getElementById('onboard-start-btn').disabled = !QUIZ_KEYS.every(function(k) { return quizAnswers[k]; });
    }

    async function startLearning() {
      if (!QUIZ_KEYS.every(function(k) { return quizAnswers[k]; })) return;
      userProfile = Object.assign({}, quizAnswers);
      document.getElementById('onboard-step-1').style.display = 'none';
      document.getElementById('onboard-step-2').style.display = 'flex';
      // Kick off with a greeting message
      await _learnSend('Hello');
    }

    async function sendLearnMessage() {
      const input = document.getElementById('learn-input');
      const text = input.value.trim();
      if (!text) return;
      appendLearnMsg('user', text, 'You');
      input.value = '';
      autoResize(input);
      await _learnSend(text);
    }

    async function _learnSend(text) {
      if (learnWaiting) return;
      learnWaiting = true;
      document.getElementById('learn-send-btn').disabled = true;
      _learnTyping(true);

      try {
        const body = { message: text, profile: userProfile };
        if (learnSessionId) body.sessionId = learnSessionId;

        const res = await fetch('/learn/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        _learnTyping(false);
        learnSessionId = data.sessionId;

        if (data.response) appendLearnMsg('tutor', data.response, 'Aria');

        if (data.readyToExplore) {
          setTimeout(function() {
            document.getElementById('onboard-step-2').style.display = 'none';
            document.getElementById('onboard-step-3').style.display = 'block';
          }, 1200);
        }
      } catch (e) {
        _learnTyping(false);
        appendLearnMsg('tutor', 'Network error: ' + e.message, 'Aria');
      } finally {
        learnWaiting = false;
        document.getElementById('learn-send-btn').disabled = false;
        const inp = document.getElementById('learn-input');
        if (inp) inp.focus();
      }
    }

    function appendLearnMsg(role, text, label) {
      const thread = document.getElementById('learn-thread');
      const wrap = document.createElement('div');
      wrap.className = 'msg ' + (role === 'user' ? 'user' : 'exec');
      wrap.innerHTML =
        '<div class="msg-label">' + escHtml(label) + '</div>' +
        '<div class="msg-bubble">' + escHtml(text) + '</div>';
      thread.appendChild(wrap);
      thread.scrollTop = thread.scrollHeight;
    }

    function _learnTyping(show) {
      const thread = document.getElementById('learn-thread');
      const existing = document.getElementById('learn-typing');
      if (!show) { if (existing) existing.remove(); return; }
      if (existing) return;
      const el = document.createElement('div');
      el.id = 'learn-typing';
      el.className = 'msg exec';
      el.innerHTML =
        '<div class="msg-label">Aria</div>' +
        '<div class="typing-indicator"><span></span><span></span><span></span></div>';
      thread.appendChild(el);
      thread.scrollTop = thread.scrollHeight;
    }

    function handleLearnKey(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendLearnMessage(); }
    }

    function enterDashboard() {
      if (userProfile) localStorage.setItem(PROFILE_KEY, JSON.stringify(userProfile));
      document.getElementById('onboard-overlay').classList.remove('open');
    }

    function skipOnboarding() {
      // Save a minimal profile so onboarding doesn't show again
      if (!userProfile) userProfile = { background: 'both', aiExperience: 'heavy', automationExperience: 'heavy', learningStyle: 'hands-on' };
      enterDashboard();
    }

    // ── State ────────────────────────────────────────────────────
    let currentExec = '';
    let sessionId = null;
    let isWaiting = false;
    let pendingDecision = null;

    const EXEC_ROLES = {
      ECHO: 'Chief Marketing Officer',
      HARVEY: 'Chief Legal & Compliance Officer',
      ROMBUS: 'Chief Operations Officer',
      LEGCA_STEELE: 'Chief Financial Officer',
    };

    // ── Modal open / close ───────────────────────────────────────
    function openExec(name) {
      currentExec = name;
      sessionId = null;
      pendingDecision = null;
      document.getElementById('modal-exec-name').textContent = name;
      document.getElementById('modal-exec-role').textContent = EXEC_ROLES[name] || '';
      clearThread();
      hideBanner();
      document.getElementById('exec-modal').classList.add('open');
      setTimeout(() => document.getElementById('chat-input').focus(), 50);
    }

    function closeModal() {
      document.getElementById('exec-modal').classList.remove('open');
    }

    function closeExecOnBackdrop(e) {
      if (e.target.id === 'exec-modal') closeModal();
    }

    function newChat() {
      sessionId = null;
      pendingDecision = null;
      clearThread();
      hideBanner();
      document.getElementById('chat-input').focus();
    }

    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

    // ── Thread rendering ─────────────────────────────────────────
    function clearThread() {
      const thread = document.getElementById('chat-thread');
      thread.innerHTML = \`
        <div class="empty-state" id="empty-state">
          <div class="icon">💬</div>
          <p>Ask anything — this executive will guide you to a decision.</p>
        </div>\`;
    }

    function hideEmptyState() {
      const el = document.getElementById('empty-state');
      if (el) el.remove();
    }

    function appendMessage(role, text, label) {
      hideEmptyState();
      const thread = document.getElementById('chat-thread');
      const wrap = document.createElement('div');
      wrap.className = 'msg ' + role;
      wrap.innerHTML =
        '<div class="msg-label">' + escHtml(label) + '</div>' +
        '<div class="msg-bubble">' + escHtml(text) + '</div>';
      thread.appendChild(wrap);
      thread.scrollTop = thread.scrollHeight;
    }

    function showTyping() {
      hideEmptyState();
      const thread = document.getElementById('chat-thread');
      const el = document.createElement('div');
      el.id = 'typing';
      el.className = 'msg exec';
      el.innerHTML =
        '<div class="msg-label">' + escHtml(currentExec) + '</div>' +
        '<div class="typing-indicator"><span></span><span></span><span></span></div>';
      thread.appendChild(el);
      thread.scrollTop = thread.scrollHeight;
    }

    function removeTyping() {
      const el = document.getElementById('typing');
      if (el) el.remove();
    }

    function escHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    // ── Workflow banner ──────────────────────────────────────────
    function showBanner(decision) {
      pendingDecision = decision;
      document.getElementById('pending-decision-text').textContent = decision;
      document.getElementById('workflow-banner').classList.add('show');
    }

    function hideBanner() {
      document.getElementById('workflow-banner').classList.remove('show');
    }

    async function confirmWorkflow() {
      if (!sessionId || !pendingDecision) return;
      const btn = document.querySelector('.btn-confirm');
      btn.disabled = true;
      btn.textContent = 'Building…';
      try {
        const res = await fetch('/board/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Confirm — build the workflow.', sessionId, confirmWorkflow: true }),
        });
        const data = await res.json();
        if (!res.ok || data.error) {
          appendMessage('exec', 'Build failed: ' + (data.error || res.statusText), currentExec);
        } else {
          hideBanner();
          if (data.plan?.error) {
            appendMessage('exec', 'Plan built but n8n push failed: ' + data.plan.error, currentExec);
          } else {
            const summary = data.plan
              ? 'Workflow created in n8n! (' + (data.plan.workflowType || 'custom') + ', ' + (data.plan.steps?.length || 0) + ' steps)'
              : 'Workflow pushed.';
            appendMessage('exec', summary, currentExec);
            if (data.plan?.n8nWorkflow?.id) {
              appendMessage('exec', 'n8n workflow ID: ' + data.plan.n8nWorkflow.id, currentExec);
            }
          }
        }
      } catch (e) {
        appendMessage('exec', 'Build failed (network): ' + e.message, currentExec);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Build workflow in n8n →';
      }
    }

    // ── Send message ─────────────────────────────────────────────
    async function sendMessage() {
      const input = document.getElementById('chat-input');
      const text = input.value.trim();
      if (!text || isWaiting) return;

      // Show user message immediately and clear input
      appendMessage('user', text, 'You');
      input.value = '';
      autoResize(input);

      isWaiting = true;
      document.getElementById('btn-send').disabled = true;
      showTyping();

      try {
        const body = { message: text, executive: currentExec };
        if (sessionId) body.sessionId = sessionId;

        const res = await fetch('/board/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();

        removeTyping();
        sessionId = data.sessionId;

        const reply = data.responses?.[0];
        if (reply?.response) {
          appendMessage('exec', reply.response, currentExec);
        } else if (data.error) {
          appendMessage('exec', 'Error: ' + data.error, currentExec);
        }

        if (data.workflowReady && data.pendingDecision) {
          showBanner(data.pendingDecision);
        }
      } catch (e) {
        removeTyping();
        appendMessage('exec', 'Network error: ' + e.message, currentExec);
      } finally {
        isWaiting = false;
        document.getElementById('btn-send').disabled = false;
        input.focus();
      }
    }

    // ── Input helpers ────────────────────────────────────────────
    function handleInputKey(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    }

    function autoResize(el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    }

    // ── RAG ──────────────────────────────────────────────────────
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

    // ── Health auto-refresh ──────────────────────────────────────
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
