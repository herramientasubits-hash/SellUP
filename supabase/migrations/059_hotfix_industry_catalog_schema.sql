-- ============================================================
-- Migration 059: Hotfix de esquema para completar el catálogo
-- Hito 16AB.31 — GAP-001 y GAP-002
-- ============================================================
-- Cierra los dos gaps bloqueantes identificados en la auditoría
-- pre-seed 16AB.30:
--
--   GAP-001: 48 reglas comunes de industria sin tabla destino.
--            Solución: public.industry_rules + triggers +
--            vista active_industry_rules + permisos.
--
--   GAP-002: applicable_countries de subindustrias sin persistencia.
--            Solución: columna en subindustries + helper immutable +
--            CHECK constraint + índice GIN.
--
-- No inserta datos. No publica catálogo.
-- No modifica UI, rutas, workers, lotes ni tablas ajenas al catálogo.
-- Prerequisito del seed inicial del Catálogo 1.0.0.
-- ============================================================


-- ============================================================
-- SECCIÓN 1: is_valid_iso2_country_array
-- ============================================================
-- Helper determinístico e inmutable para validar arrays ISO-2.
-- Semántica oficial:
--   NULL                  = aplica a toda LATAM (válido → true)
--   {}                    = inválido (→ false)
--   cada elemento         = ^[A-Z]{2}$ sin duplicados ni NULLs
-- Declarada antes de usarse en el CHECK de subindustries.
-- Sin SQL dinámico. search_path fijo.
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_valid_iso2_country_array(arr text[])
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
BEGIN
    -- NULL = aplica a toda LATAM: válido
    IF arr IS NULL THEN
        RETURN true;
    END IF;

    -- array_length retorna NULL para {} en PostgreSQL
    IF array_length(arr, 1) IS NULL THEN
        RETURN false;
    END IF;

    -- Sin NULLs internos y exactamente dos letras mayúsculas
    IF EXISTS (
        SELECT 1 FROM unnest(arr) AS c
        WHERE c IS NULL OR c !~ '^[A-Z]{2}$'
    ) THEN
        RETURN false;
    END IF;

    -- Todos los elementos únicos
    IF (SELECT count(DISTINCT c) FROM unnest(arr) AS c) <> array_length(arr, 1) THEN
        RETURN false;
    END IF;

    RETURN true;
END;
$$;

COMMENT ON FUNCTION public.is_valid_iso2_country_array(text[]) IS
    'Valida arrays de códigos ISO-3166-1 alpha-2 (mayúsculas, sin duplicados, sin vacíos). '
    'NULL retorna true (aplica a toda LATAM). Inmutable, search_path fijo, sin SQL dinámico. '
    'Usado en CHECK de subindustries.applicable_countries.';


-- ============================================================
-- SECCIÓN 2: applicable_countries en subindustries (GAP-002)
-- ============================================================
-- NULL  = aplica a toda LATAM
-- array ISO-2 = restringe a esos países
-- array vacío = inválido (el helper lo rechaza)
-- ============================================================

ALTER TABLE public.subindustries
    ADD COLUMN IF NOT EXISTS applicable_countries text[] DEFAULT NULL;

ALTER TABLE public.subindustries
    ADD CONSTRAINT subindustries_applicable_countries_valid
    CHECK (public.is_valid_iso2_country_array(applicable_countries));

-- GIN para consultas por pertenencia de país (p.ej. 'CO' = ANY(applicable_countries))
CREATE INDEX IF NOT EXISTS idx_subindustries_applicable_countries_gin
    ON public.subindustries USING gin (applicable_countries)
    WHERE applicable_countries IS NOT NULL;

COMMENT ON COLUMN public.subindustries.applicable_countries IS
    'Códigos ISO-3166-1 alpha-2 donde aplica esta subindustria. '
    'NULL = toda LATAM. Array vacío inválido.';


