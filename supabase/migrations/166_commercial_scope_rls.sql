-- ============================================================
-- 166 — RLS por alcance comercial en empresas, contactos y búsquedas
-- ============================================================
-- ⚠️ NO APLICADA EN PRODUCCIÓN. Se aplica sólo con autorización explícita de la
-- dueña, después del merge.
--
-- Hasta hoy, cualquier persona activa leía y actualizaba TODAS las filas de
-- `accounts`, `contacts`, `prospect_batches` y `prospect_candidates`
-- (`has_active_access(auth.uid())`). El alcance por rol sólo lo aplicaba la app
-- (`resolveCommercialScope`, `record-scope.server.ts`). Esta migración pone la
-- MISMA regla en la base, para las consultas hechas con la sesión del usuario:
--
--   · admin → todo;
--   · líder / manager → su equipo: él, las personas activas del subárbol de su
--     grupo y sus reportes por manager_id (en cascada), como la app;
--   · vendedor / Growth / cualquier otro rol → sólo lo suyo.
--
-- Una fila está en alcance si:
--   · empresa  → su responsable (owner_id) o quien la creó está en el equipo;
--   · contacto → su empresa está en alcance;
--   · búsqueda → su dueño o quien la creó está en el equipo, o tiene alguna
--                candidata asignada a alguien del equipo («las tuyas o con
--                empresas asignadas», como la pantalla Búsquedas);
--   · candidata → está asignada a alguien del equipo, o su búsqueda es de
--                 alguien del equipo (dueño o creador).
--
-- Qué NO cambia:
--   · INSERT: igual que antes (persona activa). El USING de UPDATE exige
--     alcance: nadie toca por id una fila ajena. OJO: Postgres también exige que
--     la fila NUEVA se pueda leer, así que un UPDATE con la sesión que la saque
--     del alcance (reasignar a alguien de fuera) falla. Por eso la app reasigna
--     con el cliente de servicio DESPUÉS de comprobar el alcance (decisión 12-11:
--     líder, manager y Growth asignan a cualquiera).
--   · DELETE: sigue sin política (sólo el cliente de servicio borra).
--   · El cliente de servicio (service_role, BYPASSRLS) no cambia: duplicados,
--     identidad, banco, crons y lecturas cruzadas legítimas lo usan.
--   · «Ver como…»: la sesión sigue siendo la del admin real; la vista previa la
--     aplica la app.
--   · ENABLE_COMMERCIAL_SCOPE es una variable de entorno: la base no la ve. En
--     Producción está encendida (22-10), así que la regla es la misma.
--
-- Funciones SECURITY DEFINER con search_path fijo: leen `internal_users`
-- (cuya RLS sólo deja ver la fila propia) y cortan la recursión entre las
-- políticas de búsquedas y candidatas. Sólo devuelven ids del alcance de QUIEN
-- LLAMA (auth.uid()); no reciben ids de afuera.
-- ============================================================

BEGIN;

-- ── Quién llama ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.commercial_scope_sees_all()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.internal_users iu
      JOIN public.roles r ON r.id = iu.role_id
     WHERE iu.auth_user_id = auth.uid()
       AND iu.access_status = 'active'
       AND lower(r.key) = 'admin'
  );
$$;

COMMENT ON FUNCTION public.commercial_scope_sees_all() IS
  '166: ¿quien llama es admin activo? (ve todo). Misma regla que classifyRole.';

-- Personas cuyo trabajo ve quien llama. Vacío si no está activo.
CREATE OR REPLACE FUNCTION public.commercial_scope_user_ids()
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_id       uuid;
  v_role     text;
  v_group_id uuid;
  v_ids      uuid[];
