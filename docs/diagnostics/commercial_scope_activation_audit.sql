-- =============================================================================
-- Commercial Scope — Auditoría de readiness PRE-activación (read-only)
-- =============================================================================
--
-- Propósito
--   Validar si la data real de acceso comercial está lista para activar el flag
--   ENABLE_COMMERCIAL_SCOPE=true. NO activa nada, NO modifica datos, NO crea
--   migraciones. Son SELECTs puros para correr en el Supabase SQL Editor del
--   proyecto productivo (ref lrdruowtadwbdulndlph).
--
-- Contexto de la lógica que se está auditando (src/modules/access/):
--   - classifyRole():    admin → ve todo; commercial_manager/commercial_lead →
--                        'team'; seller_bd y cualquier rol desconocido o NULL →
--                        'self' (fallback más restrictivo).
--   - resolveCommercialScope(): un 'team' ve la UNIÓN de (a) su subárbol de
--                        organization_groups (vía group_id + parent_group_id) y
--                        (b) su subárbol de reportes (manager_id, RPC
--                        get_subordinate_ids), más sí mismo. Si un 'team' NO
--                        tiene grupo NI reportes, cae a self (fallback seguro:
--                        nunca a global).
--   - Solo se consideran usuarios con access_status = 'active'.
--
-- Cómo usar
--   Correr cada bloque (A–G) por separado en el SQL Editor. El bloque G entrega
--   el veredicto agregado (Seguro / Prueba controlada / No activar).
--
-- Seguridad
--   100% read-only. Ningún INSERT/UPDATE/DELETE/DDL. Ejecutar como rol con
--   permisos de lectura sobre internal_users, roles, organization_groups.
-- =============================================================================


-- =============================================================================
-- A. Resumen general de usuarios
-- -----------------------------------------------------------------------------
-- Una sola fila con los conteos globales y los conteos restringidos a activos
-- (que son los que importan para la activación).
-- Nota: auth_user_id es NOT NULL por esquema (migración 002); si 'sin_auth_user_id'
-- > 0 hay algo muy raro. Se incluye igual como verificación de integridad.
-- =============================================================================
SELECT
  count(*)                                                            AS total_usuarios,
  count(*) FILTER (WHERE access_status = 'active')                    AS activos,
  count(*) FILTER (WHERE access_status <> 'active')                   AS no_activos,
  count(*) FILTER (WHERE access_status = 'pending_approval')          AS pendientes,
  count(*) FILTER (WHERE access_status = 'suspended')                 AS suspendidos,
  count(*) FILTER (WHERE access_status = 'rejected')                  AS rechazados,
  count(*) FILTER (WHERE access_status = 'archived')                  AS archivados,
  count(*) FILTER (WHERE auth_user_id IS NULL)                        AS sin_auth_user_id,
  count(*) FILTER (WHERE role_id IS NULL)                             AS sin_role_id,
  count(*) FILTER (WHERE group_id IS NULL)                            AS sin_group_id,
  count(*) FILTER (WHERE manager_id IS NULL)                          AS sin_manager_id,
  -- Restringido a activos (lo relevante para activar el flag):
  count(*) FILTER (WHERE access_status = 'active' AND role_id IS NULL)    AS activos_sin_role,
  count(*) FILTER (WHERE access_status = 'active' AND group_id IS NULL)   AS activos_sin_group,
  count(*) FILTER (WHERE access_status = 'active' AND manager_id IS NULL) AS activos_sin_manager,
  count(*) FILTER (WHERE access_status = 'active' AND auth_user_id IS NULL) AS activos_sin_auth
FROM internal_users;


-- =============================================================================
-- B. Distribución por rol
-- -----------------------------------------------------------------------------
-- Cuántos usuarios hay por rol, cuántos activos, y de esos activos cuántos sin
-- grupo / sin manager. '(sin rol)' agrupa role_id NULL.
-- =============================================================================
SELECT
  COALESCE(r.key, '(sin rol)')                                                       AS role_key,
  count(*)                                                                           AS usuarios,
  count(*) FILTER (WHERE iu.access_status = 'active')                                AS activos,
  count(*) FILTER (WHERE iu.access_status = 'active' AND iu.group_id IS NULL)        AS activos_sin_grupo,
  count(*) FILTER (WHERE iu.access_status = 'active' AND iu.manager_id IS NULL)      AS activos_sin_manager
