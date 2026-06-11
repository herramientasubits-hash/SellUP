-- ============================================================
-- Migration 057: Catálogo de industrias y subindustrias versionado
-- Hito 16AB.28 — Migration A
-- ============================================================
-- Crea el modelo de catálogo DB-driven, versionado, configurable
-- y trazable para el módulo Generar con IA.
--
-- Tablas creadas:
--   industry_catalog_versions  — ciclo de vida del catálogo
--   industries                 — industrias por versión
--   subindustries              — subindustrias por industria y versión
--   subindustry_aliases        — aliases y nombres alternativos
--   subindustry_search_terms   — términos y frases de búsqueda
--   subindustry_rules          — reglas configurables por subindustria
--
-- No modifica tablas existentes. Sin datos de producción.
-- Prerequisito de Migration B (prospect_batches / lotes).
-- ============================================================


-- ============================================================
-- SECCIÓN 1: industry_catalog_versions
-- ============================================================
-- Versión publicable e inmutable del catálogo.
-- Ciclo de vida: draft → published → archived.
-- Solo puede existir una versión en estado 'published' a la vez
-- (garantizado por índice único parcial).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.industry_catalog_versions (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    version         TEXT        NOT NULL,
    status          TEXT        NOT NULL DEFAULT 'draft',
    name            TEXT,
    description     TEXT,
    published_at    TIMESTAMPTZ,
    archived_at     TIMESTAMPTZ,
    created_by      UUID        REFERENCES public.internal_users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT icv_status_valid
        CHECK (status IN ('draft', 'published', 'archived')),
    CONSTRAINT icv_version_not_empty
        CHECK (trim(version) <> ''),
    CONSTRAINT icv_published_at_when_published
        CHECK (status <> 'published' OR published_at IS NOT NULL),
    CONSTRAINT icv_archived_at_when_archived
        CHECK (status <> 'archived' OR archived_at IS NOT NULL)
);

-- Identificador de versión único a nivel global
CREATE UNIQUE INDEX IF NOT EXISTS idx_icv_version_unique
    ON public.industry_catalog_versions (version);

-- Solo puede existir una versión publicada a la vez
CREATE UNIQUE INDEX IF NOT EXISTS idx_icv_single_published
    ON public.industry_catalog_versions (status)
    WHERE status = 'published';

-- Consultas por estado (draft, published, archived)
CREATE INDEX IF NOT EXISTS idx_icv_status
    ON public.industry_catalog_versions (status);

DROP TRIGGER IF EXISTS industry_catalog_versions_set_updated_at
    ON public.industry_catalog_versions;
CREATE TRIGGER industry_catalog_versions_set_updated_at
    BEFORE UPDATE ON public.industry_catalog_versions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE public.industry_catalog_versions IS
    'Versiones publicables e inmutables del catálogo de industrias. Ciclo: draft → published → archived.';
COMMENT ON COLUMN public.industry_catalog_versions.version IS
    'Identificador de versión único (p.ej. v1.0, v2.0).';
COMMENT ON COLUMN public.industry_catalog_versions.status IS
    'Estado del ciclo de vida: draft (editable) → published (inmutable, activo) → archived (inmutable, histórico).';


