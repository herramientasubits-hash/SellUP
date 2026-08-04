-- Migration 105: forward-only repair of prospect_candidates.identity_key
-- A1-APOLLO-PERSISTENCE-READINESS-4 · § 5.
--
-- ¿Por qué una migración nueva y no aplicar 092?
--   La 092 (`092_add_identity_key_to_prospect_candidates.sql`) NUNCA quedó
--   registrada en `supabase_migrations.schema_migrations`, pero la 093 —que es
--   posterior y toca la MISMA tabla— sí está aplicada, y la historia remota
--   avanzó hasta la 103 (`20260803232125`). Aplicar la 092 hoy la registraría
--   con una versión mayor que la de todas sus sucesoras: la historia dejaría de
--   ser un orden. Renombrarla o marcarla a mano es peor todavía —reescribe una
--   migración histórica o miente sobre lo que se ejecutó—, así que la reparación
--   viaja hacia adelante.
--
-- Qué reproduce exactamente:
--   la semántica COMPLETA y VÁLIDA de la 092 — una columna `text` nullable más
--   un CHECK de "no vacía" marcado NOT VALID. Nada más. La 092 no crea índices,
--   no impone UNIQUE, no impone NOT NULL y no hace backfill; esta tampoco.
--
-- Por qué no se añade UNIQUE (evidencia, no preferencia):
--   la simulación read-only del backfill sobre las 253 filas actuales de
--   Producción produce 19 grupos de clave repetida (45 filas implicadas, grupo
--   mayor = 4 filas), casi todas de candidatos `discarded` del mismo dominio.
--   Un índice único fallaría al crearse. La unicidad —si algún día se quiere—
--   exige una fase propia con backfill y limpieza previos.
--
-- Por qué no se hace backfill aquí:
--   la columna existe para que el writer de Agente 1 pueble las filas NUEVAS.
--   Las 253 filas existentes quedan NULL, que es exactamente lo que la 092
--   prometía y lo que el CHECK permite (`identity_key IS NULL OR ...`).
--
-- Idempotencia:
--   la 092 usa `ADD CONSTRAINT` a secas, que en Postgres no admite
--   `IF NOT EXISTS` y falla con `duplicate_object` si la restricción ya está.
--   Aquí se guarda contra `pg_constraint`, de modo que aplicar esta migración
--   dos veces —o aplicarla en un entorno donde la 092 SÍ corrió— es inocuo.
--
-- Alcance: SOLO `identity_key`. No toca `accounts`, `prospect_batches`,
-- `provider_usage_logs`, las columnas de la 093, ni ninguna otra tabla.
-- No marca la 092 como aplicada.

ALTER TABLE public.prospect_candidates
  ADD COLUMN IF NOT EXISTS identity_key text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.prospect_candidates'::regclass
      AND conname = 'prospect_candidates_identity_key_non_empty'
  ) THEN
    ALTER TABLE public.prospect_candidates
      ADD CONSTRAINT prospect_candidates_identity_key_non_empty
      CHECK (
        identity_key IS NULL
        OR length(btrim(identity_key)) > 0
      ) NOT VALID;
  END IF;
END
$$;

COMMENT ON COLUMN public.prospect_candidates.identity_key IS
  'Q3F-5AW.2 / A1-APOLLO-PERSISTENCE-READINESS-4 — clave de identidad canónica determinística del candidato (tax: > domain: > name:), poblada por el writer de Agente 1 en filas nuevas. Nullable, sin UNIQUE y sin backfill: los datos actuales tienen claves repetidas y la unicidad exige una fase propia. Ver src/server/agents/prospecting-toolkit/prospect-candidate-identity-key.ts.';

-- PostgREST cachea el esquema: sin recargarlo, el INSERT del writer sigue
-- fallando con PGRST204 ("Could not find the 'identity_key' column ... in the
-- schema cache") aunque la columna ya exista. Es el fallo EXACTO de LIVE-QA-2.
NOTIFY pgrst, 'reload schema';
