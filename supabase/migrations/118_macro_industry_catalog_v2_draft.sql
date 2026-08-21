-- ============================================================
-- Migration 118: Catálogo de Macro Industrias v2.0.0 (DRAFT)
-- AGENT1-MACRO-INDUSTRY-CATALOG-DISCOVERY-1 · §§ 3, 4, 5, 14 y 21
-- ============================================================
-- APPLIED IN PRODUCTION: NO
--
-- ── Qué hace, y qué NO hace ─────────────────────────────────
--
-- HACE:
--   1. Crea la vista `active_macro_industry_catalog`: la versión
--      publicada y sus industrias activas, SIN exigir subindustrias.
--   2. Crea `publish_macro_industry_catalog_version(uuid)`: la
--      transición draft → published para un catálogo SIN
--      subindustrias.
--   3. Inserta la versión 2.0.0 en estado **draft** con las 12
--      Macro Industrias.
--
-- NO HACE:
--   - NO publica la versión 2.0.0. Sigue en `draft` al terminar.
--   - NO archiva la versión 1.0.0. Sigue `published` y activa.
--   - NO borra, modifica ni migra ninguna fila existente.
--   - NO toca `active_industry_catalog`, `industries` v1,
--     `subindustries` ni ninguna de sus tablas hijas (alias,
--     términos de búsqueda, reglas). Un ratchet estático de la
--     suite `test:a1-catalog-source-of-truth` verifica que ninguna
--     migración posterior a la 060 escriba en ellas; esta cumple.
--
-- El cutover es una operación aparte y explícitamente autorizada
-- (migración 119). Mientras esta migración sea lo único aplicado,
-- el comportamiento de producción es IDÉNTICO al de hoy.
--
-- ── Por qué hace falta una función de publicación nueva ─────
--
-- `publish_industry_catalog_version` (migración 057, sección 8)
-- valida que «cada industria activa tenga al menos una
-- subindustria activa». El catálogo macro tiene CERO
-- subindustrias por diseño de producto, así que esa función lo
-- rechazaría. No se relaja: se añade una hermana con la
-- validación que corresponde a un catálogo macro —al menos una
-- industria activa y EXACTAMENTE cero subindustrias—, de modo que
-- ninguna de las dos pueda publicar el catálogo de la otra por
-- accidente.
--
-- ── Por qué hace falta una vista nueva ──────────────────────
--
-- `active_industry_catalog` hace INNER JOIN con `subindustries`.
-- Una industria sin subindustrias es INVISIBLE en esa vista. Bajo
-- v2 la vista devolvería cero filas. Cambiar su JOIN alteraría la
-- forma del payload para las corridas históricas; se añade una
-- vista propia y la de siempre queda intacta.
--
-- ── Reproducibilidad histórica (§ 21) ───────────────────────
--
-- Los ids de v1 son UUID determinísticos ya existentes y no se
-- tocan. Publicar v2 archiva v1, y una versión archivada sigue
-- siendo consultable con todas sus filas: los lotes creados bajo
-- 1.0.0 conservan sus etiquetas originales.
-- ============================================================


-- ============================================================
-- SECCIÓN 1: vista del catálogo macro activo
-- ============================================================

CREATE OR REPLACE VIEW public.active_macro_industry_catalog AS
SELECT
    v.id          AS catalog_version_id,
    v.version     AS catalog_version,
    v.name        AS catalog_name,
    v.published_at,
    i.id          AS industry_id,
    i.name        AS industry_name,
    i.slug        AS industry_slug,
    i.description AS industry_description,
    i.sort_order  AS industry_sort_order,
    -- Permite al consumidor saber si esta versión trae selección de
    -- subindustria sin tener que consultar una segunda vista.
    EXISTS (
        SELECT 1
        FROM public.subindustries s
        WHERE s.industry_id = i.id
          AND s.active = true
    )             AS has_active_subindustries
FROM public.industry_catalog_versions v
JOIN public.industries i
    ON  i.catalog_version_id = v.id
    AND i.active = true
WHERE v.status = 'published'
ORDER BY i.sort_order;

COMMENT ON VIEW public.active_macro_industry_catalog IS
    'Catálogo activo a nivel de INDUSTRIA: versión publicada + industrias activas, '
    'sin exigir subindustrias. Base del selector de Macro Industria (catálogo v2). '
    'active_industry_catalog sigue siendo la vista de industria + subindustria.';

ALTER VIEW public.active_macro_industry_catalog SET (security_invoker = true);

