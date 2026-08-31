'use server';

/**
 * Lusha Read-Only Preview — Server Action (Q3F-5BB.3)
 *
 * ── 🔴 AGENT1-LUSHA-CUT-L3 § 16 — ESTA RUTA YA NO PUEDE PAGAR ───────────────
 *
 * Hasta CUT-L3 esta acción llamaba a `searchLushaCompaniesV3` de verdad. Es
 * decir: era una SEGUNDA ruta de Company Prospecting —el mismo endpoint, el mismo
 * crédito por petición— y no pasaba por ninguna de las dos barreras que la ruta
 * de pending-review sí tiene: ni reserva de presupuesto, ni valla durable.
 *
 * El corte exige que toda ruta pagada quede vallada, y ésta no puede estarlo: la
 * valla identifica una petición por `client_request_id` + rama + página, y esta
 * acción no tiene ninguna de las tres. No hay corrida, no hay plan y no hay
 * identidad de ejecución que repetir; inventarle una por CONTENIDO —país, sector,
 * tamaño— habría bloqueado para siempre una previsualización legítima repetida.
 *
 * Así que se elige la otra mitad de la disyuntiva del § 16: se la hace
 * ESTRUCTURALMENTE incapaz de ejecutar una petición pagada. `searchCompanies` es
 * ahora un rechazo local previo al envío — no construye cliente, no resuelve red
 * y no llama a `fetch()`. El resto del núcleo (validación, industria, país,
 * forma del resultado) se conserva intacto, así que la superficie no cambia de
 * tipo ni de contrato.
 *
 * 🔴 No es una regresión escondida: el panel que llamaba a esta acción
 * (`LushaPreviewPanel`) no se monta en ninguna pantalla. Volver a habilitarla
 * exige darle identidad de petición y pasarla por la valla, que es trabajo de
 * CUT-L4 y no de este corte.
 *
 * Thin wrapper sobre el núcleo puro `executeLushaPreview`. Solo:
 *   - Valida usuario autenticado (lectura de sesión).
 *   - Valida y sanea el input con zod.
 *   - Inyecta la credencial y un ejecutor de proveedor DESHABILITADO.
 *
 * NO escribe en Supabase. NO crea prospectos/empresas/batches. NO HubSpot.
 * NO enrichment. NO provider_usage_logs. NO agent_runs. NO gasta créditos.
 */

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { isLushaPreviewEnabled } from '@/lib/feature-flags.server';
import { getLushaApiKey } from '@/server/services/lusha-connection';
import type {
  LushaCompanyProspectingV3Request,
  LushaCompanyProspectingV3Result,
} from '@/server/integrations/lusha-client';
import { classifyLushaProspectingOutcome } from '@/server/integrations/lusha-prospecting-failure-taxonomy';
import { emptyLushaRateLimitSnapshot } from '@/server/integrations/lusha-rate-limit-headers';
import {
  executeLushaPreview,
  type LushaPreviewResult,
} from '@/server/prospect-batches/lusha-preview';
import {
  guardLushaPreviewEnabled,
  buildLushaPreviewDisabledResult,
} from '@/modules/prospect-batches/lusha-preview-flag-guard';

const PreviewInputSchema = z.object({
  countryCode: z.string().trim().min(2).max(4),
  /**
   * AGENT1-LUSHA-MACRO-V2-ROUTING-CUTOVER-1 § 8 — el techo sube de 40 a 64.
   *
   * Esta acción es superficie de COMPATIBILIDAD (el panel que la llama no se monta
   * en ningún sitio) y su `sectorKey` transporta un sector legacy de diez
   * caracteres, así que el 40 no rompía nada HOY. Se corrige igualmente porque era
   * una trampa latente: la clave canónica más larga del catálogo Macro-v2 mide 43,
   * y cualquiera que enrutase una macro por aquí mañana obtendría un rechazo de
   * «parámetros inválidos» imposible de leer como un límite de longitud. 64 es un
   * techo documentado con holgura sobre las claves canónicas.
   */
  sectorKey: z.string().trim().min(1).max(64),
  subIndustryId: z.number().int().positive().nullable().optional(),
  sizeBandKey: z.string().trim().max(20).nullable().optional(),
  // searchText avanzado/opcional — se acota para evitar payloads abusivos.
  searchText: z.string().trim().max(120).nullable().optional(),
});

