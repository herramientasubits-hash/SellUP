-- ============================================================================
-- AGENT1-SUBINDUSTRY-PRECISION-COVERAGE-1 · PHASE 1 · consultas de auditoría
-- ============================================================================
-- SÓLO LECTURA. Cero escrituras, cero DDL, cero RPC, cero créditos.
-- Ejecutadas contra Prod `lrdruowtadwbdulndlph` el 2026-08-11 vía MCP numerado.
--
-- Resultados congelados en:
--   docs/diagnostics/agent1_subindustry_precision_coverage_matrix.md
--
-- Notas de esquema que estas consultas verificaron y que conviene no volver a
-- adivinar:
--   * `industries.active` / `subindustries.active` — NO `is_active`.
--   * `subindustry_search_terms` NO tiene `catalog_version_id`: se llega por
--     `subindustry_id → subindustries.catalog_version_id`. La vista
--     `active_subindustry_search_terms` SÍ lo expone.
--   * `subindustry_rules` tampoco lo tiene; `industry_rules` sí.
-- ============================================================================


-- 1 · Versión publicada + totales del catálogo -------------------------------
select v.id as catalog_version_id, v.version, v.status, v.published_at,
  (select count(*) from industries i where i.catalog_version_id = v.id) as industries_total,
  (select count(*) from industries i where i.catalog_version_id = v.id and i.active) as industries_active,
  (select count(*) from subindustries s where s.catalog_version_id = v.id) as subindustries_total,
  (select count(*) from subindustries s join industries i on i.id = s.industry_id
     where s.catalog_version_id = v.id and s.active and i.active) as subindustries_active,
  (select count(*) from subindustry_search_terms t join subindustries s on s.id = t.subindustry_id
     where s.catalog_version_id = v.id) as terms_total,
  (select count(*) from subindustry_search_terms t join subindustries s on s.id = t.subindustry_id
     where s.catalog_version_id = v.id and t.active) as terms_active
from industry_catalog_versions v
order by v.status, v.version;


-- 2 · Desglose de `subindustry_search_terms` por `term_type` -----------------
select t.term_type, count(*) as rows, count(distinct t.subindustry_id) as subindustries_with_type,
       string_agg(distinct coalesce(t.language_code, 'null'), ',') as lang_codes,
       string_agg(distinct coalesce(t.country_code, 'null'), ',') as country_codes,
       min(t.weight) as min_weight, max(t.weight) as max_weight
from subindustry_search_terms t join subindustries s on s.id = t.subindustry_id
where t.active and s.active
group by t.term_type
order by t.term_type;


-- 3 · Matriz por subindustria: términos por tipo ------------------------------
select i.name as industry, s.name as subindustry, s.id::text as subindustry_id, s.applicable_countries,
  count(t.id) filter (where t.active and t.term_type = 'keyword')        as kw,
  count(t.id) filter (where t.active and t.term_type = 'query_phrase')   as qp,
  count(t.id) filter (where t.active and t.term_type = 'exclusion_term') as ex,
  count(t.id) filter (where t.active and t.term_type = 'source_hint')    as sh
from subindustries s
join industries i on i.id = s.industry_id
left join subindustry_search_terms t on t.subindustry_id = s.id
where s.active and i.active
group by i.name, i.sort_order, s.name, s.id, s.sort_order, s.applicable_countries
order by i.sort_order, s.sort_order;


-- 4 · Matriz por subindustria: alias y reglas ---------------------------------
select i.name as ind, s.name as sub, s.slug,
  (select count(*) from subindustry_aliases a
     where a.subindustry_id = s.id and a.active) as al,
  (select count(*) from subindustry_rules r
     where r.subindustry_id = s.id and r.active and r.rule_type = 'inclusion') as inc,
  (select count(*) from subindustry_rules r
     where r.subindustry_id = s.id and r.active and r.rule_type = 'exclusion') as exc
from subindustries s join industries i on i.id = s.industry_id
where s.active and i.active
order by i.sort_order, s.sort_order;


-- 5 · `subindustry_rules`: forma real de las 364 filas ------------------------
-- Resultado 2026-08-11: execution_layer = 'model' en el 100 % de las filas y
-- `configuration = '{}'` en 362/364. Son reglas en PROSA para el LLM, no reglas
-- deterministas, y ningún módulo de `src/` las lee.
select rule_type, execution_layer, priority, count(*) as rows,
       count(distinct subindustry_id) as subs,
       count(*) filter (where configuration <> '{}'::jsonb) as with_config
