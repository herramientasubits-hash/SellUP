/**
 * Prospecting Toolkit — Orquestador de deduplicación
 *
 * Ejecuta sellup_duplicate_checker y hubspot_duplicate_checker en paralelo,
 * luego consolida el resultado con prioridad definida.
 *
 * Prioridad de status:
 *   existing_in_sellup > existing_in_hubspot > possible_duplicate
 *   > insufficient_data > unchecked > error > new_candidate
 *
 * Si HubSpot falla, el status es "unchecked" — nunca "new_candidate"
 * cuando no se pudo verificar una fuente.
 */

import type { DuplicateCheckInput, DuplicateCheckResult, DuplicateStatus } from './types';
import { buildCompanySearchTerms } from './normalization';
import { checkSellUpDuplicates, resolveSellUpStatus } from './sellup-duplicate-checker';
import { checkHubSpotDuplicates, resolveHubSpotStatus } from './hubspot-duplicate-checker';

// ============================================================
// Validación de datos suficientes
// ============================================================

function hasInsufficientData(input: DuplicateCheckInput): boolean {
  const hasName = !!input.name?.trim() && input.name.trim().length >= 2;
  const hasDomain = !!(input.domain?.trim() || input.website?.trim());
  // País solo no alcanza para deduplicar — se requiere nombre útil o dominio
  return !hasName && !hasDomain;
}

// ============================================================
// Consolidación de resultados
// ============================================================

const STATUS_PRIORITY: Record<DuplicateStatus, number> = {
  existing_in_sellup: 100,
  existing_in_hubspot: 90,
  possible_duplicate: 70,
  insufficient_data: 50,
  unchecked: 40,
  error: 30,
  new_candidate: 10,
};

function consolidateStatus(
  sellupStatus: DuplicateStatus,
  hubspotStatus: DuplicateStatus
): DuplicateStatus {
  return STATUS_PRIORITY[sellupStatus] >= STATUS_PRIORITY[hubspotStatus]
    ? sellupStatus
    : hubspotStatus;
}

function buildSummary(
  status: DuplicateStatus,
  hubspotConnected: boolean,
  hubspotError: string | undefined,
  sellupMatchCount: number,
  hubspotMatchCount: number,
  input: DuplicateCheckInput
): string {
  const name = input.name || '(sin nombre)';

  switch (status) {
    case 'existing_in_sellup':
      return `"${name}" ya existe en SellUp (${sellupMatchCount} coincidencia${sellupMatchCount !== 1 ? 's' : ''}).`;

    case 'existing_in_hubspot':
      return `"${name}" ya existe en HubSpot CRM (${hubspotMatchCount} coincidencia${hubspotMatchCount !== 1 ? 's' : ''}). No existe en SellUp.`;

    case 'possible_duplicate':
      return `"${name}" tiene posibles duplicados (SellUp: ${sellupMatchCount}, HubSpot: ${hubspotMatchCount}). Requiere revisión manual.`;

    case 'insufficient_data':
      return `Datos insuficientes para evaluar "${name}". Se requiere al menos nombre útil, dominio o país.`;

    case 'unchecked':
      if (!hubspotConnected) {
        return `"${name}" no fue encontrada en SellUp, pero HubSpot no está conectado. No se puede confirmar que sea nueva.`;
      }
      if (hubspotError) {
        return `"${name}" no fue encontrada en SellUp, pero la verificación en HubSpot falló: ${hubspotError}. No se puede confirmar que sea nueva.`;
      }
      return `"${name}" no pudo verificarse completamente. Revisión manual recomendada.`;

    case 'error':
      return `Error al verificar "${name}". Ver campo errors para detalles.`;

    case 'new_candidate':
      return `"${name}" parece ser una empresa nueva: no encontrada en SellUp ni en HubSpot.`;

    default:
      return `Estado de deduplicación indeterminado para "${name}".`;
  }
}

// ============================================================
// checkCompanyDuplicate — función principal
// ============================================================

