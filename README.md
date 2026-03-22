# Synelium — The AI Operating System for Enterprises

![TypeScript](https://img.shields.io/badge/Language-TypeScript-3178C6?style=flat-square)
![Node](https://img.shields.io/badge/Runtime-Node%2020-339933?style=flat-square)
![Claude](https://img.shields.io/badge/LLM-Claude%20Sonnet-8A2BE2?style=flat-square)
![n8n](https://img.shields.io/badge/Engine-n8n-orange?style=flat-square)
![Prefect](https://img.shields.io/badge/Engine-Prefect-blue?style=flat-square)
![pgvector](https://img.shields.io/badge/Memory-pgvector-336791?style=flat-square)
![ChromaDB](https://img.shields.io/badge/Memory-ChromaDB-teal?style=flat-square)
![Railway](https://img.shields.io/badge/Deploy-Railway-0B0D0E?style=flat-square)

---

## The Idea

Most companies know they need AI. What they don't know is how to operationalize it — not as a chatbot bolted onto a product, but as embedded intelligence that actually runs business functions.

Synelium is the infrastructure layer that makes that possible. It gives mid-market companies a **board of AI executives** — each with a domain, a persona, a memory, and the authority to make decisions and trigger real automation.

When the CFO agent decides something needs to happen, a sub-agent builds the workflow and pushes it to n8n. When the CMO agent reaches alignment with a user, it emits a signal that kicks off a campaign pipeline. The humans stay in the loop. The machines do the work.

**This is not a demo. It's a platform.**

---

## Architecture

```
                    ┌─────────────────────────────────────────┐
                    │           Synelium Orchestrator          │
                    │              (Express / TypeScript)       │
                    └──────────────────────┬──────────────────┘
                                           │
              ┌────────────────────────────┼───────────────────────────┐
              │                            │                           │
    ┌─────────▼──────────┐    ┌────────────▼──────────┐   ┌───────────▼──────────┐
    │   AI Executive       │    │  Orchestration Router  │   │    RAG System         │
    │   Registry           │    │  + Policy Brain        │   │  pgvector / ChromaDB  │
    │                      │    │  (GDPR, HIPAA, SOX,    │   │  + OpenAI embeddings  │
    │  ECHO   (CMO)        │    │   PCI-DSS)             │   └───────────────────────┘
    │  HARVEY (CLO)        │    └────────────┬───────────┘
    │  ROMBUS (COO)        │                 │
    │  LEGCA  (CFO)        │    ┌────────────▼───────────┐
    └─────────┬────────────┘    │   Engine Adapter Layer  │
              │                 │                         │
              │                 │  n8n  │  Prefect        │
              │                 │  Trigger.dev │ LangGraph │
              │                 └────────────┬────────────┘
              │                              │
    ┌─────────▼──────────┐                   │
    │   Sub-Agent Layer   │◄──────────────────┘
    │                     │
    │  Decision → Workflow │
    │  Plan → n8n Push    │
    └─────────────────────┘
```

### How a Conversation Becomes Automation

1. User chats with an executive (e.g. ECHO, the CMO)
2. Executive reasons through the decision using session memory + RAG context
3. When alignment is reached, the executive emits `[[WORKFLOW_READY: <decision>]]`
4. The system surfaces a confirmation UI — human approves
5. A department sub-agent calls Claude to generate a full n8n workflow JSON
6. The workflow is pushed live to n8n via the adapter layer
7. The human opens n8n and sees a ready-to-activate workflow

---

## AI Executives

Each executive runs on Claude Sonnet, has a named persona, a domain-specific system prompt, and bounded conversation behavior. They are designed to be direct, make decisions, and emit workflow signals — not ask endless clarifying questions.

| Executive | Role | Persona Influence |
|-----------|------|-------------------|
| **ECHO** | Chief Marketing Officer | Seth Godin, Simon Sinek, Byron Sharp |
| **HARVEY** | Chief Legal & Compliance Officer | Harvey Specter style, real legal expertise |
| **ROMBUS** | Chief Operations Officer | Jeff Bezos, Deming, Goldratt (Theory of Constraints) |
| **LEGCA STEELE** | Chief Financial Officer | Warren Buffett, Charlie Munger, Ben Graham |

All four can participate in a board discussion — round 1 gives independent takes, round 2 has each executive respond to the others.

---

## Policy Brain

Every task routed through the system passes through a compliance rule engine before it reaches an automation engine. Rules include GDPR data locality, HIPAA PHI routing, SOX audit trail enforcement, and PCI-DSS payment data isolation. Tasks that fail a policy check are blocked with a reason — they never reach n8n or Prefect.

---

## Engine Adapters

The orchestrator is engine-agnostic. It scores available engines based on task type, latency requirements, and compliance constraints, then routes to the best fit. Current adapters:

- **n8n** — full CRUD + trigger + activate/deactivate (production-ready)
- **Prefect** — trigger + status polling (production-ready)
- **Trigger.dev** — stub (integration planned)
- **LangGraph** — stub (integration planned)

---

## RAG System

Executives query a knowledge base before responding. The RAG system supports two backends — ChromaDB (primary) and pgvector (fallback) — with automatic failover. Documents are chunked, embedded via OpenAI's `text-embedding-3-small`, and retrieved by semantic similarity at query time.

---

## Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 20 + TypeScript |
| Framework | Express 5 |
| LLM | Anthropic Claude Sonnet (`@anthropic-ai/sdk`) |
| Secondary LLM | OpenAI (`openai`) |
| Vector DB (primary) | ChromaDB |
| Vector DB (fallback) | PostgreSQL + pgvector |
| Workflow engine | n8n, Prefect |
| Containerization | Docker + docker-compose |
| Deployment | Railway (Nixpacks) |
| Testing | Jest + Supertest |

---

## Running Locally

### Prerequisites
- Node 20+
- Docker (for PostgreSQL + ChromaDB + n8n + Prefect)

### Setup

```bash
git clone https://github.com/yourusername/synelium
cd synelium
npm install
cp .env.example .env
# Fill in OPENAI_API_KEY and ANTHROPIC_API_KEY in .env
docker compose up -d
npm run build
npm start
```

The dashboard runs at `http://localhost:3000/dashboard`.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `OPENAI_API_KEY` | Yes | OpenAI embeddings |
| `DATABASE_URL` | No | Postgres connection string (Railway injects this) |
| `N8N_ENDPOINT` | No | Defaults to `http://localhost:5678` |
| `CHROMA_PATH` | No | Defaults to `http://localhost:8000` |

---

## API Reference

### Board Chat
```
POST /board/chat
{ "message": "...", "executive": "ECHO", "sessionId": "optional" }
```

### Confirm a Workflow
```
POST /board/chat
{ "message": "confirm", "sessionId": "...", "confirmWorkflow": true }
```

### Board Discussion (all executives)
```
POST /board/discuss
{ "topic": "Should we expand into LATAM?" }
```

### Route a Task
```
POST /task
{ "type": "marketing", "prompt": "...", "metadata": { "complianceFlags": ["GDPR"] } }
```

### n8n Workflow Management
```
GET    /n8n/workflows
POST   /n8n/workflows
PUT    /n8n/workflows/:id
POST   /n8n/workflows/:id/activate
DELETE /n8n/workflows/:id
```

### RAG
```
POST /rag/ingest  { "text": "...", "metadata": {} }
POST /rag/query   { "question": "...", "topK": 3 }
```

---

## Testing

```bash
npm test
```

Test coverage includes unit tests for the executive session layer (including a regression test for the conversation history double-append bug), adapter tests with mocked Axios, and integration tests for all n8n routes and board chat endpoints.

---

## Deployment

Configured for Railway via `railway.json`. The build step runs `tsc`, start runs `node dist/index.js`. Health check at `/health`. PostgreSQL and ChromaDB are provisioned as Railway services.

---

## About

Built by **Shaun** — AI Automation Architect at [Synelium](https://synelium.com)

Synelium designs and deploys AI-powered automation infrastructure for mid-market businesses. This platform is the flagship product — agent orchestration and governance infrastructure for companies that need AI embedded in operations, not bolted on top.

→ More projects: https://github.com/Sfraley87
→ Connect: www.linkedin.com/in/shaun-fraley-41a0b9132

