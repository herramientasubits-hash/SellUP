// Motivo de descarte en palabras (QA dueña 13-11): la tabla decía «Otro motivo» y el
// panel mostraba códigos internos (`sub_industry_branch_parent_only`). Aquí cada código
// que escriben el pipeline, el rescate de Claude y la importación tiene su frase; el
// código nunca llega a la pantalla.

import {
  DISCARD_DISPOSITION_LABELS,
  type DiscardedProspectItem,
} from './types';

/** Frase de cada `reason_code` (dispositions) o `claude_rescue.discard_reason` (candidatas). */
export const DISCARD_REASON_CODE_LABELS: Readonly<Record<string, string>> = {
  known_employee_count_below_min: 'Tiene menos empleados que el mínimo de la búsqueda',
  sub_industry_branch_parent_only: 'El proveedor sólo dio la industria general: no se confirmó el sector pedido',
  sector_subindustry_rejected_final: 'No se pudo confirmar que sea del sector pedido',
  excluding_industry_declared: 'Su industria declarada está fuera de la búsqueda',
  declared_industry_outside_macro: 'Su industria declarada no corresponde a la búsqueda',
  missing_domain_final: 'Sin sitio web: no se pudo verificar la empresa',
  ownership_rejected_final: 'El sitio web no corresponde a la empresa',
  ownership_mismatch: 'El sitio web no corresponde a la empresa',
  hubspot_duplicate_final: 'Ya existe en HubSpot',
  duplicate_in_hubspot: 'Ya existe en HubSpot',
  corporate_tree_possible_hubspot_duplicate: 'Posible duplicado en HubSpot',
  same_active_domain: 'Ya existe en SellUp con la misma web',
  cooldown_final: 'Ya se sugirió hace poco',
  cooldown_or_prior_suggestion: 'Ya se sugirió hace poco',
  enrichment_budget_exhausted_final: 'Se acabó el límite de enriquecimiento antes de completarla',
  unexpected_worker_error_final: 'Falló al procesarla; puedes enviarla a revisión',
  claude_sector_mismatch: 'Claude comprobó que es de otro sector',
  claude_size_below_min: 'Claude comprobó que tiene menos empleados que el mínimo',
  import_duplicate: 'Duplicada en la importación',
  import_intra_file_duplicate: 'Repetida dentro del archivo',
  import_existing_in_hubspot: 'Ya existe en HubSpot',
  import_existing_account: 'Ya existe en SellUp',
  import_active_candidate: 'Ya está en revisión en otra búsqueda',
  import_claimed_by_other_seller: 'Ya la trabaja otro vendedor',
};

/** ¿Es un código interno (`snake_case`) y no una frase? */
function looksLikeCode(text: string): boolean {
  return /^[a-z0-9_:.-]+$/.test(text.trim());
}

type ReasonSource = Pick<DiscardedProspectItem, 'disposition' | 'reasonCode' | 'reasonDetail'>;

/** El motivo en una frase corta: nunca un código, nunca «Otro motivo» si hay algo mejor. */
export function describeDiscardReason(item: ReasonSource): string {
  const byCode = item.reasonCode ? DISCARD_REASON_CODE_LABELS[item.reasonCode] : undefined;
  if (byCode) return byCode;
  const detail = item.reasonDetail?.trim();
  const byDetailCode = detail && looksLikeCode(detail) ? DISCARD_REASON_CODE_LABELS[detail] : undefined;
  if (byDetailCode) return byDetailCode;
  if (item.disposition !== 'other') return DISCARD_DISPOSITION_LABELS[item.disposition] ?? 'Otro motivo';
  if (detail && !looksLikeCode(detail)) return detail;
  return DISCARD_DISPOSITION_LABELS.other;
}

/** El detalle escrito (si lo hay y dice algo más que el motivo); los códigos no se muestran. */
export function discardReasonDetail(item: ReasonSource): string | null {
  const detail = item.reasonDetail?.trim();
  if (!detail || looksLikeCode(detail)) return null;
  return detail === describeDiscardReason(item) ? null : detail;
}