-- ============================================================
-- SECCIÓN 2: industries
-- ============================================================
-- La constraint UNIQUE(id, catalog_version_id) es requisito
-- estructural: permite a subindustries declarar una FK compuesta
-- que garantiza coherencia de versión entre padre e hijo.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.industries (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    catalog_version_id  UUID        NOT NULL
        REFERENCES public.industry_catalog_versions(id) ON DELETE RESTRICT,
    name                TEXT        NOT NULL,
    slug                TEXT        NOT NULL,
    description         TEXT,
    active              BOOLEAN     NOT NULL DEFAULT true,
    sort_order          INTEGER     NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT industries_slug_not_empty        CHECK (trim(slug) <> ''),
    CONSTRAINT industries_name_not_empty        CHECK (trim(name) <> ''),
    CONSTRAINT industries_sort_order_nn         CHECK (sort_order >= 0),
    -- Clave compuesta requerida para FK cruzada desde subindustries
    CONSTRAINT industries_id_version_uniq       UNIQUE (id, catalog_version_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_industries_version_slug
    ON public.industries (catalog_version_id, slug);

CREATE UNIQUE INDEX IF NOT EXISTS idx_industries_version_name
    ON public.industries (catalog_version_id, name);

-- Consultas por versión + estado activo + orden: lista del catálogo
CREATE INDEX IF NOT EXISTS idx_industries_version_active_sort
    ON public.industries (catalog_version_id, active, sort_order);

DROP TRIGGER IF EXISTS industries_set_updated_at ON public.industries;
CREATE TRIGGER industries_set_updated_at
    BEFORE UPDATE ON public.industries
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE public.industries IS
    'Industrias pertenecientes a una versión específica del catálogo.';
COMMENT ON CONSTRAINT industries_id_version_uniq ON public.industries IS
    'Clave compuesta para FK cruzada desde subindustries. Garantiza que subindustria e industria padre pertenezcan a la misma versión.';


-- ============================================================
-- SECCIÓN 3: subindustries
-- ============================================================
-- La FK compuesta (industry_id, catalog_version_id) → industries(id, catalog_version_id)
-- garantiza integridad cruzada de versión a nivel de base de datos.
-- No depende de validación de aplicación.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.subindustries (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    catalog_version_id  UUID        NOT NULL
        REFERENCES public.industry_catalog_versions(id) ON DELETE RESTRICT,
    industry_id         UUID        NOT NULL,
    name                TEXT        NOT NULL,
    slug                TEXT        NOT NULL,
    description         TEXT,
    active              BOOLEAN     NOT NULL DEFAULT true,
    sort_order          INTEGER     NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT subindustries_slug_not_empty     CHECK (trim(slug) <> ''),
    CONSTRAINT subindustries_name_not_empty     CHECK (trim(name) <> ''),
    CONSTRAINT subindustries_sort_order_nn      CHECK (sort_order >= 0),
    -- Integridad cruzada: industry_id y catalog_version_id deben
    -- corresponder al mismo registro en industries.
    CONSTRAINT subindustries_industry_version_fk
        FOREIGN KEY (industry_id, catalog_version_id)
        REFERENCES public.industries(id, catalog_version_id)
        ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subindustries_industry_slug
    ON public.subindustries (industry_id, slug);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subindustries_industry_name
    ON public.subindustries (industry_id, name);

-- Lista de subindustrias por industria (ordenada, filtrando inactivas)
CREATE INDEX IF NOT EXISTS idx_subindustries_industry_active_sort
    ON public.subindustries (industry_id, active, sort_order);

-- Consultas globales por versión
CREATE INDEX IF NOT EXISTS idx_subindustries_version_active_sort
    ON public.subindustries (catalog_version_id, active, sort_order);

DROP TRIGGER IF EXISTS subindustries_set_updated_at ON public.subindustries;
CREATE TRIGGER subindustries_set_updated_at
    BEFORE UPDATE ON public.subindustries
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE public.subindustries IS
    'Subindustrias pertenecientes a una industria y versión de catálogo específicas.';
COMMENT ON CONSTRAINT subindustries_industry_version_fk ON public.subindustries IS
    'FK compuesta. Garantiza que subindustria e industria padre pertenezcan a la misma versión del catálogo.';


-- ============================================================
-- SECCIÓN 4: subindustry_aliases
-- ============================================================
-- Aliases y nombres alternativos de una subindustria.
-- country_code NULL = alias global (sin restricción geográfica).
--
-- Estrategia de unicidad para country_code NULL:
-- Se usan dos índices únicos parciales en lugar de NULLS NOT DISTINCT
-- para máxima compatibilidad y semántica explícita.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.subindustry_aliases (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subindustry_id      UUID        NOT NULL
        REFERENCES public.subindustries(id) ON DELETE CASCADE,
    alias               TEXT        NOT NULL,
    normalized_alias    TEXT        NOT NULL,
    language_code       TEXT,
    country_code        TEXT,
    active              BOOLEAN     NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT aliases_alias_not_empty
        CHECK (trim(alias) <> ''),
    CONSTRAINT aliases_normalized_alias_not_empty
        CHECK (trim(normalized_alias) <> '')
);

-- Unicidad cuando country_code está especificado
CREATE UNIQUE INDEX IF NOT EXISTS idx_aliases_uniq_with_country
    ON public.subindustry_aliases (subindustry_id, normalized_alias, country_code)
    WHERE country_code IS NOT NULL;

-- Unicidad cuando country_code es NULL (alias global)
CREATE UNIQUE INDEX IF NOT EXISTS idx_aliases_uniq_no_country
    ON public.subindustry_aliases (subindustry_id, normalized_alias)
    WHERE country_code IS NULL;

-- Búsqueda de subindustrias por alias normalizado
CREATE INDEX IF NOT EXISTS idx_aliases_normalized_alias
    ON public.subindustry_aliases (normalized_alias);

-- Filtro por geografía
CREATE INDEX IF NOT EXISTS idx_aliases_country_code
    ON public.subindustry_aliases (country_code)
    WHERE country_code IS NOT NULL;

DROP TRIGGER IF EXISTS subindustry_aliases_set_updated_at ON public.subindustry_aliases;
CREATE TRIGGER subindustry_aliases_set_updated_at
    BEFORE UPDATE ON public.subindustry_aliases
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE public.subindustry_aliases IS
    'Aliases y nombres alternativos de subindustrias. country_code NULL indica alias global sin restricción geográfica.';


-- ============================================================
-- SECCIÓN 5: subindustry_search_terms
-- ============================================================

CREATE TABLE IF NOT EXISTS public.subindustry_search_terms (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subindustry_id      UUID        NOT NULL
        REFERENCES public.subindustries(id) ON DELETE CASCADE,
    term                TEXT        NOT NULL,
    normalized_term     TEXT        NOT NULL,
    term_type           TEXT        NOT NULL,
    language_code       TEXT,
    country_code        TEXT,
    weight              NUMERIC,
    active              BOOLEAN     NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT sst_term_not_empty
        CHECK (trim(term) <> ''),
    CONSTRAINT sst_normalized_term_not_empty
        CHECK (trim(normalized_term) <> ''),
    CONSTRAINT sst_term_type_valid
        CHECK (term_type IN (
            'keyword', 'query_phrase', 'exclusion_term', 'source_hint'
        )),
    CONSTRAINT sst_weight_range
        CHECK (weight IS NULL OR (weight >= 0 AND weight <= 1))
);

-- Unicidad por tipo + término + geografía (con country_code explícito)
CREATE UNIQUE INDEX IF NOT EXISTS idx_sst_uniq_with_country
    ON public.subindustry_search_terms (subindustry_id, normalized_term, term_type, country_code)
    WHERE country_code IS NOT NULL;

-- Unicidad sin country_code (término global)
CREATE UNIQUE INDEX IF NOT EXISTS idx_sst_uniq_no_country
    ON public.subindustry_search_terms (subindustry_id, normalized_term, term_type)
    WHERE country_code IS NULL;

-- Búsqueda inversa: encontrar subindustrias por término
CREATE INDEX IF NOT EXISTS idx_sst_normalized_term
    ON public.subindustry_search_terms (normalized_term);

-- Filtro geográfico en búsquedas
CREATE INDEX IF NOT EXISTS idx_sst_country_code
    ON public.subindustry_search_terms (country_code)
    WHERE country_code IS NOT NULL;

DROP TRIGGER IF EXISTS subindustry_search_terms_set_updated_at ON public.subindustry_search_terms;
CREATE TRIGGER subindustry_search_terms_set_updated_at
    BEFORE UPDATE ON public.subindustry_search_terms
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE public.subindustry_search_terms IS
    'Términos de búsqueda, frases y señales asociados a una subindustria para el motor de Generar con IA.';


-- ============================================================
-- SECCIÓN 6: subindustry_rules
-- ============================================================
-- Reglas modulares y configurables por subindustria.
-- No almacena prompts completos: contiene reglas discretas
-- que el pipeline de IA ensambla en tiempo de ejecución.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.subindustry_rules (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subindustry_id      UUID        NOT NULL
        REFERENCES public.subindustries(id) ON DELETE CASCADE,
    rule_key            TEXT        NOT NULL,
    rule_type           TEXT        NOT NULL,
    execution_layer     TEXT        NOT NULL,
    priority            TEXT        NOT NULL,
    rule_text           TEXT        NOT NULL,
    configuration       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    source_document     TEXT,
    source_section      TEXT,
    active              BOOLEAN     NOT NULL DEFAULT true,
    sort_order          INTEGER     NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT rules_key_not_empty
        CHECK (trim(rule_key) <> ''),
    CONSTRAINT rules_text_not_empty
        CHECK (trim(rule_text) <> ''),
    CONSTRAINT rules_sort_order_nn
        CHECK (sort_order >= 0),
    CONSTRAINT rules_type_valid
        CHECK (rule_type IN (
            'inclusion', 'exclusion', 'fit_signal',
            'evidence_requirement', 'search_strategy', 'quality_gate'
        )),
    CONSTRAINT rules_execution_layer_valid
        CHECK (execution_layer IN ('model', 'code', 'combined')),
    CONSTRAINT rules_priority_valid
        CHECK (priority IN ('blocking', 'high', 'normal', 'low')),
    CONSTRAINT rules_configuration_is_object
        CHECK (jsonb_typeof(configuration) = 'object'),
    CONSTRAINT rules_key_per_subindustry
        UNIQUE (subindustry_id, rule_key)
);

-- Consulta de reglas activas ordenadas por prioridad y sort_order
CREATE INDEX IF NOT EXISTS idx_rules_subindustry_active_priority_sort
    ON public.subindustry_rules (subindustry_id, active, priority, sort_order);

DROP TRIGGER IF EXISTS subindustry_rules_set_updated_at ON public.subindustry_rules;
CREATE TRIGGER subindustry_rules_set_updated_at
    BEFORE UPDATE ON public.subindustry_rules
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE public.subindustry_rules IS
    'Reglas modulares y configurables por subindustria. No almacena prompts completos.';


-- ============================================================
-- SECCIÓN 7: INMUTABILIDAD — Protección de versiones publicadas
-- ============================================================


-- ============================================================
-- 7a. protect_catalog_version_transitions
-- ============================================================
-- Protege transiciones de estado en industry_catalog_versions.
--
-- Transiciones permitidas:
--   draft     → published  (vía publish_industry_catalog_version)
--   published → archived   (excepción explícita: única forma de
--                           retirar un catálogo activo)
--
-- Transiciones bloqueadas:
--   published → draft      (imposible revertir un catálogo publicado)
--   archived  → cualquier  (archivado es permanente)
--   DELETE de published/archived (versiones permanentes)
-- ============================================================

CREATE OR REPLACE FUNCTION public.protect_catalog_version_transitions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
    -- Bloquear DELETE de versiones publicadas o archivadas
    IF TG_OP = 'DELETE' THEN
        IF OLD.status IN ('published', 'archived') THEN
            RAISE EXCEPTION
                'No se puede eliminar una versión de catálogo en estado %. '
                'Las versiones publicadas y archivadas son permanentes.',
                OLD.status;
        END IF;
        RETURN OLD;
    END IF;

    -- Versiones archivadas: completamente inmutables
    IF OLD.status = 'archived' THEN
        RAISE EXCEPTION
            'La versión de catálogo % está archivada y no puede ser modificada. '
            'Las versiones archivadas son inmutables.',
            OLD.id;
    END IF;

    -- Publicada → draft: prohibido explícitamente
    IF OLD.status = 'published' AND NEW.status = 'draft' THEN
        RAISE EXCEPTION
            'No se puede revertir una versión publicada a draft. '
            'Crea una nueva versión para introducir cambios.';
    END IF;

    -- Publicada → archivada: única transición permitida desde published.
    -- Requiere archived_at establecido.
    IF OLD.status = 'published' AND NEW.status = 'archived' THEN
        IF NEW.archived_at IS NULL THEN
            RAISE EXCEPTION
                'archived_at debe establecerse al archivar una versión publicada.';
        END IF;
        RETURN NEW;
    END IF;

    -- Publicada → publicada (sin cambio de status): no se pueden
    -- modificar campos estructurales de una versión publicada
    IF OLD.status = 'published' AND NEW.status = 'published' THEN
        IF OLD.version <> NEW.version THEN
            RAISE EXCEPTION
                'No se puede modificar el campo version de una versión publicada.';
        END IF;
        IF COALESCE(OLD.name, '') <> COALESCE(NEW.name, '') THEN
            RAISE EXCEPTION
                'No se puede modificar el campo name de una versión publicada.';
        END IF;
        IF COALESCE(OLD.description, '') <> COALESCE(NEW.description, '') THEN
            RAISE EXCEPTION
                'No se puede modificar el campo description de una versión publicada.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS industry_catalog_versions_protect_transitions
    ON public.industry_catalog_versions;
CREATE TRIGGER industry_catalog_versions_protect_transitions
    BEFORE UPDATE OR DELETE ON public.industry_catalog_versions
    FOR EACH ROW EXECUTE FUNCTION public.protect_catalog_version_transitions();


-- ============================================================
-- 7b. protect_immutable_catalog_content
-- ============================================================
-- Protege el contenido (industries, subindustries, aliases,
-- search_terms, rules) contra modificaciones cuando la versión
-- del catálogo asociada está en estado 'published' o 'archived'.
-- Aplica a INSERT, UPDATE y DELETE.
--
-- También bloquea cambios de catalog_version_id, industry_id
-- y subindustry_id en filas existentes para garantizar
-- coherencia referencial a nivel de aplicación.
-- ============================================================

CREATE OR REPLACE FUNCTION public.protect_immutable_catalog_content()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_version_status     TEXT;
    v_catalog_version_id UUID;
    v_subindustry_id     UUID;
BEGIN
    -- Resolver catalog_version_id según tabla y operación
    IF TG_TABLE_NAME = 'industries' THEN

        IF TG_OP = 'DELETE' THEN
            v_catalog_version_id := OLD.catalog_version_id;
        ELSE
            IF TG_OP = 'UPDATE' AND OLD.catalog_version_id <> NEW.catalog_version_id THEN
                RAISE EXCEPTION
                    'No se puede cambiar catalog_version_id de una industria existente.';
            END IF;
            v_catalog_version_id := NEW.catalog_version_id;
        END IF;

    ELSIF TG_TABLE_NAME = 'subindustries' THEN

        IF TG_OP = 'DELETE' THEN
            v_catalog_version_id := OLD.catalog_version_id;
        ELSE
            IF TG_OP = 'UPDATE' AND OLD.catalog_version_id <> NEW.catalog_version_id THEN
                RAISE EXCEPTION
                    'No se puede cambiar catalog_version_id de una subindustria existente.';
            END IF;
            IF TG_OP = 'UPDATE' AND OLD.industry_id <> NEW.industry_id THEN
                RAISE EXCEPTION
                    'No se puede cambiar industry_id de una subindustria existente.';
            END IF;
            v_catalog_version_id := NEW.catalog_version_id;
        END IF;

    ELSIF TG_TABLE_NAME IN (
        'subindustry_aliases', 'subindustry_search_terms', 'subindustry_rules'
    ) THEN

        IF TG_OP = 'DELETE' THEN
            v_subindustry_id := OLD.subindustry_id;
        ELSE
            IF TG_OP = 'UPDATE' AND OLD.subindustry_id <> NEW.subindustry_id THEN
                RAISE EXCEPTION
                    'No se puede cambiar subindustry_id en tabla %.', TG_TABLE_NAME;
            END IF;
            v_subindustry_id := NEW.subindustry_id;
        END IF;

        -- Resolver catalog_version_id a través de la cadena de FK
        SELECT s.catalog_version_id INTO v_catalog_version_id
        FROM public.subindustries s
        WHERE s.id = v_subindustry_id;

    END IF;

    -- Consultar estado de la versión
    SELECT status INTO v_version_status
    FROM public.industry_catalog_versions
    WHERE id = v_catalog_version_id;

    IF v_version_status IN ('published', 'archived') THEN
        RAISE EXCEPTION
            'No se puede modificar el contenido de una versión de catálogo en estado %. '
            'Crea una nueva versión para introducir cambios. (version_id: %)',
            v_version_status, v_catalog_version_id;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

-- Aplicar trigger de inmutabilidad a todas las tablas de contenido

DROP TRIGGER IF EXISTS industries_protect_immutable ON public.industries;
CREATE TRIGGER industries_protect_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON public.industries
    FOR EACH ROW EXECUTE FUNCTION public.protect_immutable_catalog_content();

DROP TRIGGER IF EXISTS subindustries_protect_immutable ON public.subindustries;
CREATE TRIGGER subindustries_protect_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON public.subindustries
    FOR EACH ROW EXECUTE FUNCTION public.protect_immutable_catalog_content();

DROP TRIGGER IF EXISTS subindustry_aliases_protect_immutable ON public.subindustry_aliases;
CREATE TRIGGER subindustry_aliases_protect_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON public.subindustry_aliases
    FOR EACH ROW EXECUTE FUNCTION public.protect_immutable_catalog_content();

DROP TRIGGER IF EXISTS subindustry_search_terms_protect_immutable ON public.subindustry_search_terms;
CREATE TRIGGER subindustry_search_terms_protect_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON public.subindustry_search_terms
    FOR EACH ROW EXECUTE FUNCTION public.protect_immutable_catalog_content();

DROP TRIGGER IF EXISTS subindustry_rules_protect_immutable ON public.subindustry_rules;
CREATE TRIGGER subindustry_rules_protect_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON public.subindustry_rules
    FOR EACH ROW EXECUTE FUNCTION public.protect_immutable_catalog_content();


-- ============================================================
-- SECCIÓN 8: FUNCIÓN DE PUBLICACIÓN
-- ============================================================
-- publish_industry_catalog_version(p_version_id uuid)
--
-- Transición atómica draft → published en una sola transacción.
-- Archiva automáticamente la versión publicada anterior.
--
-- Validaciones previas a publicar:
--   1. La versión existe y está en estado draft
--   2. Contiene al menos una industria activa
--   3. Cada industria activa tiene al menos una subindustria activa
--
-- Permisos: solo service_role. El módulo Configuración
-- definirá quién puede invocarla desde la UI.
-- ============================================================

CREATE OR REPLACE FUNCTION public.publish_industry_catalog_version(
    p_version_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_status             TEXT;
    v_industry_count     INTEGER;
    v_prev_published_id  UUID;
BEGIN
    -- 1. Bloquear y validar la versión objetivo
    SELECT status INTO v_status
    FROM public.industry_catalog_versions
    WHERE id = p_version_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Versión de catálogo no encontrada: %', p_version_id;
    END IF;

    IF v_status <> 'draft' THEN
        RAISE EXCEPTION
            'Solo versiones en estado draft pueden publicarse. Estado actual: %.',
            v_status;
    END IF;

    -- 2. Validar al menos una industria activa
    SELECT COUNT(*) INTO v_industry_count
    FROM public.industries
    WHERE catalog_version_id = p_version_id
      AND active = true;

    IF v_industry_count = 0 THEN
        RAISE EXCEPTION
            'La versión de catálogo debe contener al menos una industria activa antes de publicarse.';
    END IF;

    -- 3. Validar que cada industria activa tenga al menos una subindustria activa
    IF EXISTS (
        SELECT 1
        FROM public.industries i
        WHERE i.catalog_version_id = p_version_id
          AND i.active = true
          AND NOT EXISTS (
              SELECT 1
              FROM public.subindustries s
              WHERE s.industry_id = i.id
                AND s.active = true
          )
    ) THEN
        RAISE EXCEPTION
            'Todas las industrias activas deben tener al menos una subindustria activa.';
    END IF;

    -- 4. Archivar la versión publicada anterior, si existe.
    -- FOR UPDATE (sin SKIP LOCKED) garantiza serialización ante
    -- intentos concurrentes de publicación.
    SELECT id INTO v_prev_published_id
    FROM public.industry_catalog_versions
    WHERE status = 'published'
    FOR UPDATE;

    IF v_prev_published_id IS NOT NULL THEN
        -- El trigger protect_catalog_version_transitions permite
        -- explícitamente la transición published → archived.
        UPDATE public.industry_catalog_versions
        SET status      = 'archived',
            archived_at = now(),
            updated_at  = now()
        WHERE id = v_prev_published_id;
    END IF;

    -- 5. Publicar la nueva versión.
    -- En este punto idx_icv_single_published está libre (no hay published).
    UPDATE public.industry_catalog_versions
    SET status       = 'published',
        published_at = now(),
        updated_at   = now()
    WHERE id = p_version_id;

END;
$$;

COMMENT ON FUNCTION public.publish_industry_catalog_version(UUID) IS
    'Publica atómicamente una versión de catálogo en estado draft. '
    'Archiva la versión publicada anterior. '
    'Valida integridad de industrias y subindustrias activas antes de publicar.';

REVOKE ALL ON FUNCTION public.publish_industry_catalog_version(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publish_industry_catalog_version(UUID) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.publish_industry_catalog_version(UUID) TO service_role;


-- ============================================================
-- SECCIÓN 9: VISTAS DEL CATÁLOGO ACTIVO
-- ============================================================
-- Vistas relacionales para consumir el catálogo publicado.
-- No devuelven reglas inactivas ni versiones no publicadas.
-- Cada vista está optimizada para un tipo de consulta específico:
-- no se construye un JSON gigantesco que perjudique filtros.
-- ============================================================

-- Vista principal: versión publicada + industrias + subindustrias activas
CREATE OR REPLACE VIEW public.active_industry_catalog AS
SELECT
    v.id            AS catalog_version_id,
    v.version       AS catalog_version,
    v.name          AS catalog_name,
    v.published_at,
    i.id            AS industry_id,
    i.name          AS industry_name,
    i.slug          AS industry_slug,
    i.description   AS industry_description,
    i.sort_order    AS industry_sort_order,
    s.id            AS subindustry_id,
    s.name          AS subindustry_name,
    s.slug          AS subindustry_slug,
    s.description   AS subindustry_description,
    s.sort_order    AS subindustry_sort_order
FROM public.industry_catalog_versions v
JOIN public.industries i
    ON i.catalog_version_id = v.id
    AND i.active = true
JOIN public.subindustries s
    ON s.industry_id = i.id
    AND s.active = true
WHERE v.status = 'published'
ORDER BY i.sort_order, s.sort_order;

COMMENT ON VIEW public.active_industry_catalog IS
    'Catálogo activo: versión publicada + industrias y subindustrias activas. Base para el selector de la UI.';

-- Vista: aliases activos del catálogo publicado
CREATE OR REPLACE VIEW public.active_subindustry_aliases AS
SELECT
    a.id,
    a.subindustry_id,
    s.catalog_version_id,
    a.alias,
    a.normalized_alias,
    a.language_code,
    a.country_code
FROM public.subindustry_aliases a
JOIN public.subindustries s
    ON s.id = a.subindustry_id
JOIN public.industry_catalog_versions v
    ON v.id = s.catalog_version_id
WHERE v.status = 'published'
  AND a.active = true;

COMMENT ON VIEW public.active_subindustry_aliases IS
    'Aliases activos del catálogo publicado. Útil para resolución de nombres alternativos.';

-- Vista: términos de búsqueda activos del catálogo publicado
CREATE OR REPLACE VIEW public.active_subindustry_search_terms AS
SELECT
    t.id,
    t.subindustry_id,
    s.catalog_version_id,
    t.term,
    t.normalized_term,
    t.term_type,
    t.language_code,
    t.country_code,
    t.weight
FROM public.subindustry_search_terms t
JOIN public.subindustries s
    ON s.id = t.subindustry_id
JOIN public.industry_catalog_versions v
    ON v.id = s.catalog_version_id
WHERE v.status = 'published'
  AND t.active = true;

COMMENT ON VIEW public.active_subindustry_search_terms IS
    'Términos de búsqueda activos del catálogo publicado. Consumidos por el pipeline de Generar con IA.';

-- Vista: reglas activas del catálogo publicado (sin reglas inactivas)
CREATE OR REPLACE VIEW public.active_subindustry_rules AS
SELECT
    r.id,
    r.subindustry_id,
    s.catalog_version_id,
    r.rule_key,
    r.rule_type,
    r.execution_layer,
    r.priority,
    r.rule_text,
    r.configuration,
    r.source_document,
    r.source_section,
    r.sort_order
FROM public.subindustry_rules r
JOIN public.subindustries s
    ON s.id = r.subindustry_id
JOIN public.industry_catalog_versions v
    ON v.id = s.catalog_version_id
WHERE v.status = 'published'
  AND r.active = true
ORDER BY r.sort_order;

COMMENT ON VIEW public.active_subindustry_rules IS
    'Reglas activas del catálogo publicado, ordenadas por sort_order. No incluye reglas inactivas.';


-- ============================================================
-- SECCIÓN 10: ROW LEVEL SECURITY
-- ============================================================
-- Primera fase: acceso de lectura general para authenticated.
-- No se otorgan permisos de escritura a authenticated:
-- el rol de edición del catálogo se definirá en Configuración.
-- anon: sin acceso (sin políticas → sin filas).
-- service_role: omite RLS por configuración de Supabase.
-- ============================================================

ALTER TABLE public.industry_catalog_versions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.industries                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subindustries               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subindustry_aliases         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subindustry_search_terms    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subindustry_rules           ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active_users_can_read_industry_catalog_versions"
    ON public.industry_catalog_versions FOR SELECT
    TO authenticated
    USING (has_active_access(auth.uid()));

CREATE POLICY "active_users_can_read_industries"
    ON public.industries FOR SELECT
    TO authenticated
    USING (has_active_access(auth.uid()));

CREATE POLICY "active_users_can_read_subindustries"
    ON public.subindustries FOR SELECT
    TO authenticated
    USING (has_active_access(auth.uid()));

CREATE POLICY "active_users_can_read_subindustry_aliases"
    ON public.subindustry_aliases FOR SELECT
    TO authenticated
    USING (has_active_access(auth.uid()));

CREATE POLICY "active_users_can_read_subindustry_search_terms"
    ON public.subindustry_search_terms FOR SELECT
    TO authenticated
    USING (has_active_access(auth.uid()));

CREATE POLICY "active_users_can_read_subindustry_rules"
    ON public.subindustry_rules FOR SELECT
    TO authenticated
    USING (has_active_access(auth.uid()));

-- Permisos de lectura en vistas para authenticated
GRANT SELECT ON public.active_industry_catalog         TO authenticated;
GRANT SELECT ON public.active_subindustry_aliases      TO authenticated;
GRANT SELECT ON public.active_subindustry_search_terms TO authenticated;
GRANT SELECT ON public.active_subindustry_rules        TO authenticated;
