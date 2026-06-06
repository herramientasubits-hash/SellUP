-- ============================================================
-- Migration 056: Migración del scheduler durable a Supabase Cron
-- ============================================================
-- Propósito: Configurar Supabase Cron (pg_cron) para invocar de forma
-- segura el endpoint de enriquecimiento durable de SellUp cada 2 minutos.
-- Evita el uso de Vercel Cron en Hobby Tier.
-- Lee las credenciales y la URL únicamente desde Supabase Vault.
-- ============================================================

-- 1. Habilitar o verificar extensiones requeridas en Supabase
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

-- 2. Función dedicada para invocar el endpoint de enriquecimiento
CREATE OR REPLACE FUNCTION public.invoke_sellup_enrichment_worker()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_temp
AS $$
DECLARE
    v_url TEXT;
    v_secret TEXT;
    v_url_count INTEGER;
    v_secret_count INTEGER;
    v_headers JSONB;
    v_request_id BIGINT;
BEGIN
    -- Leer ambos valores desde vault.decrypted_secrets y exigir exactamente un registro para cada uno
    SELECT pg_catalog.count(*), pg_catalog.max(decrypted_secret) 
    INTO v_url_count, v_url
    FROM vault.decrypted_secrets
    WHERE name = 'sellup_enrichment_cron_url';

    SELECT pg_catalog.count(*), pg_catalog.max(decrypted_secret) 
    INTO v_secret_count, v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'sellup_enrichment_cron_secret';

    -- Exigir existencia única y no nula
    IF v_url_count <> 1 OR v_secret_count <> 1 THEN
        RAISE EXCEPTION 'enrichment_cron_configuration_unavailable';
    END IF;

    -- Validar URL y secreto de forma segura
    IF v_url IS NULL OR v_url = '' OR NOT (v_url LIKE 'https://%') OR NOT (v_url LIKE '%/api/cron/enrich%') THEN
        RAISE EXCEPTION 'enrichment_cron_configuration_unavailable';
    END IF;

    IF v_secret IS NULL OR v_secret = '' THEN
        RAISE EXCEPTION 'enrichment_cron_configuration_unavailable';
    END IF;

    -- Construir headers
    v_headers := pg_catalog.jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_secret
    );

    -- Ejecutar POST HTTP
    v_request_id := net.http_post(
        url := v_url,
        body := '{"source": "supabase_cron"}'::jsonb,
        params := '{}'::jsonb,
        headers := v_headers,
        timeout_milliseconds := 60000
    );

    RETURN v_request_id;
END;
$$;

-- 3. Configuración de seguridad para restringir el acceso a la función
REVOKE ALL ON FUNCTION public.invoke_sellup_enrichment_worker() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_sellup_enrichment_worker() TO postgres, service_role;

COMMENT ON FUNCTION public.invoke_sellup_enrichment_worker() IS 
    'Invocador seguro para el endpoint de enriquecimiento durable de SellUp, resolviendo secretos desde Supabase Vault.';

-- 4. Programación del Cron Job de forma idempotente
-- Remover el cron job si ya existe para evitar duplicación
SELECT cron.unschedule(jobname)
FROM cron.job
WHERE jobname = 'sellup-enrichment-worker';

-- Programar el job para ejecutarse cada 2 minutos
SELECT cron.schedule(
    'sellup-enrichment-worker',
    '*/2 * * * *',
    $$SELECT public.invoke_sellup_enrichment_worker();$$
);

-- ============================================================
-- PROCEDIMIENTO DE ROLLBACK (SOLO REFERENCIA, NO EJECUTAR EN MIGRACIÓN)
-- ============================================================
-- Para revertir esta migración y remover la automatización sin alterar la cola de trabajos ni Vault:
--
-- SELECT cron.unschedule('sellup-enrichment-worker');
-- DROP FUNCTION IF EXISTS public.invoke_sellup_enrichment_worker();
-- ============================================================