BEGIN
  SELECT iu.id, lower(r.key), iu.group_id
    INTO v_id, v_role, v_group_id
    FROM public.internal_users iu
    LEFT JOIN public.roles r ON r.id = iu.role_id
   WHERE iu.auth_user_id = auth.uid()
     AND iu.access_status = 'active'
   LIMIT 1;

  IF v_id IS NULL THEN
    RETURN ARRAY[]::uuid[];
  END IF;

  -- Vendedor, Growth y cualquier rol desconocido: sólo lo suyo (el más estrecho).
  IF v_role IS NULL OR v_role NOT IN ('commercial_manager', 'commercial_lead') THEN
    RETURN ARRAY[v_id];
  END IF;

  -- Líder / manager: él + personas activas del subárbol de su grupo + reportes
  -- (los reportes sin filtrar por estado, igual que `get_subordinate_ids`).
  WITH RECURSIVE subtree AS (
    SELECT g.id FROM public.organization_groups g WHERE g.id = v_group_id
    UNION
    SELECT child.id
      FROM public.organization_groups child
      JOIN subtree s ON child.parent_group_id = s.id
  ),
  reports AS (
    SELECT iu.id
      FROM public.internal_users iu
     WHERE iu.manager_id = v_id
    UNION
    SELECT iu.id
      FROM public.internal_users iu
      JOIN reports rp ON iu.manager_id = rp.id
  )
  SELECT array_agg(DISTINCT x.id)
    INTO v_ids
    FROM (
      SELECT v_id AS id
      UNION ALL
      SELECT iu.id
        FROM public.internal_users iu
       WHERE iu.group_id IN (SELECT id FROM subtree)
         AND iu.access_status = 'active'
      UNION ALL
      SELECT id FROM reports
    ) x;

  RETURN COALESCE(v_ids, ARRAY[v_id]);
END;
$$;

COMMENT ON FUNCTION public.commercial_scope_user_ids() IS
  '166: personas cuyo trabajo ve quien llama (él; líder/manager: + grupo en cascada + reportes). Misma regla que resolveCommercialScope.';

-- Empresas en alcance (para la política de contactos).
CREATE OR REPLACE FUNCTION public.commercial_scope_account_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  WITH me AS (SELECT public.commercial_scope_user_ids() AS ids)
  SELECT a.id
    FROM public.accounts a, me
   WHERE a.owner_id = ANY (me.ids)
      OR a.created_by = ANY (me.ids);
$$;

-- Búsquedas cuyo dueño o creador está en el equipo (todas sus candidatas se ven).
CREATE OR REPLACE FUNCTION public.commercial_scope_batch_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  WITH me AS (SELECT public.commercial_scope_user_ids() AS ids)
  SELECT b.id
    FROM public.prospect_batches b, me
   WHERE b.owner_id = ANY (me.ids)
      OR b.created_by = ANY (me.ids);
$$;

-- Búsquedas con alguna candidata asignada a alguien del equipo (la búsqueda se
-- ve; de sus candidatas, sólo las asignadas).
CREATE OR REPLACE FUNCTION public.commercial_scope_assigned_batch_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  WITH me AS (SELECT public.commercial_scope_user_ids() AS ids)
  SELECT DISTINCT c.batch_id
    FROM public.prospect_candidates c, me
   WHERE c.assigned_to = ANY (me.ids)
     AND c.batch_id IS NOT NULL;
$$;

-- Sólo quien tiene sesión las usa (desde las políticas); nadie anónimo.
REVOKE ALL ON FUNCTION public.commercial_scope_sees_all() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.commercial_scope_user_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.commercial_scope_account_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.commercial_scope_batch_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.commercial_scope_assigned_batch_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commercial_scope_sees_all() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.commercial_scope_user_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.commercial_scope_account_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.commercial_scope_batch_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.commercial_scope_assigned_batch_ids() TO authenticated, service_role;

-- ── Empresas ───────────────────────────────────────────────────────────────
-- `(SELECT …)` hace que cada función corra una vez por consulta, no por fila.

DROP POLICY IF EXISTS active_users_can_read_accounts ON public.accounts;
DROP POLICY IF EXISTS scoped_users_can_read_accounts ON public.accounts;
CREATE POLICY scoped_users_can_read_accounts ON public.accounts
  FOR SELECT TO authenticated
  USING (
    (SELECT public.commercial_scope_sees_all())
    OR owner_id = ANY ((SELECT public.commercial_scope_user_ids())::uuid[])
    OR created_by = ANY ((SELECT public.commercial_scope_user_ids())::uuid[])
  );

