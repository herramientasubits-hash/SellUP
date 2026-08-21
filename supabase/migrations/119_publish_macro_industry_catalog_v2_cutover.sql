-- ============================================================
-- Migration 119: CUTOVER — publicar el catálogo v2.0.0
-- AGENT1-MACRO-INDUSTRY-CATALOG-DISCOVERY-1 · §§ 3 y 21
-- ============================================================
-- APPLIED IN PRODUCTION: NO
--
-- ⚠️  ESTA MIGRACIÓN CAMBIA EL COMPORTAMIENTO DE PRODUCCIÓN.
--
-- Está separada de la 118 a propósito. La 118 es inerte: crea una
-- vista, una función y una versión en `draft`, y no cambia nada de
-- lo que ve un usuario. ESTA es el cutover:
--
--   1.0.0  published → archived
--   2.0.0  draft     → published
--
-- A partir de su aplicación, TODA búsqueda nueva usa las 12 Macro
-- Industrias y el paso de subindustria desaparece del wizard.
--
-- ── Requiere autorización explícita ─────────────────────────
--
-- No aplicar sin la autorización del dueño del producto. Aplicarla
-- por costumbre, junto con el resto de un despliegue, cambiaría la
-- taxonomía de todas las búsquedas sin que nadie lo decidiera.
--
-- ── Qué NO destruye ─────────────────────────────────────────
--
-- Nada. `archived` conserva todas las filas de 1.0.0: sus 8
-- industrias, sus 73 subindustrias, sus términos de búsqueda y sus
-- reglas de precisión. Los lotes históricos siguen resolviendo sus
-- etiquetas originales y el catálogo v1 sigue siendo consultable
-- para reproducir cualquier corrida anterior (§ 21).
--
-- ── Reversión ───────────────────────────────────────────────
--
-- NO existe. `protect_catalog_version_transitions` (migración 057)
-- prohíbe `published → draft` y hace inmutable todo lo `archived`.
-- Volver a la taxonomía v1 exige publicar una versión NUEVA con su
-- contenido, no revertir ésta. Tenerlo en cuenta antes de aplicar.
-- ============================================================

SELECT public.publish_macro_industry_catalog_version(
    'b2c4e6a8-0d1f-4a3b-8c5d-7e9f0a1b2c3d'
);


-- ============================================================
-- VERIFICACIÓN posterior
-- ============================================================
-- SELECT version, status, published_at, archived_at
--   FROM public.industry_catalog_versions ORDER BY created_at;
--   → 1.0.0 archived  (archived_at poblado)
--   → 2.0.0 published (published_at poblado)
--
-- SELECT count(*) FROM public.active_macro_industry_catalog;   → 12
-- SELECT count(*) FROM public.active_industry_catalog;         → 0
--   (esperado: v2 no tiene subindustrias y esa vista hace INNER JOIN)
--
-- SELECT count(*) FROM public.subindustries;                   → 73
--   (intactas, bajo la versión archivada)
-- ============================================================
