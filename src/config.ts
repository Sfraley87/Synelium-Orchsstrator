import * as dotenv from 'dotenv';
dotenv.config();

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const config = {
  port: parseInt(optional('PORT', '3000'), 10),
  nodeEnv: optional('NODE_ENV', 'development'),

  postgres: {
    host: optional('POSTGRES_HOST', 'localhost'),
    port: parseInt(optional('POSTGRES_PORT', '5432'), 10),
    database: optional('POSTGRES_DB', 'synelium'),
    user: optional('POSTGRES_USER', 'synelium'),
    password: optional('POSTGRES_PASSWORD', 'synelium_dev'),
    // Railway injects DATABASE_URL; prefer it if present
    connectionString: process.env.DATABASE_URL,
  },

  chroma: {
    path: optional('CHROMA_PATH', 'http://localhost:8000'),
  },

  openai: {
    apiKey: optional('OPENAI_API_KEY', ''),
  },

  anthropic: {
    apiKey: optional('ANTHROPIC_API_KEY', ''),
  },

  engines: {
    n8n: {
      endpoint: optional('N8N_ENDPOINT', 'http://localhost:5678'),
      apiKey: optional('N8N_API_KEY', ''),
    },
    prefect: {
      endpoint: optional('PREFECT_ENDPOINT', 'http://localhost:4200'),
      apiKey: optional('PREFECT_API_KEY', ''),
    },
    triggerDev: {
      endpoint: optional('TRIGGER_DEV_ENDPOINT', ''),
      apiKey: optional('TRIGGER_DEV_API_KEY', ''),
    },
    langGraph: {
      endpoint: optional('LANGRAPH_ENDPOINT', ''),
      apiKey: optional('LANGRAPH_API_KEY', ''),
    },
  },
} as const;

export type Config = typeof config;