FROM internal_users iu
LEFT JOIN roles r ON r.id = iu.role_id
GROUP BY r.key
ORDER BY usuarios DESC;


-- =============================================================================
-- C. Usuarios ACTIVOS con configuración insuficiente
-- -----------------------------------------------------------------------------
-- Lista nominal de activos que, al encender el flag, quedarían mal clasificados
-- o perderían visibilidad. La columna 'hallazgos' explica el porqué de cada uno.
--   - role_id NULL               → cae a self.
--   - rol desconocido            → cae a self.
--   - team sin grupo NI reportes → fallback self (un líder/manager dejaría de ver
--                                  a su equipo).
--   - team sin grupo (con reportes) → solo vería sus reportes, no su grupo.
-- =============================================================================
WITH u AS (
  SELECT
    iu.id, iu.email, iu.full_name, iu.access_status,
    iu.role_id, iu.group_id, iu.manager_id, iu.auth_user_id,
    r.key  AS role_key,
    g.name AS group_name,
    CASE
      WHEN r.key = 'admin'                                       THEN 'admin'
      WHEN r.key IN ('commercial_manager','commercial_lead')     THEN 'team'
      WHEN r.key = 'seller_bd'                                   THEN 'self'
      WHEN r.key IS NULL                                         THEN 'sin_rol'
      ELSE                                                            'desconocido'
    END AS role_class,
    (SELECT count(*) FROM internal_users s WHERE s.manager_id = iu.id) AS reportes_directos
  FROM internal_users iu
  LEFT JOIN roles r               ON r.id = iu.role_id
  LEFT JOIN organization_groups g ON g.id = iu.group_id
  WHERE iu.access_status = 'active'
)
SELECT
  id, email, full_name, role_key, group_name, manager_id, access_status,
  role_class, reportes_directos,
  array_remove(ARRAY[
    CASE WHEN role_id IS NULL          THEN 'role_id NULL → cae a self' END,
    CASE WHEN role_class = 'desconocido' THEN 'rol desconocido → cae a self' END,
    CASE WHEN role_class = 'team' AND group_id IS NULL AND reportes_directos = 0
         THEN 'team sin grupo ni reportes → fallback self (pierde visibilidad de equipo)' END,
    CASE WHEN role_class = 'team' AND group_id IS NULL AND reportes_directos > 0
         THEN 'team sin grupo (solo ve reportes, no su grupo)' END,
    CASE WHEN auth_user_id IS NULL     THEN 'auth_user_id NULL' END
  ], NULL) AS hallazgos
FROM u
WHERE role_id IS NULL
   OR role_class = 'desconocido'
   OR (role_class = 'team' AND group_id IS NULL)
   OR auth_user_id IS NULL
ORDER BY role_class, role_key, email;


-- =============================================================================
-- D. Grupos organizacionales
-- =============================================================================

-- D1. Resumen de grupos
SELECT
  count(*)                                            AS total_grupos,
  count(*) FILTER (WHERE parent_group_id IS NULL)     AS grupos_raiz,
  count(*) FILTER (
    WHERE parent_group_id IS NOT NULL
      AND parent_group_id NOT IN (SELECT id FROM organization_groups)
  )                                                   AS grupos_parent_invalido
FROM organization_groups;

-- D2. Grupos con / sin usuarios ACTIVOS
SELECT
  count(*) FILTER (WHERE uc.n = 0) AS grupos_sin_usuarios_activos,
  count(*) FILTER (WHERE uc.n > 0) AS grupos_con_usuarios_activos
FROM organization_groups g
LEFT JOIN LATERAL (
  SELECT count(*) AS n
  FROM internal_users iu
  WHERE iu.group_id = g.id AND iu.access_status = 'active'
) uc ON true;

