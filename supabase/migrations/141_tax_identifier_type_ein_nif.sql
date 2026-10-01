-- ============================================================
-- Migration 141: los tipos de identificador fiscal aceptan EIN y NIF
-- ============================================================
-- SOURCES-US-EIN-BY-NAME-1.
--
-- El Agente 1 ya obtiene el número fiscal por nombre en 12 países. Para Estados
-- Unidos el identificador es el EIN (SEC EDGAR e IRS), y para España el NIF. Hoy
-- `accounts` y `prospect_candidates` sólo aceptan los tipos latinoamericanos más
-- cedula_juridica y other: escribir 'EIN' fallaría la inserción entera.
--
-- Sólo AMPLÍA las dos listas (misma lista + 'EIN' y 'NIF'). No cambia datos, no
-- toca otras columnas y ningún valor existente deja de ser válido.
--
-- Orden obligatorio: aplicar ESTA migración ANTES de cargar las fuentes de
-- Estados Unidos (`us_sec_edgar_registry`, `us_irs_eo_registry`). Sin datos
-- cargados, el resolvedor nunca devuelve 'EIN'.
--
-- 🔴 NO APLICADA al escribirla.
-- ============================================================

ALTER TABLE accounts
    DROP CONSTRAINT IF EXISTS accounts_tax_identifier_type_check;
ALTER TABLE accounts
    ADD CONSTRAINT accounts_tax_identifier_type_check
    CHECK (tax_identifier_type IN (
        'NIT', 'RFC', 'RUT', 'RUC', 'CUIT', 'CNPJ',
        'RNC', 'RTN', 'cedula_juridica', 'other',
        'EIN', 'NIF'
    ));

ALTER TABLE prospect_candidates
    DROP CONSTRAINT IF EXISTS prospect_candidates_tax_identifier_type_check;
ALTER TABLE prospect_candidates
    ADD CONSTRAINT prospect_candidates_tax_identifier_type_check
    CHECK (tax_identifier_type IN (
        'NIT', 'RFC', 'RUT', 'RUC', 'CUIT', 'CNPJ',
        'RNC', 'RTN', 'cedula_juridica', 'other',
        'EIN', 'NIF', NULL
    ));
