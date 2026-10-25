import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

/** Variables de entorno del BFF, validadas al arrancar. */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DOCUMENTS_SERVICE_URL: z.url('DOCUMENTS_SERVICE_URL debe ser una URL'),
  RABBITMQ_URL: z.string().min(1, 'RABBITMQ_URL es obligatoria'),
  CORS_ORIGIN: z.string().min(1, 'CORS_ORIGIN es obligatoria (lista separada por comas)'),
  MAX_FILE_SIZE_MB: z.coerce.number().positive().default(20),
  MAX_FILES: z.coerce.number().int().min(1).default(10),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().min(100).default(5000),
  UPLOAD_TIMEOUT_MS: z.coerce.number().int().min(1000).default(120000),
  UPSTREAM_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(300),
  SSE_PING_MS: z.coerce.number().int().min(1000).default(25000),
  AUTH_ENABLED: bool,
  TRUST_PROXY: bool,
  INSTANCE_ID: z.string().optional(),
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
