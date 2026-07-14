/**
 * Tax identity derivation helper.
 * Hito: EC4D5.B — Shared record identity module
 *
 * Assumes the connector already produced a normalized tax id; this helper
 * does not normalize tax format nor validate country-specific tax rules.
 */

import type { RecordIdentityResult } from './record-identity-types';
import { buildRecordIdentityKey, normalizeRecordIdentityPart } from './record-identity-key';

const TAX_NAMESPACE = 'tax';

export function deriveTaxRecordIdentity(normalizedTaxId: unknown): RecordIdentityResult {
  const normalized = normalizeRecordIdentityPart(normalizedTaxId);
  if (normalized === null) {
    return { status: 'unavailable', reason: 'missing_tax_id' };
  }

  return buildRecordIdentityKey(TAX_NAMESPACE, normalized);
}
