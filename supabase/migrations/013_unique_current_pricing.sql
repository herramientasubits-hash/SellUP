-- Garantizar unicidad de tarifa vigente por modelo
-- Sin este constraint, una falla entre UPDATE y INSERT en addModelPricing
-- podría dejar un modelo con 0 o múltiples tarifas vigentes simultáneas.

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_model_pricing_one_current_per_model
    ON ai_model_pricing (model_id)
    WHERE is_current = true;