-- D3. Estructura jerárquica (pre-order) con conteo de usuarios activos por grupo
WITH RECURSIVE tree AS (
  SELECT id, name, parent_group_id, depth, name::text AS path
  FROM organization_groups
  WHERE parent_group_id IS NULL
  UNION ALL
  SELECT g.id, g.name, g.parent_group_id, g.depth, t.path || ' > ' || g.name
  FROM organization_groups g
  JOIN tree t ON g.parent_group_id = t.id
)
SELECT
  repeat('    ', depth) || name AS jerarquia,
  depth,
  (SELECT count(*) FROM internal_users iu
     WHERE iu.group_id = tree.id AND iu.access_status = 'active') AS usuarios_activos
FROM tree
ORDER BY path;


-- =============================================================================
-- E. Managers / reportes (jerarquía manager_id)
-- =============================================================================

-- E1. Usuarios que son manager de alguien + nº de reportes directos
SELECT
  m.id, m.email, m.full_name,
  COALESCE(r.key, '(sin rol)') AS role_key,
  m.access_status,
  count(rep.id) AS reportes_directos
FROM internal_users m
JOIN internal_users rep ON rep.manager_id = m.id
LEFT JOIN roles r ON r.id = m.role_id
GROUP BY m.id, m.email, m.full_name, r.key, m.access_status
ORDER BY reportes_directos DESC;

-- E2. Managers cuyo rol NO otorga 'team' scope (tienen reportes pero verían
--     solo lo propio). Smell de configuración: sus reportes no son agregados por
--     nadie a través de esta rama. Incluye seller_bd, sin rol y roles desconocidos.
SELECT DISTINCT
  m.id, m.email, m.full_name,
  COALESCE(r.key, '(sin rol)') AS role_key,
  m.access_status,
  (SELECT count(*) FROM internal_users s WHERE s.manager_id = m.id) AS reportes_directos
FROM internal_users m
JOIN internal_users rep ON rep.manager_id = m.id
LEFT JOIN roles r ON r.id = m.role_id
WHERE r.key IS NULL
   OR r.key NOT IN ('commercial_manager', 'commercial_lead', 'admin')
ORDER BY reportes_directos DESC;

-- E3. manager_id apuntando a un usuario inexistente
--     (FK garantiza integridad; debería dar 0 filas. Si no, hay corrupción.)
SELECT iu.id, iu.email, iu.manager_id
FROM internal_users iu
WHERE iu.manager_id IS NOT NULL
  AND iu.manager_id NOT IN (SELECT id FROM internal_users);

-- E4. Ciclos en la cadena manager_id (la cadena vuelve al punto de partida).
--     chk_no_self_manager evita ciclos de 1; esto detecta ciclos >= 2.
--     Guard de profundidad = 20 para evitar recursión infinita.
WITH RECURSIVE walk AS (
  SELECT id AS root, id AS current_id, manager_id AS next_id, 0 AS steps
  FROM internal_users
  WHERE manager_id IS NOT NULL
  UNION ALL
  SELECT w.root, iu.id, iu.manager_id, w.steps + 1
  FROM walk w
  JOIN internal_users iu ON iu.id = w.next_id
  WHERE w.steps < 20
)
SELECT DISTINCT root AS usuario_en_ciclo
FROM walk
WHERE next_id = root AND steps > 0;


-- =============================================================================
-- F. Admins
-- =============================================================================

-- F1. Lista de admins y si tienen auth_user_id
SELECT
  iu.id, iu.email, iu.full_name, iu.access_status,
  (iu.auth_user_id IS NOT NULL) AS tiene_auth_user_id
FROM internal_users iu
JOIN roles r ON r.id = iu.role_id
WHERE r.key = 'admin'
ORDER BY iu.access_status, iu.email;

-- F2. Confirmación: ¿existe al menos un admin activo con auth_user_id?
SELECT
  count(*) FILTER (WHERE iu.access_status = 'active')                              AS admins_activos,
  count(*) FILTER (WHERE iu.access_status = 'active' AND iu.auth_user_id IS NOT NULL) AS admins_activos_con_auth
FROM internal_users iu
JOIN roles r ON r.id = iu.role_id
WHERE r.key = 'admin';