-- ============================================================
-- SECCIÓN 3: industry_rules (GAP-001)
-- ============================================================
-- Reglas comunes a nivel de industria. Simétrica con
-- subindustry_rules en convenciones, checks y enums.
--
-- FK compuesta (industry_id, catalog_version_id)
-- → industries(id, catalog_version_id)  [industries_id_version_uniq]
-- Garantiza DB-level que la regla pertenezca a la misma versión
-- que su industria padre. ON DELETE CASCADE desde la industria.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.industry_rules (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    catalog_version_id  UUID        NOT NULL,
    industry_id         UUID        NOT NULL,
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

    -- No-vacío
    CONSTRAINT ir_rule_key_not_empty
        CHECK (trim(rule_key) <> ''),
    CONSTRAINT ir_rule_text_not_empty
        CHECK (trim(rule_text) <> ''),
    CONSTRAINT ir_sort_order_nn
        CHECK (sort_order >= 0),
    CONSTRAINT ir_configuration_is_object
        CHECK (jsonb_typeof(configuration) = 'object'),

    -- Enums (simétricos con subindustry_rules)
    CONSTRAINT ir_rule_type_valid
        CHECK (rule_type IN (
            'inclusion', 'exclusion', 'fit_signal',
            'evidence_requirement', 'search_strategy', 'quality_gate'
        )),
    CONSTRAINT ir_execution_layer_valid
        CHECK (execution_layer IN ('model', 'code', 'combined')),
    CONSTRAINT ir_priority_valid
        CHECK (priority IN ('blocking', 'high', 'normal', 'low')),

    -- Una clave por industria
    CONSTRAINT ir_key_per_industry
        UNIQUE (industry_id, rule_key),

    -- FK compuesta: reutiliza industries_id_version_uniq
    -- ON DELETE CASCADE: si la industria se elimina, las reglas también
    CONSTRAINT ir_industry_version_fk
        FOREIGN KEY (industry_id, catalog_version_id)
        REFERENCES public.industries(id, catalog_version_id)
        ON DELETE CASCADE
);

-- Reglas activas por industria ordenadas por prioridad y sort_order
CREATE INDEX IF NOT EXISTS idx_ir_industry_active_priority_sort
    ON public.industry_rules (industry_id, active, priority, sort_order);

-- Consultas globales por versión y estado activo
CREATE INDEX IF NOT EXISTS idx_ir_version_active
    ON public.industry_rules (catalog_version_id, active);

DROP TRIGGER IF EXISTS industry_rules_set_updated_at ON public.industry_rules;
CREATE TRIGGER industry_rules_set_updated_at
    BEFORE UPDATE ON public.industry_rules
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE public.industry_rules IS
    'Reglas modulares y configurables a nivel de industria. '
    'Simétrica con subindustry_rules. '
    'FK compuesta garantiza coherencia de versión con la industria padre.';

COMMENT ON CONSTRAINT ir_industry_version_fk ON public.industry_rules IS
    'FK compuesta. Garantiza que la regla y su industria padre pertenezcan '
    'a la misma versión del catálogo. Reutiliza industries_id_version_uniq.';


-- ============================================================
-- SECCIÓN 4: RLS y permisos de industry_rules
-- ============================================================
-- authenticated: SELECT (política RLS + GRANT explícito)
-- service_role:  acceso administrativo completo
-- anon:          sin acceso (ni política ni GRANT)
-- ============================================================

ALTER TABLE public.industry_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active_users_can_read_industry_rules"
    ON public.industry_rules FOR SELECT
    TO authenticated
    USING (has_active_access(auth.uid()));

-- Cerrar default privileges de Supabase sobre la tabla nueva
REVOKE ALL ON public.industry_rules FROM public;
REVOKE ALL ON public.industry_rules FROM anon;
REVOKE ALL ON public.industry_rules FROM authenticated;

GRANT SELECT ON public.industry_rules TO authenticated;
GRANT ALL    ON public.industry_rules TO service_role;


-- ============================================================
-- SECCIÓN 5: protect_immutable_catalog_content extendida
-- ============================================================
-- Extiende la función existente para reconocer industry_rules.
-- Conserva íntegramente el comportamiento para las otras cinco
-- tablas: industries, subindustries, subindustry_aliases,
-- subindustry_search_terms, subindustry_rules.
--
-- Para industry_rules:
--   - Resuelve catalog_version_id directamente desde la fila
--   - Bloquea INSERT/UPDATE/DELETE cuando la versión está
--     published o archived
--   - Bloquea cambios de industry_id o catalog_version_id
--     en filas existentes
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

    ELSIF TG_TABLE_NAME = 'industry_rules' THEN

        IF TG_OP = 'DELETE' THEN
            v_catalog_version_id := OLD.catalog_version_id;
        ELSE
            IF TG_OP = 'UPDATE' AND OLD.catalog_version_id <> NEW.catalog_version_id THEN
                RAISE EXCEPTION
                    'No se puede cambiar catalog_version_id de una regla de industria existente.';
            END IF;
            IF TG_OP = 'UPDATE' AND OLD.industry_id <> NEW.industry_id THEN
                RAISE EXCEPTION
                    'No se puede cambiar industry_id de una regla de industria existente.';
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

