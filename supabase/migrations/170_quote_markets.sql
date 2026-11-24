-- 170 — Cotizador de Ventas: regiones que cotiza cada persona.
--
-- El cotizador (pantalla /quotes) solo le muestra a cada vendedor los países de
-- sus regiones. Un admin las asigna en Configuración → Cotizador. El admin, el
-- manager y el líder comercial cotizan todas las regiones por su rol: para ellos
-- no hace falta fila aquí (lo resuelve la app, src/modules/sales-quote/quote-access.ts).
--
-- Una fila por persona y región. Las regiones son las del cotizador original
-- (Andina, Chile, México, Centroamérica, Otros).
--
-- Lee y escribe sólo el servidor con la llave de servicio (mismo patrón que
-- budget_approval_requests en la 163): ni `anon` ni `authenticated` tocan la tabla.
-- No toca filas existentes.

CREATE TABLE IF NOT EXISTS public.internal_user_quote_markets (
  user_id     UUID         NOT NULL REFERENCES public.internal_users(id) ON DELETE CASCADE,
  market      TEXT         NOT NULL
    CONSTRAINT internal_user_quote_markets_market_valid
      CHECK (market IN ('Andina', 'Chile', 'México', 'Centroamérica', 'Otros')),
  assigned_by UUID         NULL REFERENCES public.internal_users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, market)
);

COMMENT ON TABLE public.internal_user_quote_markets IS
  'Regiones que cada persona puede cotizar en el cotizador de Ventas (las asigna un admin).';

ALTER TABLE public.internal_user_quote_markets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role full access" ON public.internal_user_quote_markets;
CREATE POLICY "service_role full access"
  ON public.internal_user_quote_markets
  FOR ALL TO service_role USING (true) WITH CHECK (true);
