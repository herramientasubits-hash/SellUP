-- ============================================================
-- Migration 146: los tipos de identificador fiscal aceptan RIF
-- ============================================================
-- SOURCES-VE-CLOSE-1.
--
-- Venezuela entra en el Agente 1 con el RIF por nombre (Bolsa de Caracas,
-- SUDEASEG, SUNAVAL, GLEIF y webs oficiales) y la regla del RIF con dígito
-- verificador. Hoy `accounts` y `prospect_candidates` no aceptan 'RIF':
-- escribirlo fallaría la inserción entera (también al crear a mano una empresa
-- venezolana con su RIF).
--
-- Sólo AMPLÍA las dos listas (misma lista de la 141 + 'RIF'). No cambia datos, no
-- toca otras columnas y ningún valor existente deja de ser válido.
--
-- Orden obligatorio: aplicar ESTA migración ANTES del merge del código de
-- Venezuela y ANTES de cargar `ve_rif_registry` / `ve_free_directory`.
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
        'EIN', 'NIF', 'RIF'
    ));

ALTER TABLE prospect_candidates
    DROP CONSTRAINT IF EXISTS prospect_candidates_tax_identifier_type_check;
ALTER TABLE prospect_candidates
    ADD CONSTRAINT prospect_candidates_tax_identifier_type_check
    CHECK (tax_identifier_type IN (
        'NIT', 'RFC', 'RUT', 'RUC', 'CUIT', 'CNPJ',
        'RNC', 'RTN', 'cedula_juridica', 'other',
        'EIN', 'NIF', 'RIF', NULL
    ));
