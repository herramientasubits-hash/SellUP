// Agente 2A — Señal gratuita «Apollo tiene teléfono» (APOLLO-DIRECT-PHONE-HINT-1)
//
// People API Search (`mixed_people/api_search`) devuelve por persona el campo
// `has_direct_phone`: "Yes" si Apollo tiene un número directo, o
// "Maybe: please request direct dial via people/bulk_match" si no está seguro.
//
// El soporte humano de Apollo confirmó (2026-10-21) que LEER ese campo NO consume
// créditos: es una pista de presencia, no un reveal. Tampoco garantiza que el
// reveal devuelva un número usable, así que nunca se usa como verdad de cobro ni
// para decidir solo un gasto.
//
// Qué hace este módulo: interpretar el valor crudo, leerlo ya normalizado de
// `enrichment_metadata` y dar el texto que ve el operador. PURO: sin I/O, sin
// llamadas a proveedores, sin créditos. Lo importan el normalizador (servidor) y
// la tabla/ficha del candidato (cliente).

export type ApolloDirectPhoneHint = 'yes' | 'maybe';

/** Clave en `contact_enrichment_candidates.enrichment_metadata`. */
export const APOLLO_DIRECT_PHONE_HINT_METADATA_KEY = 'apollo_direct_phone_hint';

/**
 * Interpreta el `has_direct_phone` crudo de Apollo. Sólo hay dos respuestas que
 * significan algo: "Yes" y "Maybe…". Cualquier otra cosa (ausente, "No", tipos
 * raros) es `null`: no se afirma que la persona NO tenga teléfono, porque Apollo
 * no lo dice.
 */
export function parseApolloDirectPhoneHint(raw: unknown): ApolloDirectPhoneHint | null {
  if (raw === true) return 'yes';
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  if (value === 'yes') return 'yes';
  if (value.startsWith('maybe')) return 'maybe';
  return null;
}

/** Lee la señal ya normalizada de la metadata del candidato. Fail-closed a `null`. */
export function readApolloDirectPhoneHint(
  metadata: Readonly<Record<string, unknown>> | null | undefined,
): ApolloDirectPhoneHint | null {
  const value = metadata?.[APOLLO_DIRECT_PHONE_HINT_METADATA_KEY];
  return value === 'yes' || value === 'maybe' ? value : null;
}

export interface ApolloDirectPhoneHintCopy {
  label: string;
  description: string;
}

const HINT_COPY: Record<ApolloDirectPhoneHint, ApolloDirectPhoneHintCopy> = {
  yes: {
    label: 'Apollo tiene teléfono',
    description:
      'Apollo indica que tiene un teléfono directo de esta persona. Saberlo fue sin costo; revelar el número sí gasta créditos.',
  },
  maybe: {
    label: 'Apollo quizá tiene teléfono',
    description:
      'Apollo no está seguro de tener un teléfono directo de esta persona. Saberlo fue sin costo; revelar el número sí gasta créditos y puede no traer número.',
  },
};

/** Texto para la tabla y la ficha; `null` cuando no hay nada que mostrar. */
export function describeApolloDirectPhoneHint(
  hint: ApolloDirectPhoneHint | null,
): ApolloDirectPhoneHintCopy | null {
  return hint ? HINT_COPY[hint] : null;
}
