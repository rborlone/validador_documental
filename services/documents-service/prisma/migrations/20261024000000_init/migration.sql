-- Migración inicial: documentos y outbox transaccional.

CREATE TYPE "document_status" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "container" TEXT NOT NULL,
    "blob_name" TEXT NOT NULL,
    "status" "document_status" NOT NULL DEFAULT 'QUEUED',
    "expected_type" TEXT,
    "document_type" TEXT,
    "verdict" TEXT,
    "result" JSONB,
    "error" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "correlation_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "documents_created_at_idx" ON "documents" ("created_at" DESC);
-- Índice GIN para consultas sobre el resultado extraído (p. ej. result @> '{"verdict":"VALID"}').
CREATE INDEX "documents_result_gin_idx" ON "documents" USING GIN ("result" jsonb_path_ops);

CREATE TABLE "outbox" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "routing_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "correlation_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "outbox_pending_idx" ON "outbox" ("created_at");
-- Índice parcial: el relay solo busca filas pendientes.
CREATE INDEX "outbox_unpublished_idx" ON "outbox" ("next_attempt_at", "created_at") WHERE "published_at" IS NULL;