from subindustry_rules
where active
group by rule_type, execution_layer, priority
order by rows desc;


-- 6 · CHECKs vigentes del substrato de reglas/términos ------------------------
-- Verifica el hallazgo clave: `rules_execution_layer_valid` YA admite 'code' y
-- 'combined', y `rules_type_valid` ya admite 'evidence_requirement'/'quality_gate'.
-- Una capa de precisión data-driven no necesita DDL nuevo sobre estas tablas.
select conname, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid in ('public.subindustry_rules'::regclass,
                   'public.subindustry_search_terms'::regclass,
                   'public.subindustry_aliases'::regclass)
order by conname;


-- 7 · Grafo latente de conflicto en las reglas de exclusión -------------------
-- 118 exclusiones activas; 35 llevan «→ destino»; 18 de esos destinos resuelven a
-- un `subindustries.slug` real. El resto es prosa («Servicios Financieros»,
-- «Consultoría o Tecnología») y NO es utilizable como arista determinista.
with ex as (
  select r.id, s.name as src, trim(both ' )' from split_part(r.rule_text, '→', 2)) as target_raw
  from subindustry_rules r join subindustries s on s.id = r.subindustry_id
  where r.active and r.rule_type = 'exclusion' and r.rule_text like '%→%'
)
select ex.src, ex.target_raw,
  (select count(*) from subindustries t
     where t.active and (t.slug = ex.target_raw or ex.target_raw like '%' || t.slug)) as slug_resolves
from ex
order by slug_resolves desc, ex.src;


-- 8 · Demanda real por industria (read-only) ----------------------------------
select metadata->>'industry' as industry, count(*) as searches,
       min(created_at)::date as first, max(created_at)::date as last
from provider_usage_logs
where provider_key = 'apollo' and operation_key = 'organizations_search'
group by 1
order by searches desc;


-- 9 · Demanda real por subindustria mencionada en la query -------------------
select s.name as subindustry, i.name as industry, count(*) as searches_mentioning
from provider_usage_logs l
join subindustries s on s.active
join industries i on i.id = s.industry_id
where l.provider_key = 'apollo' and l.operation_key = 'organizations_search'
  and (l.metadata->>'query') ilike '%' || s.name || '%'
group by 1, 2
order by searches_mentioning desc;


-- 10 · Vocabulario de proveedor REALMENTE observado ---------------------------
select raw_label, normalized_lookup_key, observed_count, requested_industry,
       country_code, operation_key, last_observed_at::date
from provider_industry_raw_label_observations
order by observed_count desc, raw_label;


-- 11 · Estado del substrato provider→industria (inerte) ----------------------
select
  (select count(*) from provider_industry_source_vocabularies)      as vocabularies,
  (select count(*) from provider_industry_mapping_snapshots)        as snapshots,
  (select count(*) from provider_industry_concept_entries)          as concept_entries,
  (select count(*) from provider_industry_mapping_associations)     as associations;


-- 12 · Postura de privilegios y RLS de las tablas de catálogo ----------------
-- Hallazgo: la tabla base `subindustry_rules` arrastra los default privileges de
-- Supabase (ALL para anon/authenticated) — misma clase que 4H/4I. RLS está
-- ENABLED y sólo existe policy de SELECT, así que anon/authenticated no pueden
-- escribir; `service_role` sí (bypass RLS + grants DML). Exposición efectiva hoy: 0
-- escritores en `src/`. A controlar ANTES de convertir estas tablas en la fuente
-- de precisión.
select tablename, policyname, cmd, roles::text, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('subindustry_rules', 'subindustry_search_terms',
                    'subindustries', 'industry_catalog_versions')
order by tablename, policyname;

select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('subindustry_rules', 'active_subindustry_rules')
group by table_name, grantee
order by table_name, grantee;


-- 13 · Subindustrias pedidas según la precisión ya persistida ----------------
select jsonb_array_elements_text(
         coalesce(metadata->'apollo_enrichment_capture'->'precision'->'requested_subindustries',
                  metadata->'subindustry_precision'->'requested_subindustries',
                  '[]'::jsonb)) as requested,
       count(*) as candidates
from prospect_candidates
group by 1
order by candidates desc;
