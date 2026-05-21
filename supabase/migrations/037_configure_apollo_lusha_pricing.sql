-- ============================================================
-- Migration 037: Configurar precios reales Apollo y Lusha
-- ============================================================
-- Contratos vigentes 2026 entregados por negocio:
--
-- Apollo: USD 4,200 anuales / 480,000 créditos compartidos
--         → 4200 / 480000 = 0.00875000 USD por crédito. Corte Oct 13.
--
-- Lusha:  USD 300/mes cobrados anualmente = USD 3,600/año
--         / 40,800 créditos compartidos/mes
--         → 3600 / 40800 = 0.08823529 USD por crédito. Corte Nov.
--
-- NOTA: La migración 036 sembró Lusha con costo incorrecto (0.00735294),
-- calculado dividiendo el pago mensual (no anual) entre créditos.
-- Esta migración corrige ese error y agrega las filas canónicas por crédito.
-- ============================================================

-- ── 1. Corregir precios Lusha sembrados en 036 ───────────────
-- Las filas per_result de Lusha tenían el costo mensual (USD 300)
-- en lugar del costo anual (USD 3,600) dividido entre créditos.
UPDATE public.provider_pricing_config
SET
  unit_cost_usd = 0.08823529,
  notes         = 'Contrato Lusha: USD 300/mes cobrados anualmente = USD 3,600/año / 40,800 créditos compartidos/mes. Fecha de corte: noviembre. Corregido en migración 037.',
  updated_at    = now()
WHERE provider_key   = 'lusha'
  AND operation_key  IN ('person_enrich', 'company_enrich')
  AND unit           = 'per_result'
  AND is_active      = true;

-- ── 2. Actualizar notas Apollo per_result para consistencia ──
UPDATE public.provider_pricing_config
SET
  notes      = 'Contrato anual Apollo: USD 4,200 / 480,000 créditos compartidos. Fecha de corte: Oct 13. Costo estimado por resultado.',
  updated_at = now()
WHERE provider_key  = 'apollo'
  AND operation_key IN ('company_search', 'person_enrich')
  AND unit          = 'per_result'
  AND is_active     = true;

-- ── 3. Insertar filas canónicas per_credit ───────────────────
-- Estas son las filas de referencia que los agentes usarán
-- cuando consuman créditos sin mapear a una operación específica.
INSERT INTO public.provider_pricing_config
  (provider_key, operation_key, unit, unit_cost_usd, currency, notes, is_active)
VALUES
  (
    'apollo',
    'credit',
    'per_credit',
    0.00875000,
    'USD',
    'Contrato anual Apollo: USD 4,200 / 480,000 créditos compartidos. Fecha de corte: Oct 13. Costo estimado por crédito.',
    true
  ),
  (
    'lusha',
    'credit',
    'per_credit',
    0.08823529,
    'USD',
    'Contrato Lusha: USD 300 mensuales cobrados anualmente = USD 3,600 / 40,800 créditos compartidos. Fecha de corte: noviembre. Costo estimado por crédito.',
    true
  )
ON CONFLICT DO NOTHING;
