// Agente 2A — Phone Classification (PHONE-3A)
// Hito PHONE-3A — Conserva el tipo y la fuente de teléfono que Apollo ya
// entrega en la búsqueda inicial (`ApolloPerson.phone_numbers[].type`).
//
// Lógica PURA: sin red, sin Supabase, sin proveedores reales, sin fetch.
// Segura para tests unitarios offline.
//
// Contexto: Apollo devuelve `phone_numbers: { sanitized_number, type }[]`
// en la respuesta de search SIN costo adicional ni phone reveal. Hoy el
// normalizador conserva solo el número escalar y descarta el `type`. Este
// módulo permite conservar el tipo normalizado, la fuente y el `raw_type`
// original SIN cambiar el comportamiento visible ni activar reveal alguno.

// ── Vocabulario estable interno ────────────────────────────────

/**
 * Tipo de teléfono normalizado a un vocabulario interno estable.
 * Independiente de la nomenclatura cruda del proveedor.
 */
export type PhoneType =
  | 'personal_mobile'
  | 'mobile'
  | 'direct_dial'
  | 'work'
  | 'hq'
  | 'other'
  | 'unknown';

/**
 * Fuente/procedencia del dato de teléfono. En PHONE-3A el único emisor real
 * es `apollo_search` (tipo entregado gratis en la búsqueda). El resto del
 * vocabulario queda declarado para hitos futuros (reveal explícito, Lusha,
 * carga manual) sin que este hito los produzca.
 */
export type PhoneSource =
  | 'apollo_search'
  | 'apollo_reveal'
  | 'lusha_reveal'
  | 'provider_payload'
  | 'manual'
  | 'unknown';

/**
 * Resultado de clasificar un teléfono: número tal cual, tipo normalizado,
 * fuente y el `raw_type` original del proveedor (para trazabilidad).
 */
export interface ClassifiedPhone {
  number: string;
  type: PhoneType;
  source: PhoneSource;
  raw_type: string | null;
}

/** Forma mínima de un teléfono de Apollo (subset de `ApolloPerson`). */
export interface ApolloPhoneNumber {
  sanitized_number?: string | null;
  type?: string | null;
}

// ── Prioridad de selección ─────────────────────────────────────
// Índice más bajo = mayor prioridad. Se prefiere el móvil personal, luego el
// móvil, luego el marcado directo, etc. `unknown` queda al final.

const PHONE_TYPE_PRIORITY: readonly PhoneType[] = [
  'personal_mobile',
  'mobile',
  'direct_dial',
  'work',
  'hq',
  'other',
  'unknown',
];

function phoneTypeRank(type: PhoneType): number {
  const idx = PHONE_TYPE_PRIORITY.indexOf(type);
  return idx === -1 ? PHONE_TYPE_PRIORITY.length : idx;
}

// ── Mapeo de tipo crudo Apollo → PhoneType ─────────────────────

const APOLLO_PHONE_TYPE_MAP: Record<string, PhoneType> = {
  // Móvil personal (mayor prioridad)
  personal_mobile: 'personal_mobile',
  mobile_personal: 'personal_mobile',
  personal: 'personal_mobile',
  // Móvil
  mobile: 'mobile',
  cell: 'mobile',
  cellphone: 'mobile',
  cell_phone: 'mobile',
  // Marcado directo
  direct: 'direct_dial',
  direct_dial: 'direct_dial',
  // Trabajo
  work: 'work',
  office: 'work',
  work_direct: 'work',
  // Sede / conmutador principal
  hq: 'hq',
  work_hq: 'hq',
  main: 'hq',
  headquarters: 'hq',
  // Otros
  other: 'other',
  home: 'other',
};

/**
 * Normaliza un tipo de teléfono crudo de Apollo al vocabulario interno.
 * Valores desconocidos, vacíos o ausentes → 'unknown'.
 */
export function mapApolloPhoneTypeToPhoneType(
  raw: string | null | undefined,
): PhoneType {
  if (!raw || typeof raw !== 'string') return 'unknown';
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!key) return 'unknown';
  return APOLLO_PHONE_TYPE_MAP[key] ?? 'unknown';
}

// ── Clasificación de un teléfono individual ────────────────────

function cleanNumber(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function cleanRawType(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Clasifica un teléfono de Apollo entregado en la búsqueda.
 * Devuelve null si el número está vacío/ausente (se ignora).
 * `source` es siempre 'apollo_search' en este hito: el tipo proviene del
 * payload de search, sin reveal ni costo adicional.
 */
export function classifyApolloPhone(
  entry: ApolloPhoneNumber | null | undefined,
): ClassifiedPhone | null {
  const number = cleanNumber(entry?.sanitized_number);
  if (!number) return null;
  return {
    number,
    type: mapApolloPhoneTypeToPhoneType(entry?.type),
    source: 'apollo_search',
    raw_type: cleanRawType(entry?.type),
  };
}

/**
 * Elige el mejor teléfono de una lista de Apollo según la prioridad de tipos.
 * Ignora números vacíos. Devuelve null si no hay ningún número válido.
 *
 * Ante empate de prioridad, conserva el primero encontrado (estable respecto
 * al orden entregado por Apollo).
 */
export function pickBestApolloPhone(
  phoneNumbers: ReadonlyArray<ApolloPhoneNumber> | null | undefined,
): ClassifiedPhone | null {
  if (!Array.isArray(phoneNumbers) || phoneNumbers.length === 0) return null;

  let best: ClassifiedPhone | null = null;
  let bestRank = Number.POSITIVE_INFINITY;

  for (const entry of phoneNumbers) {
    const classified = classifyApolloPhone(entry);
    if (!classified) continue;
    const rank = phoneTypeRank(classified.type);
    if (rank < bestRank) {
      best = classified;
      bestRank = rank;
    }
  }

  return best;
}
