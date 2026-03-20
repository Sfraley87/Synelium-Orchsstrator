import { ChromaClient, Collection } from 'chromadb';
import { OpenAI } from 'openai';
import { Pool } from 'pg';
import { config } from '../config';

// ── Types ────────────────────────────────────────────────────────────────────

export interface IngestRequest {
  text: string;
  metadata?: Record<string, string>;
  id?: string;
}

export interface QueryRequest {
  question: string;
  topK?: number;
}

export interface QueryResult {
  context: string;
  sources: Array<{ id: string; text: string; metadata: Record<string, string>; score: number }>;
}

// ── RAG System ───────────────────────────────────────────────────────────────

const COLLECTION_NAME = 'synelium-knowledge';
const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + CHUNK_SIZE));
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
}

export class RagSystem {
  private chroma: ChromaClient;
  private openai: OpenAI | null;
  private pg: Pool | null;
  private collection: Collection | null = null;
  private useChroma = true;

  constructor() {
    this.chroma = new ChromaClient({ path: config.chroma.path });
    this.openai = config.openai.apiKey ? new OpenAI({ apiKey: config.openai.apiKey }) : null;

    const pgConfig = config.postgres.connectionString
      ? {
          connectionString: config.postgres.connectionString,
          ssl: { rejectUnauthorized: false }, // required for Railway-managed Postgres
        }
      : {
          host: config.postgres.host,
          port: config.postgres.port,
          database: config.postgres.database,
          user: config.postgres.user,
          password: config.postgres.password,
        };
    this.pg = new Pool(pgConfig);
  }

  async init(): Promise<void> {
    // Never throw — RAG unavailability must not prevent server startup
    try {
      this.collection = await this.chroma.getOrCreateCollection({ name: COLLECTION_NAME });
      this.useChroma = true;
      console.log('[rag] ChromaDB connected, collection:', COLLECTION_NAME);
    } catch (err) {
      console.warn('[rag] ChromaDB unavailable, trying pgvector:', (err as Error).message);
      this.useChroma = false;
      await this.initPgVector();
    }
  }

  private async initPgVector(): Promise<void> {
    try {
      await this.pg!.query(`
        CREATE EXTENSION IF NOT EXISTS vector;
        CREATE TABLE IF NOT EXISTS rag_documents (
          id TEXT PRIMARY KEY,
          content TEXT NOT NULL,
          embedding vector(1536),
          metadata JSONB DEFAULT '{}'
        );
      `);
      console.log('[rag] pgvector table ready');
    } catch (err) {
      console.warn('[rag] pgvector unavailable, RAG disabled:', (err as Error).message);
      // Drain the pool so it doesn't hold open connections
      try { await this.pg?.end(); } catch {}
      this.pg = null;
    }
  }

  private async embed(text: string): Promise<number[]> {
    if (!this.openai) return Array(1536).fill(0); // zero vector fallback (no API key)
    const res = await this.openai.embeddings.create({ model: 'text-embedding-3-small', input: text });
    return res.data[0].embedding;
  }

  async ingest(req: IngestRequest): Promise<{ ids: string[] }> {
    const chunks = chunkText(req.text);
    const ids: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const id = req.id ? `${req.id}-chunk-${i}` : `doc-${Date.now()}-${i}`;
      const chunk = chunks[i];

      if (this.useChroma && this.collection) {
        const embedding = await this.embed(chunk);
        await this.collection.add({
          ids: [id],
          embeddings: [embedding],
          documents: [chunk],
          metadatas: [req.metadata ?? {}],
        });
      } else if (this.pg) {
        const embedding = await this.embed(chunk);
        await this.pg.query(
          `INSERT INTO rag_documents (id, content, embedding, metadata)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO UPDATE SET content = $2, embedding = $3, metadata = $4`,
          [id, chunk, JSON.stringify(embedding), JSON.stringify(req.metadata ?? {})]
        );
      }
      ids.push(id);
    }

    return { ids };
  }

  async query(req: QueryRequest): Promise<QueryResult> {
    const topK = req.topK ?? 3;
    const embedding = await this.embed(req.question);

    if (this.useChroma && this.collection) {
      const results = await this.collection.query({
        queryEmbeddings: [embedding],
        nResults: topK,
      });

      const sources = (results.ids[0] ?? []).map((id, i) => ({
        id,
        text: results.documents[0]?.[i] ?? '',
        metadata: (results.metadatas[0]?.[i] as Record<string, string>) ?? {},
        score: results.distances?.[0]?.[i] ?? 0,
      }));

      return {
        context: sources.map((s) => s.text).join('\n\n'),
        sources,
      };
    } else if (this.pg) {
      const res = await this.pg.query(
        `SELECT id, content, metadata,
                embedding <=> $1::vector AS distance
         FROM rag_documents
         ORDER BY distance ASC
         LIMIT $2`,
        [JSON.stringify(embedding), topK]
      );
      const sources = res.rows.map((row) => ({
        id: row.id,
        text: row.content,
        metadata: row.metadata ?? {},
        score: row.distance,
      }));
      return { context: sources.map((s) => s.text).join('\n\n'), sources };
    }

    return { context: '', sources: [] };
  }

  async isHealthy(): Promise<boolean> {
    try {
      if (this.useChroma) {
        await this.chroma.listCollections();
        return true;
      }
      await this.pg!.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}

export const ragSystem = new RagSystem();
