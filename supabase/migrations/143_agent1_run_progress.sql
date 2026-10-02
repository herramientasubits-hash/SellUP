-- 143_agent1_run_progress.sql
--
-- AGENT1-RUN-LIVE-PROGRESS-1 — en qué paso va una corrida del Agente 1, para que
-- el chat «Generar empresas candidatas» lo diga EN VIVO («Revisando el banco de
-- empresas», «Buscando con Apollo», «Completando con Lusha», «Guardando
-- candidatos»…).
--
-- APPLIED IN PRODUCTION: NO. (Este encabezado se escribe al autorar el PR y NO es
-- evidencia: comprobar siempre contra Produccion por el MCP numerado.)
--
-- Por que una tabla aparte y no `prospect_batches.metadata`:
--   * varios escritores componen y publican `metadata` durante la corrida (el
--     writer de candidatos, el cierre de la capa gratuita, la publicacion cercada
--     por `identity_epoch`). Un paso de progreso escrito a mitad de corrida podria
--     pisar o perder uno de esos datos;
--   * el lote todavia no existe cuando la corrida arranca (se crea perezosamente),
--     y el chat solo conoce su `client_request_id`.
--
-- Invariantes:
--   * Una fila por corrida: (created_by, client_request_id), la misma pareja que
--     ya es unica en `prospect_batches` (migracion 062).
--   * Es INFORMATIVA: nada lee esta tabla para decidir. Si una escritura falla, la
--     corrida sigue igual y el chat muestra el texto generico.
--   * Escribe solo el servidor (service_role). Quien lanzo la corrida lee SOLO su
--     propia fila (RLS por `created_by = auth.uid()`); nadie mas la ve.
--   * Sin datos de empresas ni de proveedores: solo la etapa y su rotulo.
--
-- Esta migracion NO cambia ninguna tabla ni funcion existente.

CREATE TABLE IF NOT EXISTS public.agent1_run_progress (
  created_by         uuid        NOT NULL,
  client_request_id  uuid        NOT NULL,

  -- Clave estable de la etapa (`bank`, `free_catalog`, `tavily`, `claude_review`,
  -- `apollo`, `enrichment`, `lusha`, `saving`, `done`). Abierta a proposito: una
  -- etapa nueva no exige migracion; el formato si se valida.
  stage              text        NOT NULL
    CONSTRAINT agent1_run_progress_stage_check
    CHECK (stage ~ '^[a-z][a-z0-9_]{1,40}$'),

  -- Lo que el chat muestra, ya redactado por el servidor.
  label              text        NOT NULL
    CONSTRAINT agent1_run_progress_label_check
    CHECK (char_length(label) BETWEEN 1 AND 160),

  started_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT agent1_run_progress_pkey PRIMARY KEY (created_by, client_request_id)
);

COMMENT ON TABLE public.agent1_run_progress IS
  'AGENT1-RUN-LIVE-PROGRESS-1 — etapa actual de una corrida del Agente 1 para el chat. Informativa: nada decide con ella. Escribe service_role; lee solo quien lanzo la corrida.';

-- Barrido de filas viejas sin cron: el servidor borra las de mas de un dia al
-- escribir; este indice lo hace barato.
CREATE INDEX IF NOT EXISTS agent1_run_progress_updated_at_idx
  ON public.agent1_run_progress (updated_at);

-- ─── Seguridad ──────────────────────────────────────────────────────────────────

ALTER TABLE public.agent1_run_progress ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'agent1_run_progress'
      AND policyname = 'service_role_all_agent1_run_progress'
  ) THEN
    CREATE POLICY "service_role_all_agent1_run_progress"
      ON public.agent1_run_progress FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'agent1_run_progress'
      AND policyname = 'owner_reads_own_agent1_run_progress'
  ) THEN
    CREATE POLICY "owner_reads_own_agent1_run_progress"
      ON public.agent1_run_progress FOR SELECT TO authenticated
      USING (created_by = auth.uid());
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'agent1_run_progress' AND c.relkind = 'r'
  ) THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.agent1_run_progress FROM PUBLIC';
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.agent1_run_progress FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.agent1_run_progress FROM authenticated';
      EXECUTE 'GRANT SELECT ON TABLE public.agent1_run_progress TO authenticated';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent1_run_progress TO service_role';
    END IF;
  END IF;
END $$;
