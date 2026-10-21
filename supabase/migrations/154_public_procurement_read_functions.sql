-- ═══════════════════════════════════════════════════════════════════
-- 154 — Lecturas de compras públicas para «Proveedores de una empresa»
-- (AGENT1-SUPPLIER-REFERENCE-SUGGEST-1 y AGENT1-SUPPLIER-FREQUENT-PUBLIC-1;
--  auditoría 21-10, la dueña aprobó la migración)
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
--   2. Función list_frequent_public_procurement_suppliers(p_country_code,
--      p_min_buyers, p_limit): «Proveedores frecuentes del Estado» — empresas que le
--      venden a VARIAS entidades públicas del país (por defecto 3 o más), sin empresa
--      de referencia. Por proveedor: cuántas entidades, monto y órdenes, el monto por
--      familia SUMADO (para la industria, que se decide en el servidor con la tabla
--      aprobada de cada país), sus 3 entidades de más monto y la orden más grande como
--      prueba. Medido en Prod 21-10: Chile (el país con más filas) 1,8 s.
--   3. SECURITY INVOKER: respetan la RLS de la tabla (sólo service_role la lee).
--      EXECUTE sólo para service_role.
--
-- QUÉ NO HACE
--
--   * NO escribe nada. NO crea tablas ni índices (medido en Prod 21-10: 40 ms la
--     búsqueda por nombre con un recorrido completo de la tabla).
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

CREATE OR REPLACE FUNCTION public.list_frequent_public_procurement_suppliers(
    p_country_code  TEXT,
    p_min_buyers    INTEGER DEFAULT 3,
    p_limit         INTEGER DEFAULT 3000
)
RETURNS TABLE (
    supplier_tax_id   TEXT,
    supplier_name     TEXT,
    buyer_count       BIGINT,
    total_amount      NUMERIC,
    order_count       BIGINT,
    amount_by_family  JSONB,
    top_buyer_names   TEXT[],
    top_order_url     TEXT,
    last_order_on     DATE,
    window_start      DATE,
    window_end        DATE
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    WITH base AS (
        SELECT l.supplier_tax_id, l.supplier_name, l.buyer_code, l.buyer_name, l.total_amount,
               l.order_count, l.amount_by_family, l.top_order_url, l.top_order_amount,
               l.last_order_on, l.window_start, l.window_end
        FROM public.public_procurement_supplier_links l
        WHERE l.country_code = p_country_code
    ),
    frequent AS (
        SELECT b.supplier_tax_id,
               max(b.supplier_name)                                   AS supplier_name,
               count(DISTINCT b.buyer_code)                           AS buyer_count,
               sum(b.total_amount)                                    AS total_amount,
               sum(b.order_count)                                     AS order_count,
               (array_agg(b.buyer_name ORDER BY b.total_amount DESC))[1:3] AS top_buyer_names,
               (array_agg(b.top_order_url ORDER BY b.top_order_amount DESC NULLS LAST)
                    FILTER (WHERE b.top_order_url IS NOT NULL))[1]    AS top_order_url,
               max(b.last_order_on)                                   AS last_order_on,
               min(b.window_start)                                    AS window_start,
               max(b.window_end)                                      AS window_end
        FROM base b
        GROUP BY b.supplier_tax_id
        HAVING count(DISTINCT b.buyer_code) >= greatest(coalesce(p_min_buyers, 3), 2)
        ORDER BY count(DISTINCT b.buyer_code) DESC, sum(b.total_amount) DESC
        LIMIT least(greatest(coalesce(p_limit, 3000), 1), 5000)
    ),
    families AS (
        SELECT b.supplier_tax_id, f.key, sum(f.value::numeric) AS amount
        FROM base b
        JOIN frequent q ON q.supplier_tax_id = b.supplier_tax_id,
             jsonb_each_text(b.amount_by_family) f
        GROUP BY b.supplier_tax_id, f.key
    )
    SELECT q.supplier_tax_id,
           q.supplier_name,
           q.buyer_count,
           q.total_amount,
           q.order_count,
           coalesce((SELECT jsonb_object_agg(f.key, f.amount) FROM families f
                     WHERE f.supplier_tax_id = q.supplier_tax_id), '{}'::jsonb),
           q.top_buyer_names,
           q.top_order_url,
           q.last_order_on,
           q.window_start,
           q.window_end
    FROM frequent q
    ORDER BY q.buyer_count DESC, q.total_amount DESC;
$$;

REVOKE ALL ON FUNCTION public.list_frequent_public_procurement_suppliers(TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_frequent_public_procurement_suppliers(TEXT, INTEGER, INTEGER) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_frequent_public_procurement_suppliers(TEXT, INTEGER, INTEGER) TO service_role;

COMMENT ON FUNCTION public.list_frequent_public_procurement_suppliers(TEXT, INTEGER, INTEGER) IS
    'AGENT1-SUPPLIER-FREQUENT-PUBLIC-1 — empresas que le venden a varias entidades públicas del país (compras públicas cargadas), con montos por familia sumados. Sólo lectura, sólo service_role.';
