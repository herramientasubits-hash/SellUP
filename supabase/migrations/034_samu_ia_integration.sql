-- ============================================================
-- Migration 034: Activate Samu IA integration
-- ============================================================
-- samu_ia already exists in external_integrations (seeded in 015)
-- with is_available = false and category = 'ai'.
-- This migration:
--   1. Updates the entry to is_available = true with correct description.
--   2. Inserts the initial external_integration_connections row.
--
-- No new tables required — reuses external_integrations /
-- external_integration_connections exactly like HubSpot / Slack.
-- ============================================================

-- 1. Activate the integration and update description
UPDATE external_integrations
SET
  name        = 'Samu IA',
  description = 'Plataforma de análisis de videollamadas comerciales. Permite importar reuniones, transcripciones diarizadas e insights post-reunión hacia SellUp.',
  is_available = true,
  updated_at  = now()
WHERE integration_key = 'samu_ia';

-- 2. Create initial connection row (idempotent)
INSERT INTO external_integration_connections (
  integration_id,
  auth_type,
  credentials_status,
  connection_status
)
SELECT
  ei.id,
  'api_key',
  'missing',
  'not_tested'
FROM external_integrations ei
WHERE ei.integration_key = 'samu_ia'
  AND NOT EXISTS (
    SELECT 1
    FROM   external_integration_connections eic
    WHERE  eic.integration_id = ei.id
  );

-- Verification
SELECT
  ei.integration_key,
  ei.name,
  ei.is_available,
  eic.auth_type,
  eic.credentials_status,
  eic.connection_status
FROM external_integrations ei
LEFT JOIN external_integration_connections eic ON eic.integration_id = ei.id
WHERE ei.integration_key = 'samu_ia';
