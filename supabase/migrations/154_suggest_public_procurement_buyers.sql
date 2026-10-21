-- ═══════════════════════════════════════════════════════════════════
-- 154 — Entidades públicas sugeridas para «Proveedores de una empresa»
-- (AGENT1-SUPPLIER-REFERENCE-SUGGEST-1; auditoría 21-10, dueña aprobó la migración)
-- ═══════════════════════════════════════════════════════════════════
--
-- POR QUÉ
--
-- «Proveedores» reconoce la entidad pública de referencia por su nombre EXACTO
-- (o el comienzo). Quien escribe «IMSS» o «Seguro Social» no la encuentra y la
-- corrida pasa a Claude, que con entidades públicas no trae nada. La tabla
-- public_procurement_supplier_links (150) ya tiene 4.093 entidades con 10 o más
-- proveedores: mientras se escribe, se sugieren con su país y cuántos
-- proveedores tienen, y al elegir una el nombre coincide exacto.
--
-- Agrupar 217 mil filas por entidad no se puede desde PostgREST: una entidad
-- grande (IMSS, 963 filas) tapa a las demás. Por eso la función.
--
-- QUÉ HACE
--
--   1. Función suggest_public_procurement_buyers(p_query, p_country_code, p_limit):
--      entidades cuyo nombre normalizado CONTIENE el texto (ya normalizado por
--      quien llama: mayúsculas, sin tildes), con su número de proveedores y monto.
--      Primero las que EMPIEZAN por el texto, luego las de más proveedores.
--      Texto de menos de 3 caracteres ⇒ nada. Tope 20.
--   2. SECURITY INVOKER: respeta la RLS de la tabla (sólo service_role la lee).
--      EXECUTE sólo para service_role.
--
-- QUÉ NO HACE
--
--   * NO escribe nada. NO crea tablas ni índices (medido en Prod 21-10: 40 ms con
--     un recorrido completo de la tabla).
--   * NO toca prospect_candidates, prospect_batches, presupuesto ni HubSpot.

CREATE OR REPLACE FUNCTION public.suggest_public_procurement_buyers(
    p_query         TEXT,
    p_country_code  TEXT DEFAULT NULL,
    p_limit         INTEGER DEFAULT 8
)
RETURNS TABLE (
    country_code          TEXT,
    source_key            TEXT,
    buyer_code            TEXT,
    buyer_name            TEXT,
    buyer_name_normalized TEXT,
    supplier_count        BIGINT,
    total_amount          NUMERIC,
    currency              TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    WITH q AS (
        SELECT replace(replace(btrim(coalesce(p_query, '')), '%', ''), '_', '') AS text
    )
    SELECT
        l.country_code,
        l.source_key,
        l.buyer_code,
        max(l.buyer_name)            AS buyer_name,
        max(l.buyer_name_normalized) AS buyer_name_normalized,
        count(*)                     AS supplier_count,
        sum(l.total_amount)          AS total_amount,
        max(l.currency)              AS currency
    FROM public.public_procurement_supplier_links l, q
    WHERE length(q.text) >= 3
      AND l.buyer_name_normalized LIKE '%' || q.text || '%'
      AND (p_country_code IS NULL OR l.country_code = p_country_code)
    GROUP BY l.country_code, l.source_key, l.buyer_code
    ORDER BY bool_or(l.buyer_name_normalized LIKE (SELECT text FROM q) || '%') DESC,
             count(*) DESC,
             max(l.buyer_name_normalized) ASC
    LIMIT least(greatest(coalesce(p_limit, 8), 1), 20);
$$;

REVOKE ALL ON FUNCTION public.suggest_public_procurement_buyers(TEXT, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.suggest_public_procurement_buyers(TEXT, TEXT, INTEGER) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.suggest_public_procurement_buyers(TEXT, TEXT, INTEGER) TO service_role;

COMMENT ON FUNCTION public.suggest_public_procurement_buyers(TEXT, TEXT, INTEGER) IS
    'AGENT1-SUPPLIER-REFERENCE-SUGGEST-1 — entidades públicas cuyo nombre contiene el texto, con su número de proveedores (compras públicas cargadas). Sólo lectura, sólo service_role.';
