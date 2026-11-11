-- platform-cleanup-2026-11-11.sql — segunda limpieza «en ceros» (dueña 11-11-2026).
-- Se corre DESPUÉS del depósito al banco (`platform-cleanup-2026-11-11.mts --deposit`).
-- Rol postgres (MCP), una transacción. Ensayo: v_dry := true (RAISE al final, todo se deshace).
-- NO toca: presupuesto (wizard_*), registro de créditos (provider_usage_logs), banco vivo,
-- el lote archivado con reserva (4aa882ed…, brcastro CL Retail), usuarios ni grupos.
-- 🔴 Los líderes ya entraron (11-11 13:00Z) y trabajan: el alcance son SÓLO las pruebas
-- de egarcia de hoy, por id (3 lotes, Monex y Banorte, su contacto). Nada de los demás.
DO $cleanup$
DECLARE
  v_actor uuid := (SELECT id FROM public.internal_users WHERE email = 'egarcia@ubits.co');
  v_dry   boolean := :DRY_RUN;
  v_cut   timestamptz := '2026-11-05 21:00:00+00';
  v_out   jsonb := '{}'::jsonb;
  n       int;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'sin egarcia'; END IF;

  CREATE TEMP TABLE _del_batches ON COMMIT DROP AS
    SELECT id FROM public.prospect_batches WHERE id IN (
      '7ca99ed0-f48d-4f83-a5c7-eb85b3eea4bd', 'c268c72f-2a98-4815-905f-8633568b0895', 'f7d85cfb-ce52-48b4-8b55-b8262f153227');
  CREATE TEMP TABLE _test_accounts ON COMMIT DROP AS
    SELECT id FROM public.accounts WHERE id IN (
      '29833f74-8141-411a-bc43-6516cc9ece4f', 'e67b5a7a-e50a-47f9-9ab6-3fdc83f2150b');
  CREATE TEMP TABLE _cands ON COMMIT DROP AS
    SELECT id FROM public.prospect_candidates WHERE batch_id IN (SELECT id FROM _del_batches);

  -- 1. Banco: filas finales que salieron hacia estos lotes se borran (ya se redepositaron).
  DELETE FROM public.agent1_company_bank
   WHERE status IN ('assigned', 'expired', 'invalidated')
     AND (assigned_batch_id IN (SELECT id FROM _del_batches) OR source_batch_id IN (SELECT id FROM _del_batches));
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('bank_final_rows_deleted', n);

  -- 2. Reclamos de identidad.
  DELETE FROM public.agent1_company_identity_claims
   WHERE candidate_id IN (SELECT id FROM _cands) OR batch_id IN (SELECT id FROM _del_batches);
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('claims_deleted', n);

  -- 3. Prospección masiva: 0 filas al 11-11 (nada que borrar).

  -- 4. Lotes. El guardia del banco revierte el SET NULL de source_batch_id: se apaga sólo aquí.
  ALTER TABLE public.agent1_company_bank DISABLE TRIGGER agent1_company_bank_guard_update_trg;
  UPDATE public.agent1_company_bank SET source_batch_id = NULL
   WHERE source_batch_id IN (SELECT id FROM _del_batches);
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('bank_source_batch_unlinked', n);
  ALTER TABLE public.agent1_company_bank ENABLE TRIGGER agent1_company_bank_guard_update_trg;
  DELETE FROM public.prospect_batches WHERE id IN (SELECT id FROM _del_batches);
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('batches_deleted', n);

  -- 5. Rumbo (Agente 3): preparaciones e investigaciones.
  DELETE FROM public.first_call_packs WHERE account_id IN (SELECT id FROM _test_accounts);
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('first_call_packs_deleted', n);
  DELETE FROM public.account_research_briefs WHERE account_id IN (SELECT id FROM _test_accounts);
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('research_briefs_deleted', n);

  -- 6. Agente 2: pedidos/corridas sin ficha posteriores al corte (las ligadas a ficha = banco de contactos).
  -- (las búsquedas de contactos de Monex quedan: son el banco de contactos)

  -- 7. Corridas de agentes posteriores al corte que no sostienen nada.
  DELETE FROM public.agent_runs a
   WHERE a.created_at > v_cut AND a.triggered_by = v_actor
     AND NOT EXISTS (SELECT 1 FROM public.provider_usage_logs l WHERE l.agent_run_id = a.id)
     AND NOT EXISTS (SELECT 1 FROM public.contact_enrichment_runs r WHERE r.agent_run_id = a.id)
     AND NOT EXISTS (SELECT 1 FROM public.prospect_batches b WHERE b.agent_run_id = a.id);
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('agent_runs_deleted', n);

  -- 8. Empresas: archivadas (sus contactos quedan como banco de contactos).
  UPDATE public.accounts
     SET archived_at = now(), archived_by = v_actor, pipeline_status = 'archived', updated_by = v_actor
   WHERE id IN (SELECT id FROM _test_accounts) AND archived_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('accounts_archived', n);
  DELETE FROM public.account_audit WHERE account_id IN (SELECT id FROM _test_accounts);
  DELETE FROM public.contact_audit WHERE contact_id IN (SELECT id FROM public.contacts WHERE account_id IN (SELECT id FROM _test_accounts));
  DELETE FROM public.user_notifications WHERE created_at > v_cut AND recipient_internal_user_id = v_actor;

  v_out := v_out || jsonb_build_object(
    'left_batches_active', (SELECT count(*) FROM public.prospect_batches WHERE archived_at IS NULL),
    'left_candidates', (SELECT count(*) FROM public.prospect_candidates),
    'left_accounts_active', (SELECT count(*) FROM public.accounts WHERE archived_at IS NULL),
    'left_packs', (SELECT count(*) FROM public.first_call_packs),
    'left_briefs', (SELECT count(*) FROM public.account_research_briefs),
    'contacts_kept', (SELECT count(*) FROM public.contacts),
    'bank_active', (SELECT count(*) FROM public.agent1_company_bank WHERE status IN ('banked', 'reserved')),
    'usage_logs_kept', (SELECT count(*) FROM public.provider_usage_logs),
    'budget_reservations', (SELECT count(*) FROM public.wizard_budget_reservations)
  );
  IF v_dry THEN RAISE EXCEPTION 'DRY_RUN_OK %', v_out; END IF;
  RAISE NOTICE 'DONE %', v_out;
END
$cleanup$;