DROP POLICY IF EXISTS active_users_can_update_accounts ON public.accounts;
DROP POLICY IF EXISTS scoped_users_can_update_accounts ON public.accounts;
CREATE POLICY scoped_users_can_update_accounts ON public.accounts
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.commercial_scope_sees_all())
    OR owner_id = ANY ((SELECT public.commercial_scope_user_ids())::uuid[])
    OR created_by = ANY ((SELECT public.commercial_scope_user_ids())::uuid[])
  )
  WITH CHECK (has_active_access(auth.uid()));

-- ── Contactos (van con su empresa) ─────────────────────────────────────────

DROP POLICY IF EXISTS active_users_can_read_contacts ON public.contacts;
DROP POLICY IF EXISTS scoped_users_can_read_contacts ON public.contacts;
CREATE POLICY scoped_users_can_read_contacts ON public.contacts
  FOR SELECT TO authenticated
  USING (
    (SELECT public.commercial_scope_sees_all())
    OR account_id IN (SELECT public.commercial_scope_account_ids())
  );

DROP POLICY IF EXISTS active_users_can_update_contacts ON public.contacts;
DROP POLICY IF EXISTS scoped_users_can_update_contacts ON public.contacts;
CREATE POLICY scoped_users_can_update_contacts ON public.contacts
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.commercial_scope_sees_all())
    OR account_id IN (SELECT public.commercial_scope_account_ids())
  )
  WITH CHECK (has_active_access(auth.uid()));

-- ── Búsquedas ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS active_users_can_read_prospect_batches ON public.prospect_batches;
DROP POLICY IF EXISTS scoped_users_can_read_prospect_batches ON public.prospect_batches;
CREATE POLICY scoped_users_can_read_prospect_batches ON public.prospect_batches
  FOR SELECT TO authenticated
  USING (
    (SELECT public.commercial_scope_sees_all())
    OR owner_id = ANY ((SELECT public.commercial_scope_user_ids())::uuid[])
    OR created_by = ANY ((SELECT public.commercial_scope_user_ids())::uuid[])
    OR id IN (SELECT public.commercial_scope_assigned_batch_ids())
  );

DROP POLICY IF EXISTS active_users_can_update_prospect_batches ON public.prospect_batches;
DROP POLICY IF EXISTS scoped_users_can_update_prospect_batches ON public.prospect_batches;
CREATE POLICY scoped_users_can_update_prospect_batches ON public.prospect_batches
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.commercial_scope_sees_all())
    OR owner_id = ANY ((SELECT public.commercial_scope_user_ids())::uuid[])
    OR created_by = ANY ((SELECT public.commercial_scope_user_ids())::uuid[])
  )
  WITH CHECK (has_active_access(auth.uid()));

-- ── Candidatas ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS active_users_can_read_prospect_candidates ON public.prospect_candidates;
DROP POLICY IF EXISTS scoped_users_can_read_prospect_candidates ON public.prospect_candidates;
CREATE POLICY scoped_users_can_read_prospect_candidates ON public.prospect_candidates
  FOR SELECT TO authenticated
  USING (
    (SELECT public.commercial_scope_sees_all())
    OR assigned_to = ANY ((SELECT public.commercial_scope_user_ids())::uuid[])
    OR batch_id IN (SELECT public.commercial_scope_batch_ids())
  );

DROP POLICY IF EXISTS active_users_can_update_prospect_candidates ON public.prospect_candidates;
DROP POLICY IF EXISTS scoped_users_can_update_prospect_candidates ON public.prospect_candidates;
CREATE POLICY scoped_users_can_update_prospect_candidates ON public.prospect_candidates
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.commercial_scope_sees_all())
    OR assigned_to = ANY ((SELECT public.commercial_scope_user_ids())::uuid[])
    OR batch_id IN (SELECT public.commercial_scope_batch_ids())
  )
  WITH CHECK (has_active_access(auth.uid()));

COMMIT;