-- Trigger de inmutabilidad para industry_rules
DROP TRIGGER IF EXISTS industry_rules_protect_immutable ON public.industry_rules;
CREATE TRIGGER industry_rules_protect_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON public.industry_rules
    FOR EACH ROW EXECUTE FUNCTION public.protect_immutable_catalog_content();


-- ============================================================
-- SECCIÓN 6: active_industry_rules
-- ============================================================
-- Vista relacional de reglas de industria del catálogo publicado.
-- Solo expone: versión published, industria activa, regla activa.
-- security_invoker = true: respeta RLS del rol invocador.
-- Orden: industria → prioridad (blocking→high→normal→low) → sort_order.
-- ============================================================

CREATE OR REPLACE VIEW public.active_industry_rules
WITH (security_invoker = true)
AS
SELECT
    v.id                AS catalog_version_id,
    v.version           AS catalog_version,
    i.id                AS industry_id,
    i.name              AS industry_name,
    i.slug              AS industry_slug,
    r.id                AS rule_id,
    r.rule_key,
    r.rule_type,
    r.execution_layer,
    r.priority,
    r.rule_text,
    r.configuration,
    r.source_document,
    r.source_section,
    r.sort_order
FROM public.industry_catalog_versions v
JOIN public.industries i
    ON  i.catalog_version_id = v.id
    AND i.active = true
JOIN public.industry_rules r
    ON  r.industry_id = i.id
    AND r.active = true
WHERE v.status = 'published'
ORDER BY
    i.sort_order,
    CASE r.priority
        WHEN 'blocking' THEN 1
        WHEN 'high'     THEN 2
        WHEN 'normal'   THEN 3
        WHEN 'low'      THEN 4
    END,
    r.sort_order;

COMMENT ON VIEW public.active_industry_rules IS
    'Reglas de industria activas del catálogo publicado. '
    'security_invoker = true. Ordenadas por industria, prioridad y sort_order.';

REVOKE ALL ON public.active_industry_rules FROM public;
REVOKE ALL ON public.active_industry_rules FROM anon;
REVOKE ALL ON public.active_industry_rules FROM authenticated;

GRANT SELECT ON public.active_industry_rules TO authenticated;
GRANT SELECT ON public.active_industry_rules TO service_role;


-- ============================================================
-- SECCIÓN 7: active_industry_catalog — agregar applicable_countries
-- ============================================================
-- Se añade s.applicable_countries al SELECT para que los
-- consumidores puedan filtrar por país sin acceder a la tabla base.
-- Se conservan todas las demás columnas y el ORDER BY.
-- Tras CREATE OR REPLACE VIEW se restauran explícitamente
-- security_invoker y los permisos exactos establecidos en 058.
-- ============================================================

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
    s.sort_order    AS subindustry_sort_order,
    s.applicable_countries
FROM public.industry_catalog_versions v
JOIN public.industries i
    ON  i.catalog_version_id = v.id
    AND i.active = true
JOIN public.subindustries s
    ON  s.industry_id = i.id
    AND s.active = true
WHERE v.status = 'published'
ORDER BY i.sort_order, s.sort_order;

COMMENT ON VIEW public.active_industry_catalog IS
    'Catálogo activo: versión publicada + industrias y subindustrias activas. '
    'Incluye applicable_countries para filtrado geográfico. '
    'Base para el selector de la UI.';

-- Restaurar security_invoker (CREATE OR REPLACE puede resetear opciones de vista)
ALTER VIEW public.active_industry_catalog SET (security_invoker = true);

-- Restaurar permisos explícitos (simetría con migración 058)
REVOKE ALL ON public.active_industry_catalog FROM public;
REVOKE ALL ON public.active_industry_catalog FROM anon;
REVOKE ALL ON public.active_industry_catalog FROM authenticated;
REVOKE ALL ON public.active_industry_catalog FROM service_role;
GRANT SELECT ON public.active_industry_catalog TO authenticated;
GRANT SELECT ON public.active_industry_catalog TO service_role;
