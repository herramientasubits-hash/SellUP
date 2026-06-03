-- 053_anthropic_model_executability.sql
-- Adds executability tracking columns to ai_models for Anthropic (and any provider) validation.
-- Separates "model appears in /v1/models list" (is_available) from
-- "model can actually execute a generation call" (is_executable).

ALTER TABLE ai_models
  ADD COLUMN IF NOT EXISTS is_available    BOOLEAN       DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_executable   BOOLEAN       DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS deprecation_status TEXT        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS error_message   TEXT          DEFAULT NULL;

COMMENT ON COLUMN ai_models.is_available    IS 'True if model appears in provider list API for the configured API key';
COMMENT ON COLUMN ai_models.is_executable   IS 'True if model successfully completed a real generation call (/v1/messages for Anthropic)';
COMMENT ON COLUMN ai_models.deprecation_status IS 'null=unknown, available, deprecated, unavailable_or_deprecated';
COMMENT ON COLUMN ai_models.last_checked_at  IS 'Timestamp of last availability/executability check against provider API';
COMMENT ON COLUMN ai_models.error_message    IS 'Last error captured when model was not executable';

-- Mark all existing Anthropic models as requiring verification.
-- is_executable = false prevents enrichment from trying known-bad models.
-- Admin must run "Actualizar modelos disponibles" to verify and re-enable.
UPDATE ai_models
SET
  is_available        = false,
  is_executable       = false,
  deprecation_status  = 'unknown',
  last_checked_at     = NOW(),
  error_message       = 'Pendiente verificación contra API de Anthropic. Usa Configuración > Proveedores de IA > Actualizar modelos disponibles.'
WHERE provider_id IN (
  SELECT id FROM ai_providers WHERE key = 'anthropic'
);
