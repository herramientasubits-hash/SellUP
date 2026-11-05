-- platform-cleanup-2026-11-05.sql — limpieza de entrega a líderes (decisión de la dueña, 05-11-2026).
-- Se corre DESPUÉS del depósito al banco (`platform-cleanup-2026-11-05.mts --deposit`).
-- Rol postgres (MCP), una sola transacción. Para ensayar: cambiar el COMMIT final por
-- `RAISE EXCEPTION` dentro del bloque DO (lo hace el ensayo) — todo se deshace.
--
-- NO toca: presupuesto (wizard_*), registro de créditos (provider_usage_logs), banco vivo,
-- provider_seen_entities, catálogos de fuentes, configuración.

DO $cleanup$
DECLARE
  v_actor uuid := (SELECT id FROM public.internal_users WHERE email = 'egarcia@ubits.co');
  v_dry   boolean := :DRY_RUN;
  v_out   jsonb := '{}'::jsonb;
  n       int;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'sin egarcia'; END IF;

  -- Alcance: todos los lotes. El que tiene una reserva de presupuesto se ARCHIVA, no se borra.
  CREATE TEMP TABLE _keep_batches ON COMMIT DROP AS
    SELECT DISTINCT batch_id AS id FROM public.wizard_budget_reservations WHERE batch_id IS NOT NULL;
  CREATE TEMP TABLE _del_batches ON COMMIT DROP AS
    SELECT id FROM public.prospect_batches WHERE id NOT IN (SELECT id FROM _keep_batches);
  CREATE TEMP TABLE _cands ON COMMIT DROP AS SELECT id FROM public.prospect_candidates;

  -- 1. Banco: sorteos vencidos vuelven a estar disponibles; filas finales que apuntan a lotes se borran.
  UPDATE public.agent1_company_bank SET status = 'banked', draw_id = NULL, reserved_until = NULL
   WHERE status = 'reserved' AND reserved_until < now();
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('bank_reserved_to_banked', n);
  DELETE FROM public.agent1_company_bank
   WHERE status IN ('assigned', 'expired', 'invalidated')
     AND (source_batch_id IS NOT NULL OR assigned_batch_id IS NOT NULL OR assigned_candidate_id IS NOT NULL);
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('bank_final_rows_deleted', n);

  -- 2. Reclamos de identidad de todas las empresas encontradas.
  DELETE FROM public.agent1_company_identity_claims
   WHERE candidate_id IN (SELECT id FROM _cands) OR batch_id IN (SELECT id FROM public.prospect_batches);
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('claims_deleted', n);

  -- 3. Prospección masiva (Growth).
  DELETE FROM public.prospect_bulk_search_rounds;
  DELETE FROM public.prospect_bulk_searches;
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('bulk_searches_deleted', n);

  -- 4. Lotes. El guardia del banco revierte el SET NULL de source_batch_id: se apaga sólo aquí.
  ALTER TABLE public.agent1_company_bank DISABLE TRIGGER agent1_company_bank_guard_update_trg;
  UPDATE public.agent1_company_bank SET source_batch_id = NULL
   WHERE source_batch_id IN (SELECT id FROM public.prospect_batches);
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('bank_source_batch_unlinked', n);
  ALTER TABLE public.agent1_company_bank ENABLE TRIGGER agent1_company_bank_guard_update_trg;

  DELETE FROM public.prospect_discarded_dispositions WHERE batch_id IN (SELECT id FROM _keep_batches);
  DELETE FROM public.prospect_candidates WHERE batch_id IN (SELECT id FROM _keep_batches);
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('kept_batch_candidates_deleted', n);
  UPDATE public.prospect_batches SET archived_at = now(), archived_by = v_actor
   WHERE id IN (SELECT id FROM _keep_batches) AND archived_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('batches_archived_with_reservation', n);
  DELETE FROM public.prospect_batches WHERE id IN (SELECT id FROM _del_batches);
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('batches_deleted', n);

  -- 5. Agente 2: se conservan las búsquedas ligadas a una ficha (son el banco de contactos);
  --    las que no tienen ficha se borran.
  DELETE FROM public.contact_enrichment_runs WHERE account_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('enrichment_runs_without_account_deleted', n);
  DELETE FROM public.contact_enrichment_requests r
   WHERE r.account_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.contact_enrichment_runs x WHERE x.request_id = r.id);
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('enrichment_requests_deleted', n);
  DELETE FROM public.contact_enrichment_bulk_runs;

  -- 6. Corridas de agentes que no sostienen nada (las referenciadas por créditos o por el banco de contactos se quedan).
  DELETE FROM public.result_quality_events;
  DELETE FROM public.agent_runs a
   WHERE NOT EXISTS (SELECT 1 FROM public.provider_usage_logs l WHERE l.agent_run_id = a.id)
     AND NOT EXISTS (SELECT 1 FROM public.contact_enrichment_runs r WHERE r.agent_run_id = a.id)
     AND NOT EXISTS (SELECT 1 FROM public.prospect_batches b WHERE b.agent_run_id = a.id);
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('agent_runs_deleted', n);

  -- 7. Empresas: todas archivadas (sus contactos quedan como banco de contactos).
  UPDATE public.accounts
     SET archived_at = now(), archived_by = v_actor, pipeline_status = 'archived', updated_by = v_actor
   WHERE archived_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('accounts_archived', n);
  DELETE FROM public.account_audit;
  DELETE FROM public.contact_audit;
  DELETE FROM public.user_notifications;

  -- 8. Usuarios, preaprobaciones y grupos de prueba.
  CREATE TEMP TABLE _qa_users ON COMMIT DROP AS
    SELECT id, auth_user_id FROM public.internal_users
     WHERE email ILIKE '%.qa@ubits.co' OR email = 'herramientasubits@ubits.co';
  DELETE FROM public.access_audit
   WHERE target_user_id IN (SELECT id FROM _qa_users) OR actor_user_id IN (SELECT id FROM _qa_users);
  DELETE FROM public.user_preapprovals
   WHERE status = 'cancelled' OR created_by IN (SELECT id FROM _qa_users) OR email ILIKE '%.qa@ubits.co';
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('preapprovals_deleted', n);
  UPDATE public.internal_users SET manager_id = NULL WHERE manager_id IN (SELECT id FROM _qa_users);
  UPDATE public.internal_users SET archived_by = NULL WHERE archived_by IN (SELECT id FROM _qa_users);
  DELETE FROM public.internal_users WHERE id IN (SELECT id FROM _qa_users);
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('users_deleted', n);
  DELETE FROM auth.users WHERE id IN (SELECT auth_user_id FROM _qa_users WHERE auth_user_id IS NOT NULL);
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('auth_users_deleted', n);
  UPDATE public.organization_groups SET parent_group_id = NULL
   WHERE parent_group_id IN (SELECT id FROM public.organization_groups WHERE name ILIKE '%(QA)%');
  DELETE FROM public.organization_groups WHERE name ILIKE '%(QA)%';
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('qa_groups_deleted', n);

  -- 9. Recuento.
  v_out := v_out || jsonb_build_object(
    'left_batches_active', (SELECT count(*) FROM public.prospect_batches WHERE archived_at IS NULL),
    'left_candidates', (SELECT count(*) FROM public.prospect_candidates),
    'left_accounts_active', (SELECT count(*) FROM public.accounts WHERE archived_at IS NULL),
    'left_contacts', (SELECT count(*) FROM public.contacts),
    'left_users', (SELECT count(*) FROM public.internal_users),
    'left_groups', (SELECT count(*) FROM public.organization_groups),
    'bank_active', (SELECT count(*) FROM public.agent1_company_bank WHERE status IN ('banked', 'reserved')),
    'usage_logs_kept', (SELECT count(*) FROM public.provider_usage_logs),
    'budget_reservations', (SELECT count(*) FROM public.wizard_budget_reservations)
  );

  IF v_dry THEN
    RAISE EXCEPTION 'DRY_RUN_OK %', v_out;
  END IF;
  RAISE NOTICE 'DONE %', v_out;
END
$cleanup$;
