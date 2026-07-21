/**
 * Ecuador SCVS record identity deriver.
 * Hito: EC-SCVS-1 — Registry and identity builder
 *
 * SCVS Ecuador rows (bi_compania.csv) are identified physically by
 * `expediente`, the provider-native record id. This is a NATIVE_RECORD_GRAIN
 * source: the same fiscal identity (RUC) may span multiple expedientes, so
 * RUC is never the record identity — it may later be stored as
 * normalized_tax_id, but that is out of scope here.
 *
 * Never derives from name/legal_name (globally forbidden by the shared
 * builder) nor from RUC. If expediente is missing/blank the row is reported
 * as 'unavailable' — it still reaches the writer without being blocked.
 */

import { buildRecordIdentityKey } from '../../record-identity';
import type { RecordIdentityResult } from '../../record-identity';

const EXPEDIENTE_NAMESPACE = 'expediente';

export type EcScvsRecordIdentityInput = {
  expediente?: string | null;
};

/**
 * Deriva record_identity_key para una fila SCVS Ecuador.
 * Formato: `expediente:<trim(expediente)>`. El trim y el rechazo de valores
 * vacíos los aplica el builder compartido (normalizeRecordIdentityPart).
 */
export function deriveEcScvsRecordIdentity(input: EcScvsRecordIdentityInput): RecordIdentityResult {
  return buildRecordIdentityKey(EXPEDIENTE_NAMESPACE, input.expediente);
}