-- =============================================================================
-- G. VEREDICTO de activación (read-only, agregado)
-- -----------------------------------------------------------------------------
-- Una sola fila con todas las métricas de riesgo + un veredicto derivado.
-- Umbral usado para "sin rol válido": > 10% de los activos ⇒ No activar.
-- Ajustar el 0.10 si el negocio acepta otro nivel.
-- =============================================================================
WITH active AS (
  SELECT
    iu.id, iu.role_id, iu.group_id, iu.manager_id, iu.auth_user_id,
    r.key AS role_key,
    CASE
      WHEN r.key = 'admin'                                   THEN 'admin'
      WHEN r.key IN ('commercial_manager','commercial_lead') THEN 'team'
      WHEN r.key = 'seller_bd'                               THEN 'self'
      WHEN r.key IS NULL                                     THEN 'sin_rol'
      ELSE                                                        'desconocido'
    END AS role_class,
    (SELECT count(*) FROM internal_users s WHERE s.manager_id = iu.id) AS reportes_directos
  FROM internal_users iu
  LEFT JOIN roles r ON r.id = iu.role_id
  WHERE iu.access_status = 'active'
),
m AS (
  SELECT
    (SELECT count(*) FROM internal_users iu JOIN roles r ON r.id = iu.role_id
       WHERE r.key = 'admin' AND iu.access_status = 'active'
         AND iu.auth_user_id IS NOT NULL)                                  AS admins_activos_con_auth,
    (SELECT count(*) FROM active)                                          AS total_activos,
    (SELECT count(*) FROM active WHERE role_class IN ('admin','team','self')) AS activos_rol_valido,
    (SELECT count(*) FROM active WHERE role_class = 'sin_rol')             AS activos_sin_rol,
    (SELECT count(*) FROM active WHERE role_class = 'desconocido')         AS activos_rol_desconocido,
    (SELECT count(*) FROM active
       WHERE role_class = 'team' AND group_id IS NULL AND reportes_directos = 0)
                                                                           AS team_fallback_self,
    (SELECT count(*) FROM active a
       WHERE a.reportes_directos > 0
         AND a.role_class NOT IN ('team','admin'))                         AS managers_sin_team_scope,
    (SELECT count(*) FROM internal_users iu
       WHERE iu.manager_id IS NOT NULL
         AND iu.manager_id NOT IN (SELECT id FROM internal_users))         AS manager_roto,
    (SELECT count(*) FROM (
        WITH RECURSIVE walk AS (
          SELECT id AS root, manager_id AS next_id, 0 AS steps
          FROM internal_users WHERE manager_id IS NOT NULL
          UNION ALL
          SELECT w.root, iu.manager_id, w.steps + 1
          FROM walk w JOIN internal_users iu ON iu.id = w.next_id
          WHERE w.steps < 20
        )
        SELECT DISTINCT root FROM walk WHERE next_id = root AND steps > 0
     ) c)                                                                  AS ciclos
)
SELECT
  *,
  round(100.0 * activos_rol_valido / NULLIF(total_activos, 0), 1)          AS pct_rol_valido,
  (activos_sin_rol + activos_rol_desconocido)                             AS activos_caen_self_por_rol,
  CASE
    WHEN admins_activos_con_auth = 0
      THEN 'NO ACTIVAR TODAVÍA — no hay admin activo con auth_user_id'
    WHEN manager_roto > 0 OR ciclos > 0
      THEN 'NO ACTIVAR TODAVÍA — manager_id roto o ciclos en la jerarquía'
    WHEN total_activos > 0
         AND (activos_sin_rol + activos_rol_desconocido)::numeric / total_activos > 0.10
      THEN 'NO ACTIVAR TODAVÍA — demasiados activos sin rol válido (>10% caen a self)'
    WHEN team_fallback_self > 0 OR managers_sin_team_scope > 0
      THEN 'ACTIVAR SOLO PARA PRUEBA CONTROLADA — líderes/managers perderían visibilidad de equipo'
    WHEN (activos_sin_rol + activos_rol_desconocido) > 0
      THEN 'ACTIVAR SOLO PARA PRUEBA CONTROLADA — pocos activos sin rol válido (caen a self)'
    ELSE 'SEGURO ACTIVAR'
  END AS veredicto
FROM m;
