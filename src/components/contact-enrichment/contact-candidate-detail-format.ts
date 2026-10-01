/**
 * Etiquetas y formatos de la ficha del candidato (Agente 2A).
 *
 * Helpers PUROS, sin React ni server actions: los comparten el drawer
 * (`contact-candidate-detail-sheet.tsx`) y sus secciones, que antes los
 * declaraban en línea dentro del mismo archivo.
 *
 * El vocabulario del TELÉFONO no vive aquí a propósito: sus constantes (tope de
 * créditos, base legal, copy en vuelo) siguen en el drawer, junto al código que
 * las envía al servidor.
 */

import { formatInAppZone } from '@/lib/format-date';
import type {
  ContactDuplicateStatus,
  ContactRelevanceStatus,
  ContactSource,
} from '@/modules/contact-enrichment/types';

// Motivos de rechazo sugeridos (Hito 17A.4B). "Otro" habilita un comentario
// opcional; el resto se guarda tal cual en review_notes + metadata.review.
export const REJECTION_REASONS = [
  'Cargo no relevante',
  'Datos insuficientes',
  'No pertenece a la empresa',
  'Duplicado',
  'No es decisor / sponsor útil',
  'Otro',
] as const;

// ── Label & style maps (espejo de contact-candidates-data-table-client) ──────

export const SOURCE_LABELS: Record<ContactSource, string> = {
  apollo: 'Apollo',
  lusha: 'Lusha',
  hubspot: 'HubSpot',
  manual: 'Manual',
  mock: 'Mock',
};

/**
 * Etiqueta de `candidate.source` (AGENT2A-PHONE-REVEAL-UI-STATE-1 § 8.1).
 *
 * Antes era sólo «Fuente», y esa ambigüedad hacía leer «Fuente: Lusha» como
 * "Lusha consiguió este teléfono" incluso cuando el reveal lo había ejecutado
 * Apollo. `candidate.source` y `phone_reveal_provider` son ejes INDEPENDIENTES:
 * quién descubrió a la persona no dice nada de quién reveló (o intentó revelar)
 * su teléfono.
 */
export const CANDIDATE_SOURCE_LABEL = 'Fuente del candidato';

/**
 * Etiqueta de `phone_reveal_provider` (§ 8.2). Vive en la sección de Teléfono,
 * separada de la fuente del candidato, y sólo se muestra cuando existe un intento
 * real: sin intento no se infiere desde `candidate.source`, porque inferirlo es
 * precisamente el error que este hito corrige.
 */
export const PHONE_REVEAL_PROVIDER_LABEL = 'Proveedor de revelación';

export const RELEVANCE_LABELS: Record<ContactRelevanceStatus, string> = {
  high_relevance: 'Alta',
  medium_relevance: 'Media',
  low_relevance: 'Baja',
  not_relevant: 'No relevante',
  insufficient_data: 'Datos insuficientes',
};

export const RELEVANCE_VARIANT: Record<
  ContactRelevanceStatus,
  'positive' | 'brand' | 'warning' | 'neutral'
> = {
  high_relevance: 'positive',
  medium_relevance: 'brand',
  low_relevance: 'warning',
  not_relevant: 'neutral',
  insufficient_data: 'neutral',
};

export const DUPLICATE_LABELS: Record<ContactDuplicateStatus, string> = {
  unchecked: 'Sin verificar',
  no_match: 'Sin coincidencias',
  possible_duplicate: 'Posible duplicado',
  exact_duplicate: 'Duplicado exacto',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

export const UNAVAILABLE = 'No disponible';

export function formatDate(iso: string | null): string {
  if (!iso) return UNAVAILABLE;
  return formatInAppZone(
    iso,
    {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    },
    'es-CO',
  );
}

/** Convierte un score 0–1 (o 0–100) en porcentaje legible; null si no hay dato. */
export function toPercent(score: number | undefined | null): string | null {
  if (typeof score !== 'number' || Number.isNaN(score)) return null;
  const normalized = score > 1 ? score : score * 100;
  return `${Math.round(normalized)}%`;
}

export function normalizeLinkedinUrl(url: string): string {
  return url.startsWith('http') ? url : `https://${url}`;
}
