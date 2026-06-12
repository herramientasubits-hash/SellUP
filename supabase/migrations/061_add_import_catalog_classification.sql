-- ============================================================
-- Migration 061: Persist canonical import classification on candidates
-- Hito 16AB.38 — Persistence migration for catalog-aware import
-- ============================================================
-- Adds classification columns to prospect_candidates and
-- prospect_batches to persist:
--   • the catalog version used at import time;
--   • the canonical industry and subindustry references;
--   • the full classification trace from the normalizer (16AB.37).
--
-- Aditiva. Sin DML. Sin backfill. Sin defaults que clasifiquen
-- filas legacy. Compatible con todas las filas existentes.
--
-- Tablas modificadas:
--   public.prospect_candidates  — 5 columnas nuevas
--   public.prospect_batches     — 1 columna nueva
--
-- Tabla modificada (constraint auxiliar):
--   public.subindustries        — UNIQUE(id, industry_id, catalog_version_id)
--
-- Prerequisitos (ya aplicados):
--   057_create_versioned_industry_catalog.sql
--   060_seed_industry_catalog_v1.sql
-- ============================================================


-- ============================================================
-- SECCIÓN 1: Unique constraint auxiliar en subindustries
-- ============================================================
-- Requerida para la FK compuesta triple desde prospect_candidates.
-- (id, industry_id, catalog_version_id) expone la clave candidata
-- que garantiza: ID correcto + industria padre correcta +
-- misma versión del catálogo.
--
-- id ya es PK (único), por lo que (id, industry_id, catalog_version_id)
-- es inherentemente único para todos los registros existentes.
-- La constraint lo hace referenciable por FK compuesta.
--
-- Esta es una DDL; los triggers de inmutabilidad del catálogo
-- (protect_immutable_catalog_content) aplican solo a DML
-- y no se activan durante la validación de esta constraint.
-- ============================================================

ALTER TABLE public.subindustries
  ADD CONSTRAINT subindustries_id_industry_version_uniq
    UNIQUE (id, industry_id, catalog_version_id);

COMMENT ON CONSTRAINT subindustries_id_industry_version_uniq ON public.subindustries IS
  'Clave candidata compuesta para FK triple desde prospect_candidates. '
  'Garantiza que una referencia de subindustria desde un candidato '
  'corresponde al ID correcto, la industria padre correcta y la misma '
  'versión del catálogo. Complementa subindustries_industry_version_fk.';


-- ============================================================
-- SECCIÓN 2: prospect_batches — catalog_version
-- ============================================================
-- Snapshot textual de la versión del catálogo usada en la
-- importación del lote.
--
-- Tipo TEXT (no UUID): el string de versión se preserva para
-- trazabilidad incluso si la versión del catálogo es archivada.
-- No es FK. El registro histórico de qué versión se usó debe
-- sobrevivir a cambios de estado del catálogo.
--
-- NULL para lotes creados antes de la integración con catálogo.
-- ============================================================

ALTER TABLE public.prospect_batches
  ADD COLUMN IF NOT EXISTS catalog_version TEXT NULL;

COMMENT ON COLUMN public.prospect_batches.catalog_version IS
  'String de versión del catálogo de industrias usado durante la importación '
  'de este lote (ej. "v1.0.0"). NULL para lotes importados antes de la '
  'integración con el catálogo. Snapshot textual: se preserva aunque la '
  'versión del catálogo sea archivada posteriormente.';


-- ============================================================
-- SECCIÓN 3: prospect_candidates — cinco columnas nuevas
-- ============================================================
-- Orden: primero todas las columnas (ADD COLUMN), luego FKs
-- compuestas (ADD CONSTRAINT) que referencian múltiples columnas
-- ya existentes en la tabla.
-- ============================================================

-- ── 3a. catalog_version_id ────────────────────────────────────
-- FK simple a industry_catalog_versions.
-- Ancla técnica que permite las FKs compuestas de secciones 4b y 4c.
-- Sin ella, la coherencia de versión entre industry_id y
-- subindustry_id solo sería verificable a nivel de aplicación.
-- NULL para candidatos importados antes de la integración.
ALTER TABLE public.prospect_candidates
  ADD COLUMN IF NOT EXISTS catalog_version_id UUID NULL
    REFERENCES public.industry_catalog_versions(id) ON DELETE RESTRICT;

-- ── 3b. industry_id ───────────────────────────────────────────
-- Referencia canónica a la industria del catálogo.
-- La FK compuesta (industry_id, catalog_version_id) se agrega
-- como constraint separada en sección 4b.
-- NULL si no fue encontrada o no fue proporcionada en la importación.
ALTER TABLE public.prospect_candidates
  ADD COLUMN IF NOT EXISTS industry_id UUID NULL;

