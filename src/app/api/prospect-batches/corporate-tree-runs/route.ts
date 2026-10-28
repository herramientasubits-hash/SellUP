import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAgent1CorporateTreeSearchEnabled } from '@/lib/feature-flags.server';
import { openRunProgress } from '@/modules/prospect-batches/chat-wizard-execution/run-progress.server';
import type { WizardExecutionActionResult } from '@/modules/prospect-batches/chat-wizard-execution/wizard-execution-types';
import { corporateTreeRowKey } from '@/server/prospect-batches/corporate-tree/corporate-tree-plan';
import { parseCorporateTreeRequest, runCorporateTreeSearch } from '@/server/prospect-batches/corporate-tree/corporate-tree-run';
import { buildLiveCorporateTreeDeps } from '@/server/prospect-batches/corporate-tree/corporate-tree-run.server';

/**
 * Agente 1 · Búsqueda en árbol de una empresa (AGENT1-CORPORATE-TREE-1).
 *
 * GET: ¿está encendida? (el chat y las filas la muestran o dicen «Próximamente»).
 * POST: una corrida (Claude y, con su bandera, una ficha de Apollo; o el árbol guardado
 * del grupo, sin costo). Responde con la misma forma que una corrida del asistente, así la
 * bandeja de búsquedas en paralelo la pinta igual.
 */
export const maxDuration = 300;

/**
 * Desde el inicio: última escritura que se empieza; deja tiempo para sellar el lote.
 * AUDIT-HARDENING-1 — 220 s (antes 240): una escritura con chequeos de HubSpot que
 * empezaba en el segundo 239 podía pasar de los 300 s y dejar el lote sin sellar.
 */
const CORPORATE_TREE_WRITE_DEADLINE_MS = 220_000;

const NO_STORE = { 'Cache-Control': 'no-store' };

const REQUEST_ERROR_MESSAGES: Record<string, string> = {
  invalid_request: 'No pudimos leer la búsqueda. Vuelve a intentarlo.',
  root_name_required: 'Escribe el nombre de la empresa.',
  branches_required: 'Elige al menos una rama del árbol.',
  countries_required: 'Elige al menos un país.',
};

function failure(message: string, code: 'EXECUTION_DISABLED' | 'INVALID_REQUEST' | 'GENERATION_FAILED' = 'GENERATION_FAILED'): WizardExecutionActionResult {
  return { ok: false, code, message, retryable: code === 'GENERATION_FAILED' };
}

export async function GET() {
  return NextResponse.json({ enabled: isAgent1CorporateTreeSearchEnabled() }, { headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const actionStartedAtMs = Date.now();
  if (!isAgent1CorporateTreeSearchEnabled()) {
    return NextResponse.json(failure('La búsqueda en árbol todavía no está activada.', 'EXECUTION_DISABLED'), { headers: NO_STORE });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = parseCorporateTreeRequest(body);
  if (!parsed.ok) {
    return NextResponse.json(failure(REQUEST_ERROR_MESSAGES[parsed.error], 'INVALID_REQUEST'), { headers: NO_STORE });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const { data: internalUser } = await supabase
    .from('internal_users')
    .select('id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .single();
  if (!internalUser) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 403 });
  // El árbol de una empresa es prospección masiva: Growth (y admin) con ENABLE_ROLE_CAPABILITIES.
  // «Árbol de una empresa» es una de las cuatro formas de Rumbo: de cualquier usuario
  // activo (dueña 28-10), sin puerta por rol.

  const progress = await openRunProgress({ clientRequestId: parsed.request.clientRequestId });
  try {
    const result = await runCorporateTreeSearch(
      parsed.request,
      {
        internalUserId: internalUser.id as string,
        keyOf: corporateTreeRowKey,
        writeDeadlineAtMs: actionStartedAtMs + CORPORATE_TREE_WRITE_DEADLINE_MS,
      },
      buildLiveCorporateTreeDeps({
        supabase,
        internalUserId: internalUser.id as string,
        clientRequestId: parsed.request.clientRequestId,
        actionStartedAtMs,
        rootNameForLogs: () => parsed.request.rootName,
        report: progress.report,
      }),
    );
    const response: WizardExecutionActionResult = result.ok
      ? {
          ok: true,
          status: result.alreadyStarted ? 'already_started' : result.inReview > 0 ? 'success_partial' : 'no_new_candidates',
          batchId: result.batchId,
          batchStatus: 'ready_for_review',
          // Como en «por criterios»: las que quedaron para revisar.
          candidateCount: result.inReview,
          redirectPath: result.redirectPath,
          corporateTree: {
            waitingWebsite: result.waitingWebsite,
            groupReferences: result.groupReferences,
            alreadyKnown: result.alreadyKnown,
            possibleKnown: result.possibleKnown,
            reusedSavedTree: result.reusedSavedTree === true,
            groupSignal: result.groupSignal ?? null,
          },
        }
      : {
          ...failure(result.message),
          // El lote se reservó al empezar: aunque falle, se puede abrir («Ver lote»).
          ...(result.batchId
            ? { freeContribution: { batchId: result.batchId, persistedCandidates: 0, redirectPath: `/prospect-batches/${result.batchId}` } }
            : {}),
        };
    return NextResponse.json(response, { headers: NO_STORE });
  } catch (error) {
    console.error('[corporate-tree-runs] Error:', error);
    return NextResponse.json(failure('No fue posible completar la búsqueda en árbol.'), { headers: NO_STORE });
  } finally {
    await progress.finish();
  }
}