/**
 * Verifica si una empresa candidata es duplicado en SellUp y/o HubSpot.
 *
 * Ejecuta ambos checkers en paralelo y consolida el resultado.
 *
 * @example
 * const result = await checkCompanyDuplicate({
 *   name: "Siigo SAS",
 *   website: "https://www.siigo.com",
 *   countryCode: "CO",
 * });
 * // result.status === "existing_in_hubspot" | "existing_in_sellup" | "new_candidate" | ...
 */
export async function checkCompanyDuplicate(
  input: DuplicateCheckInput
): Promise<DuplicateCheckResult> {
  const errors: string[] = [];

  // Normalizar para enriquecer el input antes de pasar a los checkers
  const terms = buildCompanySearchTerms(input);
  const enrichedInput: DuplicateCheckInput = {
    ...input,
    normalizedName: terms.normalizedName || input.normalizedName,
    domain: terms.domain || input.domain,
    countryCode: terms.countryCode || input.countryCode,
  };

  // ── Caso: datos insuficientes ─────────────────────────────
  if (hasInsufficientData(input)) {
    return {
      status: 'insufficient_data',
      confidence: 0,
      input: enrichedInput,
      matches: [
        {
          source: 'sellup',
          status: 'insufficient_data',
          confidence: 0,
          reason: 'Sin datos suficientes para evaluar',
        },
      ],
      summary: `Datos insuficientes para evaluar "${input.name || '(sin nombre)'}". Se requiere al menos nombre útil, dominio o país.`,
      checkedSources: [],
    };
  }

  // ── Ejecutar ambos checkers en paralelo ───────────────────
  const [sellupMatches, hubspotOutcome] = await Promise.all([
    checkSellUpDuplicates(enrichedInput).catch((err: unknown) => {
      errors.push(`SellUp checker error: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }),
    checkHubSpotDuplicates(enrichedInput).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`HubSpot checker error: ${msg}`);
      const fallback: import('./hubspot-duplicate-checker').HubSpotCheckOutcome = {
        connected: true,
        matches: [],
        error: msg,
      };
      return fallback;
    }),
  ]);

  // ── Resolver status individuales ──────────────────────────
  const { status: sellupStatus } = resolveSellUpStatus(sellupMatches);
  const { status: hubspotStatus } = resolveHubSpotStatus(hubspotOutcome);

  // ── Consolidar ────────────────────────────────────────────
  const finalStatus = consolidateStatus(sellupStatus, hubspotStatus);

  // Confianza: máxima entre todos los matches relevantes
  const allMatches = [
    ...sellupMatches,
    ...('matches' in hubspotOutcome ? hubspotOutcome.matches : []),
  ];
  const relevantConfidences = allMatches
    .filter((m) => m.status === finalStatus || m.status === 'existing_in_sellup' || m.status === 'existing_in_hubspot')
    .map((m) => m.confidence);
  const confidence =
    relevantConfidences.length > 0 ? Math.max(...relevantConfidences) : 0;

  const hubspotConnected = 'connected' in hubspotOutcome ? hubspotOutcome.connected : false;
  const hubspotError =
    'error' in hubspotOutcome && hubspotOutcome.error ? hubspotOutcome.error : undefined;

  const checkedSources: Array<'sellup' | 'hubspot'> = ['sellup'];
  if (hubspotConnected) checkedSources.push('hubspot');

  const hubspotMatchCount =
    'matches' in hubspotOutcome ? hubspotOutcome.matches.length : 0;

  if (hubspotError) errors.push(`HubSpot: ${hubspotError}`);

  const summary = buildSummary(
    finalStatus,
    hubspotConnected,
    hubspotError,
    sellupMatches.filter((m) => m.status === 'existing_in_sellup' || m.status === 'possible_duplicate').length,
    hubspotMatchCount,
    enrichedInput
  );

  return {
    status: finalStatus,
    confidence,
    input: enrichedInput,
    matches: allMatches,
    summary,
    checkedSources,
    ...(errors.length > 0 ? { errors } : {}),
  };
}