-- ── 3c. subindustry ───────────────────────────────────────────
-- Snapshot del nombre canónico de subindustria (para display).
-- Análogo al patrón industry (TEXT display) / industry_id (FK canónica).
-- El valor original del archivo queda en import_classification.subindustryOriginalValue.
-- NULL si la subindustria no fue resuelta o no fue proporcionada.
ALTER TABLE public.prospect_candidates
  ADD COLUMN IF NOT EXISTS subindustry TEXT NULL;

-- ── 3d. subindustry_id ────────────────────────────────────────
-- Referencia canónica a la subindustria del catálogo.
-- La FK compuesta triple se agrega como constraint en sección 4c.
-- NULL si no fue encontrada o no fue proporcionada en la importación.
ALTER TABLE public.prospect_candidates
  ADD COLUMN IF NOT EXISTS subindustry_id UUID NULL;

-- ── 3e. import_classification ─────────────────────────────────
-- Snapshot estructurado de trazabilidad del normalizador 16AB.37.
-- Almacena ImportedProspectClassification (ver import-classification-types.ts):
--   originalValues, matchStatuses, matchSources, catalogVersion,
--   warnings, requiresHumanReview.
-- Los valores originales (industryOriginalValue, subindustryOriginalValue)
-- son inmutables desde la ingesta y nunca se sobreescriben.
-- NULL para candidatos no creados vía importación con catálogo.
ALTER TABLE public.prospect_candidates
  ADD COLUMN IF NOT EXISTS import_classification JSONB NULL;


-- ============================================================
-- SECCIÓN 4: Foreign keys compuestas
-- ============================================================

-- ── 4b. (industry_id, catalog_version_id) → industries ───────
-- Garantiza a nivel DB que la industria referenciada pertenece
-- exactamente a la versión del catálogo registrada en el candidato.
-- Previene asignaciones cross-version de industria.
-- Reutiliza industries_id_version_uniq (migration 057).
ALTER TABLE public.prospect_candidates
  ADD CONSTRAINT pc_industry_version_fk
    FOREIGN KEY (industry_id, catalog_version_id)
    REFERENCES public.industries(id, catalog_version_id)
    ON DELETE RESTRICT;

-- ── 4c. (subindustry_id, industry_id, catalog_version_id) → subindustries
-- Triple garantía de integridad:
--   1. ID de subindustria correcto;
--   2. industria padre correcta (el ID de industria debe coincidir);
--   3. misma versión del catálogo.
-- Previene asignaciones cross-industry y cross-version de subindustria.
-- Reutiliza subindustries_id_industry_version_uniq (esta migración, sección 1).
ALTER TABLE public.prospect_candidates
  ADD CONSTRAINT pc_subindustry_industry_version_fk
    FOREIGN KEY (subindustry_id, industry_id, catalog_version_id)
    REFERENCES public.subindustries(id, industry_id, catalog_version_id)
    ON DELETE RESTRICT;


-- ============================================================
-- SECCIÓN 5: Check constraints de coherencia y compatibilidad legacy
-- ============================================================

-- ── Industria requiere versión ────────────────────────────────
-- Si industry_id está definida, catalog_version_id es obligatoria.
-- Una FK de industria sin versión sería una referencia sin contexto
-- de versión explícito en el candidato.
ALTER TABLE public.prospect_candidates
  ADD CONSTRAINT pc_industry_requires_version
    CHECK (industry_id IS NULL OR catalog_version_id IS NOT NULL);

-- ── Subindustria requiere industria y versión ─────────────────
-- Si subindustry_id está definida, industry_id y catalog_version_id
-- son obligatorias. Invariante del modelo de clasificación:
-- una subindustria no puede existir sin su industria padre.
ALTER TABLE public.prospect_candidates
  ADD CONSTRAINT pc_subindustry_requires_industry
    CHECK (
      subindustry_id IS NULL
      OR (industry_id IS NOT NULL AND catalog_version_id IS NOT NULL)
    );

-- ── Trazabilidad requiere versión ─────────────────────────────
-- Si import_classification está presente, catalog_version_id es
-- obligatoria. El snapshot de trazabilidad carece de referencia
-- canónica de versión sin este campo.
ALTER TABLE public.prospect_candidates
  ADD CONSTRAINT pc_classification_requires_version
    CHECK (import_classification IS NULL OR catalog_version_id IS NOT NULL);

