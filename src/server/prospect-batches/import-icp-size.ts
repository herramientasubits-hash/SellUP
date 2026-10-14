/**
 * AGENT1-IMPORT-SAME-PIPELINE-1 — tamaño ICP de una fila importada, con la MISMA
 * jerarquía y el MISMO umbral que el escritor del Agente 1 (`candidate-writer.ts`):
 * el registro oficial (trabajadores del SII, SUNAT…) manda sobre el texto del archivo.
 *
 * Decisión de la dueña (14-10): la importación funciona como el Agente 1. Por debajo
 * del umbral ⇒ Descartadas (el Agente 1 ni la escribe; aquí se ve con el motivo y se
 * puede enviar a revisión). Tamaño desconocido ⇒ queda en revisión y el rescate con
 * Claude lo averigua después.
 *
 * Puro: sin base de datos ni red.
 */

import {
  extractOfficialRegistryWorkforce,
  resolveEmployeeSizeForIcpGate,
} from '@/server/agents/prospecting-toolkit/employee-size-resolver';
import { evaluateIcpSizeGate, type IcpSizeGateResult } from '@/server/agents/prospecting-toolkit/icp-size-gate';
import type { ImportOfficialSourceOutcome } from './import-official-source-enrichment';

/** El mismo umbral que usa el escritor del Agente 1. */
export const IMPORT_ICP_MIN_EMPLOYEES = 200;

export type ImportIcpSizeVerdict = {
  /** Va a `metadata.icp_size_gate`, la clave que leen el rescate y la ficha. */
  gate: IcpSizeGateResult;
  /** De dónde salió el tamaño (`official_registry_workers`, `candidate_company_size`, …). */
  source: string;
  /** Por debajo del umbral ⇒ la fila entra como `discarded`. */
  discard: boolean;
  /** Nota visible en Descartadas cuando se descarta. */
  discardNote: string | null;
};

export function resolveImportIcpSize(input: {
  companySize: string | null;
  official: Pick<ImportOfficialSourceOutcome, 'metadata' | 'strongIdentityAvailable'> | null;
}): ImportIcpSizeVerdict {
  const officialRegistryWorkforce = input.official
    ? extractOfficialRegistryWorkforce({
        officialSourceIdentity: {
          strongIdentityAvailable: input.official.strongIdentityAvailable,
          officialSourceMetadata: input.official.metadata,
        },
      })
    : null;
  const resolved = resolveEmployeeSizeForIcpGate({
    candidateCompanySize: input.companySize?.trim() || null,
    officialRegistryWorkforce,
    threshold: IMPORT_ICP_MIN_EMPLOYEES,
  });
  const gate = evaluateIcpSizeGate(resolved.icpInput);
  const discard = gate.decision === 'block';
  const origin = resolved.selectedSource === 'official_registry_workers' ? 'según el registro oficial' : 'según el archivo';
  return {
    gate,
    source: resolved.selectedSource,
    discard,
    discardNote: discard
      ? `Descartada automáticamente: menos de ${IMPORT_ICP_MIN_EMPLOYEES} empleados ${origin} (${gate.reason}).`
      : null,
  };
}
