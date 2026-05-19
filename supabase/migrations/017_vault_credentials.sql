-- ============================================================
-- 017: Migración a Supabase Vault para credenciales de terceros
-- ============================================================
-- Propósito: Reemplazar el almacenamiento de secretos en tablas
-- de texto plano (ai_provider_credentials, external_integration_credentials)
-- por referencias a Supabase Vault. Solo las tablas funcionales de
-- conexión guardan vault_secret_id — nunca el valor del secreto.
--
-- Afecta: IA (Gemini, OpenAI, Claude) y HubSpot.
-- ============================================================

-- ============================================================
-- 1. VAULT RPCs (SECURITY DEFINER)
-- Invocadas exclusivamente desde código server-side (service role).
-- La validación de administrador se realiza en la capa de Server Actions,
-- antes de llamar a estas funciones. Estas funciones no exponen
-- el secreto descifrado excepto en get_vault_secret_decrypted,
-- que solo es accesible desde el service role.
-- ============================================================

-- Upsert: crea o actualiza un secreto en Vault. Retorna el UUID del secreto.
CREATE OR REPLACE FUNCTION upsert_vault_secret(
  p_name        TEXT,
  p_secret      TEXT,
  p_description TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_id UUID;
BEGIN
  -- Buscar secreto existente por nombre
  SELECT id INTO v_id
  FROM vault.secrets
  WHERE name = p_name
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    -- Actualizar secreto existente
    PERFORM vault.update_secret(v_id, p_secret);
    RETURN v_id;
  ELSE
    -- Crear nuevo secreto
    v_id := vault.create_secret(p_secret, p_name, COALESCE(p_description, ''));
    RETURN v_id;
  END IF;
END;
$$;

-- Leer secreto descifrado. Solo callable desde service role (server-side).
-- NUNCA retornar el resultado al browser ni loguearlo.
CREATE OR REPLACE FUNCTION get_vault_secret_decrypted(p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_secret TEXT;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = p_name
  LIMIT 1;

  RETURN v_secret;
END;
$$;

-- Verificar existencia de un secreto por nombre.
CREATE OR REPLACE FUNCTION has_vault_secret(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM vault.secrets WHERE name = p_name
  );
END;
$$;

-- Eliminar un secreto de Vault por nombre. Retorna true si fue eliminado.
CREATE OR REPLACE FUNCTION delete_vault_secret(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  DELETE FROM vault.secrets WHERE name = p_name;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

-- ============================================================
-- 2. Agregar vault_secret_id a tablas funcionales de conexión
-- ============================================================

-- Para proveedores de IA: referencia al secreto en Vault
ALTER TABLE ai_providers
  ADD COLUMN IF NOT EXISTS vault_secret_id UUID;

-- Para integraciones externas (HubSpot, etc.): referencia al secreto en Vault
ALTER TABLE external_integration_connections
  ADD COLUMN IF NOT EXISTS vault_secret_id UUID;

-- ============================================================
-- 3. Eliminar tablas de credenciales en texto plano
-- Los datos en estas tablas son tokens de desarrollo/prueba.
-- No había tokens de producción reales al momento de esta migración.
-- ============================================================

DROP TABLE IF EXISTS ai_provider_credentials;
DROP TABLE IF EXISTS external_integration_credentials;

-- ============================================================
-- Comentario arquitectónico embebido
-- ============================================================
-- SellUp usa Supabase Vault para almacenar credenciales de terceros.
-- Las tablas funcionales (ai_providers, external_integration_connections)
-- solo guardan vault_secret_id — nunca el valor del secreto.
-- Patrón aplicable a: IA (Gemini, OpenAI, Claude) y HubSpot.
-- No crear tablas nuevas con credenciales en texto plano.
-- Para agregar nuevas integraciones, usar upsert_vault_secret y
-- almacenar el UUID retornado en la tabla funcional correspondiente.
-- ============================================================
