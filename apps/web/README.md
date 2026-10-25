# web — Playground del Validador Documental

React 19 + Vite + TypeScript estricto + TanStack Query + Tailwind CSS v4. Sube documentos, muestra su estado en vivo (SSE) y el resultado de la validación.

La única API es el BFF (`contracts/http.md`). Su URL se define en build con `VITE_API_URL` (por defecto `http://localhost:3000`).

## Scripts

```bash
pnpm install
pnpm dev          # Vite en http://localhost:5173 contra VITE_API_URL
pnpm dev:mock     # Vite + API simulada en http://localhost:4010 (sin BFF)
pnpm build        # tsc -b + vite build → dist/
pnpm lint
pnpm test
```

### Mock (`mock/server.mjs`)

Servidor Node sin dependencias que implementa los endpoints del BFF, incluido `GET /api/events` (SSE), y simula `QUEUED → PROCESSING → COMPLETED|FAILED`. El resultado depende del nombre del archivo: `error` → FAILED, `alterada` → totales inválidos, `vencido` → certificado vencido, `editado` → riesgo MEDIUM, `certificado`, `orden`; otro nombre sin `factura` → tipo desconocido clasificado con IA.

## Estructura

- `src/api/` — tipos derivados de los contratos, cliente HTTP (subida con XHR para el progreso) y lógica del caché ante eventos SSE.
- `src/hooks/` — queries de TanStack y `useLiveUpdates` (EventSource con reconexión; polling de respaldo cada 5 s mientras no hay conexión).
- `src/components/` — dropzone, lista, detalle (vista previa, campos, líneas, checks, autenticidad, firma, visor JSON).
- `src/test/fixtures/result.factura.json` — resultado de ejemplo; un test lo valida contra `contracts/validation-result.schema.json`.

## Docker

```bash
docker build --build-arg VITE_API_URL=http://localhost:3000 -t validador-web .
docker run -p 5173:8080 validador-web
```

Imagen `nginxinc/nginx-unprivileged` (no root) en el puerto 8080, con fallback SPA y `/healthz`.