-- ── JSONB debe ser objeto ─────────────────────────────────────
-- El snapshot de trazabilidad es un objeto. No se acepta escalar
-- ni array en la raíz; eso sería un contrato roto con el normalizador.
ALTER TABLE public.prospect_candidates
  ADD CONSTRAINT pc_import_classification_is_object
    CHECK (
      import_classification IS NULL
      OR jsonb_typeof(import_classification) = 'object'
    );

-- ── requiresHumanReview debe ser booleano ────────────────────
-- El campo requiresHumanReview es semántico: controla si el
-- candidato requiere revisión manual. Un valor no booleano
-- sería un error silencioso de alto impacto.
ALTER TABLE public.prospect_candidates
  ADD CONSTRAINT pc_classification_review_bool
    CHECK (
      import_classification IS NULL
      OR import_classification->'requiresHumanReview' IS NULL
      OR jsonb_typeof(import_classification->'requiresHumanReview') = 'boolean'
    );

-- ── classificationWarnings debe ser array ────────────────────
-- El campo classificationWarnings es iterado por la UI y el API.
-- Un valor no-array causaría errores silenciosos al procesarlo.
ALTER TABLE public.prospect_candidates
  ADD CONSTRAINT pc_classification_warnings_array
    CHECK (
      import_classification IS NULL
      OR import_classification->'classificationWarnings' IS NULL
      OR jsonb_typeof(import_classification->'classificationWarnings') = 'array'
    );


-- ============================================================
-- SECCIÓN 6: Índices
-- ============================================================

-- Candidatos por versión de catálogo
-- Consultas: "todos los candidatos importados con el catálogo v1.0.0"
-- Parcial WHERE: excluye filas legacy (NULL), índice pequeño y enfocado.
CREATE INDEX IF NOT EXISTS idx_pc_catalog_version_id
  ON public.prospect_candidates (catalog_version_id)
  WHERE catalog_version_id IS NOT NULL;

-- Candidatos por industria canónica
-- Patrón de acceso principal de la UI: lista de prospectos filtrada
-- por industria del catálogo. Parcial WHERE: excluye no clasificados.
CREATE INDEX IF NOT EXISTS idx_pc_industry_id
  ON public.prospect_candidates (industry_id)
  WHERE industry_id IS NOT NULL;

-- Candidatos por subindustria canónica
-- Filtro más granular que industry_id.
-- Parcial WHERE: excluye no clasificados.
CREATE INDEX IF NOT EXISTS idx_pc_subindustry_id
  ON public.prospect_candidates (subindustry_id)
  WHERE subindustry_id IS NOT NULL;


-- ============================================================
-- SECCIÓN 7: Comentarios de columna
-- ============================================================

COMMENT ON COLUMN public.prospect_candidates.catalog_version_id IS
  'FK a industry_catalog_versions. Versión del catálogo activa cuando '
  'este candidato fue importado. NULL para candidatos de antes de la '
  'integración con catálogo. Ancla técnica para las FKs compuestas '
  'pc_industry_version_fk y pc_subindustry_industry_version_fk. '
  'Debe estar definida cuando industry_id o import_classification están definidas.';

COMMENT ON COLUMN public.prospect_candidates.industry_id IS
  'UUID canónico de la industria del catálogo. FK compuesta (con '
  'catalog_version_id) → industries(id, catalog_version_id). '
  'NULL si no fue encontrada o no fue proporcionada en la importación. '
  'catalog_version_id debe estar definida cuando este campo está definido. '
  'El nombre legible está en import_classification.industryName como snapshot.';

COMMENT ON COLUMN public.prospect_candidates.subindustry IS
  'Snapshot del nombre canónico de subindustria del catálogo (para display). '
  'Análogo al campo industry (TEXT display) vs subindustry_id (FK canónica). '
  'NULL si no fue resuelta. El valor original del archivo importado queda '
  'preservado en import_classification.subindustryOriginalValue.';

COMMENT ON COLUMN public.prospect_candidates.subindustry_id IS
  'UUID canónico de la subindustria del catálogo. FK compuesta triple '
  '(con industry_id y catalog_version_id) → subindustries. '
  'NULL si no fue encontrada o no fue proporcionada. '
  'industry_id y catalog_version_id deben estar definidas cuando este campo está definido.';

COMMENT ON COLUMN public.prospect_candidates.import_classification IS
  'Snapshot estructurado de trazabilidad del normalizador determinístico '
  '(Hito 16AB.37). Almacena ImportedProspectClassification: '
  'industryOriginalValue, subindustryOriginalValue (inmutables desde la ingesta), '
  'industryMatchStatus, subindustryMatchStatus, classificationSource, '
  'catalogVersion, classificationWarnings, requiresHumanReview. '
  'NULL para candidatos no creados vía importación con catálogo. '
  'catalog_version_id debe estar definida cuando este campo está definido.';
