import { z } from 'zod';

/**
 * Variables de entorno del servicio. Se validan al arrancar: si falta algo o tiene
 * un formato inválido, el proceso termina con un mensaje claro (12-factor).
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  PORT: z.coerce.number().int().positive().default(3100),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatoria'),
  RABBITMQ_URL: z.string().min(1, 'RABBITMQ_URL es obligatoria'),
  AZURE_STORAGE_CONNECTION_STRING: z.string().min(1, 'AZURE_STORAGE_CONNECTION_STRING es obligatoria'),
  BLOB_CONTAINER: z.string().min(3).default('documents'),
  MAX_FILE_SIZE_MB: z.coerce.number().positive().max(200).default(20),
  MAX_FILES: z.coerce.number().int().min(1).max(50).default(10),
  RESULTS_PREFETCH: z.coerce.number().int().min(1).max(500).default(10),
  OUTBOX_INTERVAL_MS: z.coerce.number().int().min(50).default(500),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(50),
  PUBLISH_TIMEOUT_MS: z.coerce.number().int().min(100).default(5000),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const detalle = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuración inválida:\n${detalle}`);
  }
  return parsed.data;
}
