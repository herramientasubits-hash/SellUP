/**
 * Agente 1 · Rescate con Claude — la decisión (puro).
 *
 * Regla de la dueña (30-09): los filtros descartan solos lo que no cumple.
 * Si Claude completa los datos que faltaban y la empresa PASA los mismos
 * filtros (sector del lote y tamaño ≥ umbral ICP), va a «Candidatos por
 * revisar»; si NO pasa, va a «Descartadas» con el motivo y la fuente.
 * Nada se aprueba solo.
 *
 * Asimetría deliberada: para DESCARTAR hace falta una cita comprobada
 * (`quote_verified`). Una fuente sólo listada puede completar un dato —una
 * persona lo revisa igual—, pero nunca hacer desaparecer una empresa.
 */

import type { CompanyClassificationResult } from '../types';

/** Umbral ICP por defecto (el mismo del asistente: > 200 colaboradores). */
export const DEFAULT_ICP_MIN_EMPLOYEES = 200;

export type RescueDiscardReason = 'claude_sector_mismatch' | 'claude_size_below_min';

export type RescueDecision =
  | {
      kind: 'discard';
      reason: RescueDiscardReason;
      /** Frase para la pestaña Descartadas. */
      detail: string;
      sourceUrl: string;
    }
  | {
      kind: 'admit';
      sectorConfirmed: boolean;
      sizeConfirmed: boolean;
    }
  | { kind: 'unchanged'; why: 'nothing_verifiable' | 'sector_unknown' | 'not_classified' };

export type RescueContext = {
  icpMinEmployees: number;
};

function sectorVerdict(result: CompanyClassificationResult): 'pass' | 'fail' | 'unknown' {
  const sector = result.sector;
  if (!sector || sector.matchesCurrentIndustry === null) return 'unknown';
  if (sector.matchesCurrentIndustry) return 'pass';
  return sector.verification === 'quote_verified' ? 'fail' : 'unknown';
}

function sizeVerdict(result: CompanyClassificationResult, minEmployees: number): 'pass' | 'fail' | 'unknown' {
  const range = result.employeeRange;
  if (!range) return 'unknown';
  if (range.min >= minEmployees) return 'pass';
  if (range.max !== null && range.max < minEmployees) {
    return range.verification === 'quote_verified' ? 'fail' : 'unknown';
  }
  return 'unknown';
}

export function decideRescue(result: CompanyClassificationResult, ctx: RescueContext): RescueDecision {
  if (result.outcome !== 'classified' && result.outcome !== 'partially_classified') {
    return { kind: 'unchanged', why: result.outcome === 'nothing_verifiable' ? 'nothing_verifiable' : 'not_classified' };
  }
  const sector = sectorVerdict(result);
  const size = sizeVerdict(result, ctx.icpMinEmployees);

  if (sector === 'fail' && result.sector) {
    return {
      kind: 'discard',
      reason: 'claude_sector_mismatch',
      detail: `Según Claude es ${result.sector.industryName}: «${result.sector.quote.slice(0, 160)}»`,
      sourceUrl: result.sector.sourceUrl,
    };
  }
  if (size === 'fail' && result.employeeRange) {
    return {
      kind: 'discard',
      reason: 'claude_size_below_min',
      detail: `Según Claude tiene menos de ${ctx.icpMinEmployees} empleados: «${result.employeeRange.quote.slice(0, 160)}»`,
      sourceUrl: result.employeeRange.sourceUrl,
    };
  }
  if (sector !== 'pass') return { kind: 'unchanged', why: 'sector_unknown' };
  return { kind: 'admit', sectorConfirmed: true, sizeConfirmed: size === 'pass' };
}
