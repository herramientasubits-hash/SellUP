// Veredicto ÚNICO de duplicidad que lee quien revisa: una sola frase que dice
// si la empresa ES duplicado, si PUEDE serlo o si SellUp todavía no lo sabe, y
// dónde (SellUp, HubSpot o ambos). Antes la ficha mostraba «Sin verificar» y
// «la verificación de duplicidad bloquea la aprobación» sin decir nada de
// HubSpot, y quien revisaba no sabía si la empresa ya estaba creada allí.
// Puro: sin base de datos, sin clientes.

export type DuplicateVerdictKind = 'duplicate' | 'possible_duplicate' | 'not_duplicate' | 'unverified';

export interface DuplicateVerdictInput {
  /** `prospect_candidates.duplicate_status`. */
  duplicateStatus: string | null | undefined;
  /** Hay una empresa de HubSpot enlazada como coincidencia. */
  matchedInHubspot: boolean;
  /** Hay una empresa o candidata de SellUp enlazada como coincidencia. */
  matchedInSellup: boolean;
  /**
   * Si la revisión consultó HubSpot. `null` = no consta (filas antiguas): se
   * asume que sí, que es lo que hace la revisión estándar.
   */
  hubspotChecked: boolean | null;
}

export interface DuplicateVerdict {
  kind: DuplicateVerdictKind;
  /** Frase corta para el chip / el título. */
  label: string;
  /** Una línea que dice dónde y qué hacer. */
  detail: string;
  /** Por qué no se puede aprobar, cuando la duplicidad lo impide. */
  blockReason: string | null;
}

function whereFound(input: DuplicateVerdictInput): string {
  if (input.matchedInHubspot && input.matchedInSellup) return 'en SellUp y en HubSpot';
  if (input.matchedInHubspot) return 'en HubSpot';
  if (input.matchedInSellup) return 'en SellUp';
  return 'en SellUp o en HubSpot';
}

export function resolveDuplicateVerdict(input: DuplicateVerdictInput): DuplicateVerdict {
  const where = whereFound(input);

  // Enlazada a una empresa de HubSpot sin ser duplicado exacto: ya está creada
  // allí. Se dice así, sin rodeos, y qué hace SellUp al aprobar.
  if (input.matchedInHubspot && input.duplicateStatus !== 'exact_duplicate') {
    return {
      kind: 'possible_duplicate',
      label: 'Ya está en HubSpot',
      detail: 'Esta empresa ya existe en HubSpot. Al aprobar, SellUp la enlaza con esa ficha en vez de crear otra.',
      blockReason: null,
    };
  }

  switch (input.duplicateStatus) {
    case 'exact_duplicate':
      return {
        kind: 'duplicate',
        label: 'Es duplicado',
        detail: `Esta empresa ya existe ${where}.`,
        blockReason: `No se puede aprobar: esta empresa ya existe ${where}.`,
      };
    case 'possible_duplicate':
    case 'related_company':
      return {
        kind: 'possible_duplicate',
        label: 'Posible duplicado',
        detail: `Se parece a una empresa que ya está ${where}. Compárala antes de aprobar.`,
        blockReason: null,
      };
    case 'no_match':
      return input.hubspotChecked === false
        ? {
            kind: 'not_duplicate',
            label: 'No es duplicado en SellUp',
            detail: 'No existe en SellUp. HubSpot no se consultó en esta revisión.',
            blockReason: null,
          }
        : {
            kind: 'not_duplicate',
            label: 'No es duplicado',
            detail: 'No existe en SellUp ni en HubSpot.',
            blockReason: null,
          };
    case 'insufficient_data':
      return {
        kind: 'unverified',
        label: 'SellUp no pudo verificar duplicidad',
        detail: 'Faltan nombre, dominio o NIT para saber si ya existe en SellUp o en HubSpot.',
        blockReason:
          'No se puede aprobar: faltan nombre, dominio o NIT para saber si ya existe en SellUp o en HubSpot.',
      };
    default:
      return {
        kind: 'unverified',
        label: 'SellUp aún no verificó duplicidad',
        detail: 'Todavía no sabemos si esta empresa ya existe en SellUp o en HubSpot.',
        blockReason:
          'No se puede aprobar: SellUp aún no verificó si esta empresa ya existe en SellUp o en HubSpot. Usa «Verificar ahora» en «Verificación de duplicidad».',
      };
  }
}

/** Tono del chip para cada veredicto (variantes del Badge del sistema). */
export const DUPLICATE_VERDICT_BADGE: Record<DuplicateVerdictKind, 'negative' | 'warning' | 'positive' | 'neutral'> = {
  duplicate: 'negative',
  possible_duplicate: 'warning',
  not_duplicate: 'positive',
  unverified: 'neutral',
};
