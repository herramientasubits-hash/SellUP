-- ============================================================
-- Migration 080: source_company_signals — Señales débiles de empresa
-- ============================================================
-- Tabla genérica para señales comerciales de fuentes externas que
-- NO tienen identificador fiscal verificable (nombre-only, directorios,
-- procurement sin NIT/NRC, eventos, cámaras de comercio débiles).
--
-- IMPORTANTE:
--   - Esta tabla NO representa identidad fiscal ni legal.
--   - NO debe usarse para matching automático con cuentas/prospectos.
--   - Las señales weak_name_only/name_only_review_required requieren
--     revisión humana explícita antes de cualquier asociación.
--   - supplier_platform_id NO es tax_id, NIT, NRC ni identificador fiscal.
--   - Post-approval automático está prohibido por diseño.
--
-- Fuentes previstas inicialmente:
--   sv_comprasal — COMPRASAL El Salvador (procurement público)
--   (futuras: cámaras de comercio, directorios sectoriales, eventos)
--
-- Hito: Centroamérica.7E.1
-- ============================================================

create table if not exists public.source_company_signals (
  id uuid primary key default gen_random_uuid(),

  -- Identificación de fuente
  source_key text not null,
  country_code text not null,
  source_year integer not null,

  -- Clasificación de señal
  signal_kind text not null,
  signal_strength text not null,
  matching_mode text not null,
  human_review_required boolean not null default true,

  -- Nombre del proveedor/empresa (sin identificador fiscal)
  supplier_name text not null,
  normalized_supplier_name text not null,
  supplier_commercial_name text null,
  normalized_supplier_commercial_name text null,

  -- ID interno de la plataforma fuente (NO es tax_id ni identificador fiscal)
  supplier_platform_id text null,

  -- Referencias a registro original
  source_record_id text null,
  source_url text null,

  -- Payload de señales normalizadas, datos brutos y metadata de control
  signals jsonb not null default '{}'::jsonb,
  raw_data jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,

  -- Fechas de señal y de importación
  first_seen_at timestamptz null,
  last_seen_at timestamptz null,
  imported_at timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- -------------------------------------------------------
  -- Constraints de valores permitidos
  -- -------------------------------------------------------
  constraint source_company_signals_signal_kind_check
    check (signal_kind in (
      'procurement',
      'industry_directory',
      'event',
      'partner',
      'manual_signal',
      'other'
    )),

  constraint source_company_signals_signal_strength_check
    check (signal_strength in (
      'weak_name_only',
      'medium_name_domain',
      'strong_identifier',
      'unknown'
    )),

  constraint source_company_signals_matching_mode_check
    check (matching_mode in (
      'name_only_review_required',
      'name_domain_review_required',
      'identifier_match_allowed',
      'manual_only'
    )),

  -- -------------------------------------------------------
  -- Guardrail: revisión humana obligatoria para name-only
  -- -------------------------------------------------------
  constraint source_company_signals_name_only_requires_review
    check (
      matching_mode <> 'name_only_review_required'
      or human_review_required = true
    ),

  constraint source_company_signals_weak_strength_requires_review
    check (
      signal_strength <> 'weak_name_only'
      or human_review_required = true
    ),

  -- -------------------------------------------------------
  -- Guardrail: nombre normalizado no vacío
  -- -------------------------------------------------------
  constraint source_company_signals_normalized_name_nonempty
    check (length(trim(normalized_supplier_name)) > 0),

  -- -------------------------------------------------------
  -- Dedupe: una señal por fuente/país/año/nombre normalizado
  -- (no requiere tax_id)
  -- -------------------------------------------------------
  constraint source_company_signals_unique_signal
    unique (source_key, country_code, source_year, normalized_supplier_name)
);

-- -------------------------------------------------------
-- Comentarios de tabla y columnas críticas
-- -------------------------------------------------------

comment on table public.source_company_signals is
'Stores weak commercial/company signals from external sources (procurement, directories, events). This table does NOT represent fiscal or legal identity and must NOT be used for automatic post-approval matching. All name_only_review_required signals require explicit human review before association with accounts or prospect candidates.';

comment on column public.source_company_signals.supplier_platform_id is
'External platform supplier id (e.g. internal id from COMPRASAL). NOT a tax id, NIT, NRC, RUT, RUC, or any fiscal identifier. Must not be used for identity matching.';

comment on column public.source_company_signals.matching_mode is
'Defines how this signal may be associated with SellUp entities. name_only_review_required: explicit human review mandatory. identifier_match_allowed: only valid when signal_strength = strong_identifier.';

comment on column public.source_company_signals.human_review_required is
'When true, this signal requires explicit human review before any association with accounts or prospect candidates. Always true for name_only_review_required and weak_name_only signals.';

comment on column public.source_company_signals.signal_strength is
'Strength classification of this signal. weak_name_only: name only, no fiscal/domain identifier. medium_name_domain: name + domain. strong_identifier: verified fiscal/registry identifier. unknown: undetermined.';

comment on column public.source_company_signals.signals is
'Normalized signal payload: amounts, dates, institutions, counts, notes. No fiscal identifiers allowed in this column.';

comment on column public.source_company_signals.raw_data is
'Original or relevant fragments from the source record. No fiscal identifiers should be stored here for name-only sources.';

comment on column public.source_company_signals.metadata is
'Internal control metadata: connector_version, import_batch_id, dry_run_source, normalization_version.';

-- -------------------------------------------------------
-- Índices de búsqueda y filtrado
-- -------------------------------------------------------

create index if not exists idx_source_company_signals_source_country
  on public.source_company_signals (source_key, country_code);

create index if not exists idx_source_company_signals_source_country_year
  on public.source_company_signals (source_key, country_code, source_year);

create index if not exists idx_source_company_signals_source_name
  on public.source_company_signals (source_key, normalized_supplier_name);

create index if not exists idx_source_company_signals_signal_strength
  on public.source_company_signals (signal_strength);

create index if not exists idx_source_company_signals_matching_mode
  on public.source_company_signals (matching_mode);

-- -------------------------------------------------------
-- Row Level Security
-- No políticas públicas. Solo acceso vía service role.
-- -------------------------------------------------------

alter table public.source_company_signals enable row level security;
