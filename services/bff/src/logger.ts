import type { Params } from 'nestjs-pino';
import { resolveCorrelationId } from './common/correlation';

/** Logs JSON con pino. Cada línea del request incluye `correlationId`. */
export function loggerParams(level: string, service: string): Params {
  return {
    pinoHttp: {
      level,
      base: { service },
      genReqId: resolveCorrelationId,
      // correlationId en todas las líneas emitidas dentro del request (nestjs-pino usa AsyncLocalStorage).
      customProps: (req) => ({ correlationId: (req as { id?: unknown }).id }),
      messageKey: 'message',
      // Nivel como texto ("info", "error") para los agregadores de logs.
      formatters: { level: (label: string) => ({ level: label }) },
      // Las probes generan mucho ruido: solo se registran si fallan.
      autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/health') },
      redact: { paths: ['req.headers.authorization', 'req.headers.cookie'], remove: true },
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({ method: req.method, url: req.url }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    },
  };
}
