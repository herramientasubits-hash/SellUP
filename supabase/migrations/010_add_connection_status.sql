-- Agregar campos de estado de conexión a ai_providers
-- Para gestionar la conectividad de proveedores de IA

ALTER TABLE ai_providers
ADD COLUMN IF NOT EXISTS credentials_status TEXT NOT NULL DEFAULT 'missing' CHECK (
    credentials_status IN ('configured', 'missing')
),
ADD COLUMN IF NOT EXISTS connection_status TEXT NOT NULL DEFAULT 'not_tested' CHECK (
    connection_status IN ('not_tested', 'connected', 'error', 'not_configured')
),
ADD COLUMN IF NOT EXISTS last_tested_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_tested_by UUID REFERENCES internal_users(id),
ADD COLUMN IF NOT EXISTS last_connection_error TEXT;

-- Actualizar valores por defecto existentes
UPDATE ai_providers SET connection_status = 'not_configured' WHERE connection_status = 'not_tested';

-- Crear índice para búsquedas
CREATE INDEX IF NOT EXISTS idx_ai_providers_connection_status ON ai_providers(connection_status);