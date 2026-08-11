// Etiquetas de presentación del teléfono: tipo y fuente
// (PHONE-3B · extraídas a un módulo compartido en AGENT2A-PHONE-REVEAL-4O-G)
//
// Vivían dentro de `contact-candidate-detail-sheet.tsx` como constantes privadas.
// 4O-G añade una segunda superficie que muestra teléfonos —el disclosure «Ver más
// números»— y necesita rotularlos exactamente igual. Copiar los dos mapas habría
// creado el defecto clásico: dos tablas equivalentes que divergen en cuanto
// alguien renombra una sola. Así que se MUEVEN aquí sin cambiar un solo valor, y
// las dos superficies importan la misma tabla.
//
// Copy PRUDENTE, conservado tal cual: `personal_mobile` se rotula como «posible
// personal» a propósito, sin prometer certeza sobre la titularidad del número.
//
// Este módulo es de presentación pura: sin estado, sin red, sin servidor.

import type {
  PhoneType,
  PhoneSource,
} from '@/server/agents/contact-enrichment-toolkit/phone-classification';

export const PHONE_TYPE_UNKNOWN_LABEL = 'Tipo desconocido';
export const PHONE_SOURCE_UNKNOWN_LABEL = 'Fuente desconocida';

export const PHONE_TYPE_LABELS: Record<PhoneType, string> = {
  personal_mobile: 'Móvil / posible personal',
  mobile: 'Móvil',
  direct_dial: 'Directo corporativo',
  work: 'Trabajo',
  hq: 'Central / HQ',
  other: 'Otro',
  unknown: PHONE_TYPE_UNKNOWN_LABEL,
};

export const PHONE_SOURCE_LABELS: Record<PhoneSource, string> = {
  apollo_search: 'Apollo búsqueda',
  apollo_reveal: 'Apollo reveal',
  // APOLLO-PHONE-CACHE-1b: el operador tiene que poder distinguir de un vistazo
  // un número reutilizado de uno recién revelado (no se cobraron créditos).
  apollo_cache: 'Apollo reveal reutilizado',
  lusha_reveal: 'Lusha reveal',
  provider_payload: 'Proveedor',
  manual: 'Manual',
  unknown: PHONE_SOURCE_UNKNOWN_LABEL,
};

/**
 * Etiqueta del tipo de teléfono. Cualquier valor ausente, vacío, `unknown` o no
 * reconocido cae a "Tipo desconocido" (estado explícito cuando hay teléfono
 * pero no hay tipo claro).
 */
export function resolvePhoneTypeLabel(type: string | null | undefined): string {
  if (typeof type === 'string' && Object.prototype.hasOwnProperty.call(PHONE_TYPE_LABELS, type)) {
    return PHONE_TYPE_LABELS[type as PhoneType];
  }
  return PHONE_TYPE_UNKNOWN_LABEL;
}

/**
 * Etiqueta de la fuente del teléfono. Devuelve `null` cuando no hay fuente
 * (para omitir el badge). Valores no reconocidos → "Fuente desconocida".
 */
export function resolvePhoneSourceLabel(source: string | null | undefined): string | null {
  if (typeof source !== 'string' || source.trim().length === 0) return null;
  if (Object.prototype.hasOwnProperty.call(PHONE_SOURCE_LABELS, source)) {
    return PHONE_SOURCE_LABELS[source as PhoneSource];
  }
  return PHONE_SOURCE_UNKNOWN_LABEL;
}
