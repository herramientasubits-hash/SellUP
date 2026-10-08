-- ═══════════════════════════════════════════════════════════════════
-- 145 — Asignar prospectos por revisar a otro usuario
-- (BULK-COMPANY-ASSIGNMENT-1, pedido de la dueña el 08-10)
-- ═══════════════════════════════════════════════════════════════════
--
-- POR QUÉ
--
-- Un líder busca empresas y las reparte entre sus vendedores. En «Empresas»
-- ya existe el responsable (accounts.owner_id), pero en «Por revisar» el dueño
-- de un prospecto es el del LOTE entero (prospect_batches.owner_id /
-- created_by): no hay forma de pasarle una sola empresa a otra persona.
--
-- Decisiones de la dueña (08-10):
--   * Cualquier usuario puede asignar.
--   * La empresa asignada pasa a ser del vendedor: es su responsable en
--     «Por revisar» y, al aprobarla, la empresa queda a su nombre (la apruebe
--     quien la apruebe). Si HubSpot ya tiene dueño, sigue mandando HubSpot.
--   * Se avisa al vendedor en la campanita.
--
-- QUÉ HACE
--
--   1. prospect_candidates.assigned_to / assigned_by / assigned_at (NULL = el
--      responsable sigue siendo el del lote, igual que hoy).
--   2. Índice parcial sobre assigned_to para el filtro por persona.
--   3. Ensancha el CHECK de prospect_candidate_audit.action_type con
--      'candidate_assigned' (mismo patrón aditivo DROP + ADD de la 138).
--
-- QUÉ NO HACE
--
--   * NO cambia ninguna fila existente: todas quedan con assigned_to NULL.
--   * NO toca RLS (prospect_candidates ya se lee/actualiza por cualquier usuario
--     activo; el alcance comercial se aplica en el servidor).
--   * NO toca reclamos globales de identidad (140), lotes, presupuesto ni
--     HubSpot.
--
-- Reversible: DROP de las tres columnas + índice y volver al CHECK de la 138
-- (si no quedan filas de auditoría 'candidate_assigned').

ALTER TABLE public.prospect_candidates
    ADD COLUMN IF NOT EXISTS assigned_to UUID NULL
        REFERENCES public.internal_users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS assigned_by UUID NULL
        REFERENCES public.internal_users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.prospect_candidates.assigned_to IS
    'Responsable asignado a mano. NULL = el responsable es el del lote (owner_id, si no created_by).';
COMMENT ON COLUMN public.prospect_candidates.assigned_by IS
    'Quién hizo la última asignación.';
COMMENT ON COLUMN public.prospect_candidates.assigned_at IS
    'Cuándo se hizo la última asignación.';

CREATE INDEX IF NOT EXISTS idx_prospect_candidates_assigned_to
    ON public.prospect_candidates (assigned_to)
    WHERE assigned_to IS NOT NULL;

ALTER TABLE public.prospect_candidate_audit
    DROP CONSTRAINT IF EXISTS prospect_candidate_audit_action_type_check;

ALTER TABLE public.prospect_candidate_audit
    ADD CONSTRAINT prospect_candidate_audit_action_type_check
    CHECK (action_type IN (
        'batch_created', 'batch_updated', 'batch_status_changed',
        'candidate_created', 'candidate_updated',
        'candidate_approved', 'candidate_discarded',
        'candidate_marked_duplicate', 'candidate_converted_to_account',
        'candidate_marked_ready_for_approval',
        'candidate_sent_to_review',
        'candidate_assigned'
    ));
