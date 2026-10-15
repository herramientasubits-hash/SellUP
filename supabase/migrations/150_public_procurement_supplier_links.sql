-- ═══════════════════════════════════════════════════════════════════
-- 150 — Quién le vende a cada entidad pública (compras públicas)
-- (AGENT1-SUPPLIER-SEARCH-CL-1; decisión de la dueña el 15-10)
-- ═══════════════════════════════════════════════════════════════════
--
-- POR QUÉ
--
-- «Proveedores de una empresa» saca los proveedores de una entidad pública de
-- las compras públicas. En Colombia SECOP II se consulta en vivo. En Chile no:
-- la API de Mercado Público pide un ticket que no se puede obtener, y la API
-- abierta (OCDS) no filtra por comprador. Lo que sí es abierto y sin ticket son
-- los archivos MENSUALES de órdenes de compra de ChileCompra
-- (datos-abiertos.chilecompra.cl). Hay que cargarlos y guardar el resumen.
--
-- QUÉ HACE
--
--   1. Tabla public_procurement_supplier_links: UNA fila por entidad compradora
--      × proveedor (empresa) dentro de la ventana cargada, con el monto total,
--      el número de órdenes, el monto por familia UNSPSC (para la industria del
--      proveedor), las fechas y la orden más grande como prueba.
--      Sirve a cualquier país (`country_code`); hoy sólo la llena Chile.
--   2. Índices: por nombre normalizado del comprador (para reconocer la
--      referencia) y por comprador + monto (para listar sus proveedores).
--   3. RLS activada SIN políticas: sólo service_role lee y escribe (igual que
--      la tabla de fotos de fuentes oficiales). La lee el servidor del asistente.
--
-- QUÉ NO GUARDA
--
--   * Personas naturales (RUT de empresa sólo), cuentas bancarias, contactos ni
--     el detalle de cada ítem. Sólo el resumen comprador × proveedor.
--   * Compras chicas: el cargador sólo deja pares con al menos el piso de monto
--     acumulado en la ventana (por defecto CLP 10 millones).
--
-- QUÉ NO HACE
--
--   * NO toca prospect_candidates, prospect_batches, las fotos de fuentes oficiales,
--     reclamos globales (140), presupuesto ni HubSpot.
--   * NO cambia ninguna fila existente.
--
-- Recarga: el cargador hace upsert de la ventana nueva y DESPUÉS borra las filas
-- del país y fuente que no se recargaron (`loaded_at` anterior). La tabla nunca
-- queda vacía a mitad de camino.
--
-- Reversible: DROP TABLE public.public_procurement_supplier_links (sólo pierde
-- el resumen; se vuelve a construir con el cargador).

CREATE TABLE IF NOT EXISTS public.public_procurement_supplier_links (
    country_code            TEXT        NOT NULL,
    source_key              TEXT        NOT NULL,

    buyer_code              TEXT        NOT NULL,
    buyer_tax_id            TEXT        NULL,
    buyer_name              TEXT        NOT NULL,
    buyer_name_normalized   TEXT        NOT NULL,
    buyer_sector            TEXT        NULL,

    supplier_tax_id         TEXT        NOT NULL,
    supplier_name           TEXT        NOT NULL,

    total_amount            NUMERIC     NOT NULL
        CONSTRAINT public_procurement_supplier_links_amount_check CHECK (total_amount >= 0),
    currency                TEXT        NOT NULL,
    order_count             INTEGER     NOT NULL
        CONSTRAINT public_procurement_supplier_links_orders_check CHECK (order_count >= 1),
    amount_by_family        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    first_order_on          DATE        NULL,
    last_order_on           DATE        NULL,
    top_order_code          TEXT        NULL,
    top_order_url           TEXT        NULL,
    top_order_amount        NUMERIC     NULL,

    window_start            DATE        NOT NULL,
    window_end              DATE        NOT NULL,
    loaded_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT public_procurement_supplier_links_pkey
        PRIMARY KEY (country_code, source_key, buyer_code, supplier_tax_id),
    CONSTRAINT public_procurement_supplier_links_window_check
        CHECK (window_start <= window_end)
);

CREATE INDEX IF NOT EXISTS public_procurement_supplier_links_buyer_name_idx
    ON public.public_procurement_supplier_links (country_code, buyer_name_normalized text_pattern_ops);

CREATE INDEX IF NOT EXISTS public_procurement_supplier_links_buyer_amount_idx
    ON public.public_procurement_supplier_links (country_code, buyer_code, total_amount DESC);

ALTER TABLE public.public_procurement_supplier_links ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.public_procurement_supplier_links IS
    'AGENT1-SUPPLIER-SEARCH-CL-1 — resumen entidad compradora × proveedor de las compras públicas (hoy ChileCompra, órdenes de compra mensuales). Sólo service_role.';
