/**
 * AGENT1-IMPORT-PARITY-3 — las reglas de país, plataforma, dominio y tamaño de
 * Apollo/Lusha, aplicadas a una fila IMPORTADA en modo revisión.
 *
 * Mismas autoridades, sin copia:
 *   · `evaluateCountryCompatibility`   — país vs. sitio web (multi-país, #464)
 *   · `evaluateExternalPlatformGate`   — directorios, marketplaces, redes
 *   · `evaluateCompanyOwnership`       — el dominio pertenece al nombre (#465)
 *   · `evaluateIcpSizeGate`            — piso de 200 empleados, inclusivo
 *
 * Diferencia deliberada: en Apollo varias de estas reglas OMITEN la empresa.
 * Aquí sólo MARCAN. La vendedora trajo esa lista a propósito, y las reglas son
 * heurísticas (un holding con dominio de marca falla el gate de dominio y es
 * dueño legítimo, como ya se midió con Lusha en X6.12).
 *
 * Una fila sin sitio web no se evalúa en país, plataforma ni dominio: la
 * ausencia de dato no es evidencia en contra (y ya lleva el aviso «Sin sitio
 * web» del parser).
 *
 * Puro: sin I/O.
 */

import { evaluateCountryCompatibility } from '@/server/agents/prospecting-toolkit/country-compatibility';
import { evaluateExternalPlatformGate } from '@/server/agents/prospecting-toolkit/external-platform-blocklist';
import {
  evaluateCompanyOwnership,
  isBlockedByCompanyOwnership,
} from '@/server/agents/prospecting-toolkit/company-ownership-gate';
import { evaluateIcpSizeGate } from '@/server/agents/prospecting-toolkit/icp-size-gate';
import { resolveOwnershipReviewFlags } from '@/modules/prospect-batches/ownership-review-flag';
import {
  IMPORT_BELOW_ICP_SIZE_FLAG,
  IMPORT_COUNTRY_MISMATCH_FLAG,
  IMPORT_EXTERNAL_PLATFORM_FLAG,
} from '@/modules/prospect-batches/import-review-flags';

export const IMPORT_QUALITY_GATES_METADATA_KEY = 'import_quality_gates';

export type ImportQualityGateInput = {
  name: string;
  website: string | null;
  domain: string | null;
  countryCode: string | null;
  /** Texto libre del archivo: «500», «201-500», «1000+», «Grande»… */
  companySize: string | null;
};

export type ImportQualityGateResult = {
  reviewFlags: string[];
  /** Veredictos sin PII para `metadata.import_quality_gates`. */
  metadata: Record<string, unknown>;
};

const PURE_INTEGER = /^\d[\d.,\s]*$/;

function toSizeInput(raw: string | null): { employeeCount?: number; sizeRange?: string } | null {
  const text = raw?.trim();
  if (!text) return null;
  if (PURE_INTEGER.test(text)) {
    const n = Number(text.replace(/[.,\s]/g, ''));
    return Number.isFinite(n) ? { employeeCount: n } : null;
  }
  return { sizeRange: text };
}

export function evaluateImportQualityGates(input: ImportQualityGateInput): ImportQualityGateResult {
  const flags: string[] = [];
  const metadata: Record<string, unknown> = {};
  const url = input.website ?? (input.domain ? `https://${input.domain}` : null);

  if (url && input.countryCode) {
    const country = evaluateCountryCompatibility(url, input.countryCode);
    metadata.country_compatibility = { compatible: country.compatible, reason: country.reason };
    if (!country.compatible) flags.push(IMPORT_COUNTRY_MISMATCH_FLAG);
  }

  if (url) {
    const platform = evaluateExternalPlatformGate(url, input.name);
    metadata.external_platform = { allowed: platform.allowed, type: platform.platformType ?? null };
    if (!platform.allowed) flags.push(IMPORT_EXTERNAL_PLATFORM_FLAG);
  }

  if (input.domain) {
    const ownership = evaluateCompanyOwnership(input.name, url, input.domain);
    const blocked = isBlockedByCompanyOwnership(ownership);
    metadata.ownership = { admitted: !blocked, confidence: ownership.confidence };
    flags.push(...resolveOwnershipReviewFlags({ evaluated: true, admitted: !blocked }));
  }

  const sizeInput = toSizeInput(input.companySize);
  if (sizeInput) {
    const size = evaluateIcpSizeGate({ ...sizeInput, source: 'external_import' });
    metadata.icp_size = { decision: size.decision, size_status: size.size_status };
    if (size.decision === 'block') flags.push(IMPORT_BELOW_ICP_SIZE_FLAG);
  }

  return { reviewFlags: flags, metadata };
}
