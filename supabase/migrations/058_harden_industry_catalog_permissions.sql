-- ============================================================
-- Migration 058: Hardening de permisos del catálogo de industrias
-- Hotfix 16AB.28.2 — Cerrar permisos anónimos del catálogo
-- ============================================================
-- Contexto: La migración 057 creó vistas y la función
-- publish_industry_catalog_version. Los default privileges del
-- schema public (configurados por Supabase platform) otorgaron
-- automáticamente arwdDxtm a anon/authenticated/service_role en
-- las vistas y EXECUTE a anon en la función.
--
-- Este hotfix:
--   1. Revoca EXECUTE sobre publish_industry_catalog_version de
--      public/anon/authenticated; deja solo service_role.
--   2. Revoca todos los privilegios sobre las cuatro vistas de
--      public/anon/authenticated/service_role; re-otorga solo
--      SELECT a authenticated y service_role.
--   3. Habilita security_invoker en las cuatro vistas para que
--      las consultas respeten los permisos RLS del usuario
--      invocador en las tablas base.
--
-- No modifica: cuerpos de funciones, tablas, datos, lógica de
-- publicación, default privileges globales, UI ni workers.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Función publish_industry_catalog_version
-- ────────────────────────────────────────────────────────────
-- Causa: default privilege tipo 'f' en public concedió X a anon.
-- Corrección: revocar de public/anon/authenticated; dejar service_role.

revoke all on function public.publish_industry_catalog_version(uuid)
  from public;

revoke all on function public.publish_industry_catalog_version(uuid)
  from anon;

revoke all on function public.publish_industry_catalog_version(uuid)
  from authenticated;

grant execute on function public.publish_industry_catalog_version(uuid)
  to service_role;

-- ────────────────────────────────────────────────────────────
-- 2. Vista active_industry_catalog
-- ────────────────────────────────────────────────────────────
revoke all on public.active_industry_catalog from public;
revoke all on public.active_industry_catalog from anon;
revoke all on public.active_industry_catalog from authenticated;
revoke all on public.active_industry_catalog from service_role;
grant select on public.active_industry_catalog to authenticated;
grant select on public.active_industry_catalog to service_role;

-- ────────────────────────────────────────────────────────────
-- 3. Vista active_subindustry_aliases
-- ────────────────────────────────────────────────────────────
revoke all on public.active_subindustry_aliases from public;
revoke all on public.active_subindustry_aliases from anon;
revoke all on public.active_subindustry_aliases from authenticated;
revoke all on public.active_subindustry_aliases from service_role;
grant select on public.active_subindustry_aliases to authenticated;
grant select on public.active_subindustry_aliases to service_role;

-- ────────────────────────────────────────────────────────────
-- 4. Vista active_subindustry_search_terms
-- ────────────────────────────────────────────────────────────
revoke all on public.active_subindustry_search_terms from public;
revoke all on public.active_subindustry_search_terms from anon;
revoke all on public.active_subindustry_search_terms from authenticated;
revoke all on public.active_subindustry_search_terms from service_role;
grant select on public.active_subindustry_search_terms to authenticated;
grant select on public.active_subindustry_search_terms to service_role;

-- ────────────────────────────────────────────────────────────
-- 5. Vista active_subindustry_rules
-- ────────────────────────────────────────────────────────────
revoke all on public.active_subindustry_rules from public;
revoke all on public.active_subindustry_rules from anon;
revoke all on public.active_subindustry_rules from authenticated;
revoke all on public.active_subindustry_rules from service_role;
grant select on public.active_subindustry_rules to authenticated;
grant select on public.active_subindustry_rules to service_role;

-- ────────────────────────────────────────────────────────────
-- 6. Habilitar security_invoker en las cuatro vistas
-- ────────────────────────────────────────────────────────────
-- Disponible en PostgreSQL >= 15. El proyecto usa PG 17.
-- Garantiza que consultas sobre las vistas respeten los permisos
-- y políticas RLS del rol invocador en las tablas base.

alter view public.active_industry_catalog
  set (security_invoker = true);

alter view public.active_subindustry_aliases
  set (security_invoker = true);

alter view public.active_subindustry_search_terms
  set (security_invoker = true);

alter view public.active_subindustry_rules
  set (security_invoker = true);
