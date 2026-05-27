-- ============================================================
-- Migration 043: Marcar Google CSE como no disponible
-- ============================================================
-- Motivo: Google Custom Search JSON API no está disponible para
-- nuevos proyectos de Google Cloud (PERMISSION_DENIED 403).
-- La documentación oficial de Google confirma que la Custom Search
-- JSON API no se otorga automáticamente a nuevos clientes.
--
-- Acción: is_available = false (no se borra el registro ni código).
-- El proveedor se rehabilitará cuando Google otorgue acceso válido.
-- ============================================================

UPDATE external_integrations
SET
  is_available = false,
  description  = 'Google Custom Search JSON API no está disponible para nuevos proyectos de Google Cloud. Proveedor deshabilitado hasta obtener acceso válido.',
  updated_at   = NOW()
WHERE integration_key = 'google_cse';

-- Verificación
SELECT
  integration_key,
  name,
  is_available,
  description
FROM external_integrations
WHERE integration_key = 'google_cse';
