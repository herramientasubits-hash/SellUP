'use server';

/**
 * Lusha Read-Only Preview — Server Action (Q3F-5BB.3)
 *
 * Thin wrapper sobre el núcleo puro `executeLushaPreview`. Solo:
 *   - Valida usuario autenticado (lectura de sesión).
 *   - Valida y sanea el input con zod.
 *   - Inyecta las dependencias reales (Vault + cliente HTTP de Lusha).
 *
 * NO escribe en Supabase. NO crea prospectos/empresas/batches. NO HubSpot.
 * NO enrichment. NO provider_usage_logs. NO agent_runs. NO auto-run: se invoca
 * únicamente desde el botón explícito del drawer de preview.
 */

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getLushaApiKey } from '@/server/services/lusha-connection';
import { searchLushaCompaniesV3 } from '@/server/integrations/lusha-client';
import {
  executeLushaPreview,
  LUSHA_PREVIEW_TIMEOUT_MS,
  type LushaPreviewResult,
} from '@/server/prospect-batches/lusha-preview';

const PreviewInputSchema = z.object({
  countryCode: z.string().trim().min(2).max(4),
  sectorKey: z.string().trim().min(1).max(40),
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
        searchCompanies: (apiKey, request) =>
          searchLushaCompaniesV3({ apiKey, timeoutMs: LUSHA_PREVIEW_TIMEOUT_MS, request }),
      },
      parsed.data,
    );

    // Log seguro server-side — sin secretos, sin payload crudo, sin PII.
    console.warn('[lusha-preview]', {
      status: result.status,
      resultsReturned: result.billing.resultsReturned,
      creditsCharged: result.billing.creditsCharged,
      country: result.requestSummary.countryCode,
      sector: result.requestSummary.sectorKey,
      hasSearchText: result.requestSummary.hasSearchText,
      warnings: result.warnings,
    });

    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error desconocido';
    return { ok: false, status: 'error', error: msg.slice(0, 200) };
  }
}