REVOKE ALL ON public.active_macro_industry_catalog FROM public;
REVOKE ALL ON public.active_macro_industry_catalog FROM anon;
REVOKE ALL ON public.active_macro_industry_catalog FROM authenticated;
REVOKE ALL ON public.active_macro_industry_catalog FROM service_role;
GRANT SELECT ON public.active_macro_industry_catalog TO authenticated;
GRANT SELECT ON public.active_macro_industry_catalog TO service_role;


-- ============================================================
-- SECCIÓN 2: publicación de un catálogo SIN subindustrias
-- ============================================================

CREATE OR REPLACE FUNCTION public.publish_macro_industry_catalog_version(
    p_version_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_status              TEXT;
    v_industry_count      INTEGER;
    v_subindustry_count   INTEGER;
    v_prev_published_id   UUID;
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

    -- 2. Al menos una industria activa
    SELECT COUNT(*) INTO v_industry_count
    FROM public.industries
    WHERE catalog_version_id = p_version_id
      AND active = true;

    IF v_industry_count = 0 THEN
        RAISE EXCEPTION
            'La versión de catálogo debe contener al menos una industria activa antes de publicarse.';
    END IF;

    -- 3. EXACTAMENTE cero subindustrias.
    --
    -- Es lo que impide que esta función publique por error un catálogo
    -- de la taxonomía legacy: si alguien intentara publicar 1.0.0 con
    -- ella, la validación de subindustrias que 057 exige se saltaría.
    -- Un catálogo macro no tiene subindustrias; uno que las tenga se
    -- publica con `publish_industry_catalog_version`.
    SELECT COUNT(*) INTO v_subindustry_count
    FROM public.subindustries
    WHERE catalog_version_id = p_version_id;

    IF v_subindustry_count <> 0 THEN
        RAISE EXCEPTION
            'Esta función publica solo catálogos de macro industria (cero subindustrias). '
            'La versión % tiene % subindustrias: usa publish_industry_catalog_version.',
            p_version_id, v_subindustry_count;
    END IF;

    -- 4. Archivar la versión publicada anterior (transición permitida
    --    explícitamente por protect_catalog_version_transitions).
    SELECT id INTO v_prev_published_id
    FROM public.industry_catalog_versions
    WHERE status = 'published'
    FOR UPDATE;

    IF v_prev_published_id IS NOT NULL THEN
        UPDATE public.industry_catalog_versions
        SET status      = 'archived',
            archived_at = now(),
            updated_at  = now()
        WHERE id = v_prev_published_id;
    END IF;

    -- 5. Publicar
    UPDATE public.industry_catalog_versions
    SET status       = 'published',
        published_at = now(),
        updated_at   = now()
    WHERE id = p_version_id;

END;
$$;

COMMENT ON FUNCTION public.publish_macro_industry_catalog_version(UUID) IS
    'Publica atómicamente una versión de catálogo de MACRO INDUSTRIA (cero subindustrias). '
    'Archiva la versión publicada anterior. Rechaza cualquier versión que tenga subindustrias.';

REVOKE ALL ON FUNCTION public.publish_macro_industry_catalog_version(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publish_macro_industry_catalog_version(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.publish_macro_industry_catalog_version(UUID) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.publish_macro_industry_catalog_version(UUID) TO service_role;


-- ============================================================
-- SECCIÓN 3: versión 2.0.0 en DRAFT + las 12 Macro Industrias
-- ============================================================
-- Los UUID son fijos y determinísticos para que el mismo catálogo
-- tenga los mismos ids en todos los entornos, y para que esta
-- migración sea idempotente (ON CONFLICT DO NOTHING).
--
-- Los `name` son EXACTAMENTE los de § 5 del hito: no se corrigen,
-- no se normalizan y no se reinterpretan.
--
-- Los `slug` derivan mecánicamente de la clave canónica del módulo
-- `src/modules/macro-industry-catalog/macro-industries.ts`
-- sustituyendo `_` por `-`, para conservar la convención kebab-case
-- de la versión 1.0.0. Una prueba de la suite
-- `test:a1-macro-industry-catalog-discovery` compara esta lista
-- contra ese módulo fila por fila: si divergen, falla.
-- ============================================================

INSERT INTO public.industry_catalog_versions (id, version, status, name, description)
VALUES (
    'b2c4e6a8-0d1f-4a3b-8c5d-7e9f0a1b2c3d',
    '2.0.0',
    'draft',
    'Catálogo de Macro Industrias SellUp',
    'Taxonomía de 12 Macro Industrias. Exactamente una por búsqueda. '
    'Sin selección de subindustria: el desarrollo de subindustrias se conserva '
    'íntegro en la versión 1.0.0 y en el código, desactivado por capacidad de producto.'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.industries (id, catalog_version_id, name, slug, description, active, sort_order)
VALUES
    ('c1000001-0000-4000-8000-000000000001', 'b2c4e6a8-0d1f-4a3b-8c5d-7e9f0a1b2c3d',
     'Transporte & Logística', 'transport-logistics',
     'Operadores logísticos, transporte de carga, aduanas, courier, almacenamiento y operación portuaria.',
     true, 1),
    ('c1000002-0000-4000-8000-000000000002', 'b2c4e6a8-0d1f-4a3b-8c5d-7e9f0a1b2c3d',
     'Tecnología', 'technology',
     'Software empresarial, ciberseguridad, cloud, datos, inteligencia artificial y servicios de TI.',
     true, 2),
    ('c1000003-0000-4000-8000-000000000003', 'b2c4e6a8-0d1f-4a3b-8c5d-7e9f0a1b2c3d',
     'Seguros y Servicios Financieros', 'insurance-financial-services',
     'Aseguradoras, corredores, banca, cooperativas financieras, factoring, leasing y gestión de activos.',
     true, 3),
    ('c1000004-0000-4000-8000-000000000004', 'b2c4e6a8-0d1f-4a3b-8c5d-7e9f0a1b2c3d',
     'Salud & Farmacéuticos', 'health-pharma',
     'Clínicas y redes hospitalarias, laboratorios farmacéuticos y clínicos, dispositivos médicos y aseguradores de salud.',
     true, 4),
    ('c1000005-0000-4000-8000-000000000005', 'b2c4e6a8-0d1f-4a3b-8c5d-7e9f0a1b2c3d',
     'Retail', 'retail',
     'Comercio minorista: supermercados, tiendas por departamento, cadenas especializadas y operadores omnicanal.',
     true, 5),
    ('c1000006-0000-4000-8000-000000000006', 'b2c4e6a8-0d1f-4a3b-8c5d-7e9f0a1b2c3d',
     'Propiedad & Construcción', 'property-construction',
     'Constructoras, obra civil e infraestructura, promotoras inmobiliarias y administración de propiedad.',
     true, 6),
    ('c1000007-0000-4000-8000-000000000007', 'b2c4e6a8-0d1f-4a3b-8c5d-7e9f0a1b2c3d',
     'Industria / Manufactura / Químicos / Automotor', 'industry-manufacturing-chemicals-automotive',
     'Plantas de producción, metalmecánica, autopartes y automotor, químicos, plásticos, packaging y bienes de capital.',
     true, 7),
    ('c1000008-0000-4000-8000-000000000008', 'b2c4e6a8-0d1f-4a3b-8c5d-7e9f0a1b2c3d',
     'Gobierno', 'government',
     'Entidades públicas, administración central y territorial, y empresas del Estado.',
     true, 8),
    ('c1000009-0000-4000-8000-000000000009', 'b2c4e6a8-0d1f-4a3b-8c5d-7e9f0a1b2c3d',
     'Gas / Petróleo / Energía / Minería / Medio Ambiente', 'energy-mining-environment',
     'Exploración y producción, refinación, gas, generación y comercialización eléctrica, renovables, minería y gestión ambiental.',
     true, 9),
    ('c1000010-0000-4000-8000-000000000010', 'b2c4e6a8-0d1f-4a3b-8c5d-7e9f0a1b2c3d',
     'Consumo Masivo', 'consumer-goods',
     'Fabricantes y marcas de alimentos, bebidas, cuidado personal e higiene del hogar.',
     true, 10),
    ('c1000011-0000-4000-8000-000000000011', 'b2c4e6a8-0d1f-4a3b-8c5d-7e9f0a1b2c3d',
     'Compañía de Servicios', 'services-company',
     'Consultoría, auditoría, servicios legales, BPO y contact center, staffing, facilities, seguridad privada e investigación de mercados.',
     true, 11),
    ('c1000012-0000-4000-8000-000000000012', 'b2c4e6a8-0d1f-4a3b-8c5d-7e9f0a1b2c3d',
     'Agroindustria', 'agroindustry',
     'Producción agrícola y pecuaria, agroindustria procesadora, floricultura, acuicultura y exportación agrícola.',
     true, 12)
ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- VERIFICACIÓN (informativa, no bloqueante)
-- ============================================================
-- SELECT version, status FROM public.industry_catalog_versions ORDER BY created_at;
--   → 1.0.0 published   (sin cambios)
--   → 2.0.0 draft       (nueva)
--
-- SELECT count(*) FROM public.industries
--  WHERE catalog_version_id = 'b2c4e6a8-0d1f-4a3b-8c5d-7e9f0a1b2c3d';
--   → 12
--
-- SELECT count(*) FROM public.active_macro_industry_catalog;
--   → 8   (las de 1.0.0, que sigue siendo la publicada)
-- ============================================================