export type PreviewLushaCompaniesInput = z.infer<typeof PreviewInputSchema>;

export type PreviewLushaCompaniesActionResult =
  | LushaPreviewResult
  | { ok: false; status: 'invalid_input' | 'error'; error: string };

/**
 * Ejecuta un preview read-only de empresas en Lusha. Devuelve resultados
 * normalizados con gate de calidad — sin persistir absolutamente nada.
 */
export async function previewLushaCompaniesAction(
  rawInput: PreviewLushaCompaniesInput,
): Promise<PreviewLushaCompaniesActionResult> {
  // Q3F-5BB.10C2 — server-side ENABLE_LUSHA_PREVIEW gate (P0). When the flag is
  // off, `guardLushaPreviewEnabled` returns the disabled result WITHOUT running
  // the callback below — so no Supabase client is built, no Lusha search runs, and
  // nothing is read/written, even on a direct call that bypasses the UI gate.
  return guardLushaPreviewEnabled(
    isLushaPreviewEnabled(),
    buildLushaPreviewDisabledResult,
    async () => runPreviewLushaCompanies(rawInput),
  );
}

async function runPreviewLushaCompanies(
  rawInput: PreviewLushaCompaniesInput,
): Promise<PreviewLushaCompaniesActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const parsed = PreviewInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      status: 'invalid_input',
      error: 'Parámetros de búsqueda inválidos.',
    };
  }

  try {
    const result = await executeLushaPreview(
      {
        resolveApiKey: () => getLushaApiKey(),
        // 🔴 CUT-L3 § 16 — ejecutor de proveedor DESHABILITADO. No hay `fetch`,
        // no hay cliente HTTP y no hay import del cliente de Prospecting: la
        // incapacidad es estructural, no una comprobación que alguien pueda
        // saltarse. El desenlace es el ÚNICO que puede afirmar cero cargo con
        // fundamento — rechazo local PROBADO antes del envío.
        searchCompanies: rejectUnfencedLushaProspecting,
      },
      parsed.data,
    );

    // Log seguro server-side — sin secretos, sin payload crudo, sin PII.
    console.warn('[lusha-preview]', {
      status: result.status,
      resultsReturned: result.billing.resultsReturned,
      creditsCharged: result.billing.creditsCharged,
      country: result.requestSummary.countryCode,
      sector: result.requestSummary.industryKey,
      hasSearchText: result.requestSummary.hasSearchText,
      warnings: result.warnings,
    });

    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error desconocido';
    return { ok: false, status: 'error', error: msg.slice(0, 200) };
  }
}

/**
 * Rechazo local, previo al envío, de una petición de Prospecting SIN valla.
 *
 * Devuelve la misma forma que el cliente real para que el núcleo de preview no
 * tenga que saber que esta ruta está deshabilitada. `requestDispatched: false` es
 * literalmente cierto: no existe camino desde aquí a la red.
 */
// 🔴 NO se EXPORTA. `lusha-preview-actions.ts` lleva la directiva `'use server'`, y
// Next rechaza en tiempo de EJECUCIÓN cualquier exportación que no sea una función
// async: «A "use server" file can only export async functions», con la página entera
// en 500. Ese incidente ya ocurrió en Producción (P0-R4) y tiene guarda propia
// (`use-server-export-contract-p0-r4`). El código vive aquí porque sólo lo usa este
// módulo; si algún día hace falta fuera, se mueve a un módulo vecino SIN directiva.
const LUSHA_PREVIEW_UNFENCED_PAID_PATH_DISABLED =
  'lusha_prospecting_unfenced_paid_path_disabled' as const;

async function rejectUnfencedLushaProspecting(
  _apiKey: string,
  _request: LushaCompanyProspectingV3Request,
): Promise<LushaCompanyProspectingV3Result> {
  void _apiKey;
  void _request;
  return {
    ok: false,
    status: 'feature_unavailable',
    resultsReturned: 0,
    outcome: classifyLushaProspectingOutcome({
      httpStatus: null,
      requestDispatched: false,
    }),
    rateLimit: emptyLushaRateLimitSnapshot(),
    providerRequestId: null,
    errorMessage: LUSHA_PREVIEW_UNFENCED_PAID_PATH_DISABLED,
  };
}
