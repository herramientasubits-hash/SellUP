// Agente 2A — `(provider, acquisition_mode)` → `PhoneSource`, UNA sola vez
// (extraído en AGENT2A-PHONE-REVEAL-4O-H4)
//
// ── POR QUÉ ESTE ARCHIVO EXISTE ────────────────────────────────
//
// Este mapa nació dentro del núcleo de la colección del CANDIDATO (4O-G), porque
// entonces había UNA superficie que mostraba teléfonos almacenados: el drawer de
// revisión. 4O-H4 añade la segunda —la colección OFICIAL del contacto, creada por
// la migración 114— y necesita traducir exactamente el mismo par al mismo
// vocabulario.
//
// Copiarlo habría creado el defecto que este subsistema ya conoce por su nombre:
// dos tablas equivalentes que divergen en cuanto alguien toca una sola. Es
// literalmente la razón por la que 4O-G sacó `PHONE_TYPE_LABELS` /
// `PHONE_SOURCE_LABELS` del sheet a `phone-display-labels.ts`. Así que se aplica el
// mismo remedio: se MUEVE aquí sin cambiar un solo valor, y las dos colecciones
// importan la misma tabla. El núcleo del candidato la re-exporta, de modo que su
// API pública no cambia y ningún llamador de 4O-G se entera.
//
// Este módulo es NEUTRAL: no importa nada de ninguna de las dos colecciones, y por
// eso puede servirlas a las dos sin acoplarlas entre sí.
//
// ── POR QUÉ EL MAPA SIRVE A LAS DOS TABLAS ─────────────────────
//
// Los vocabularios de la 114 son un SUBCONJUNTO de los de la 109:
//
//   provider          109: apollo · lusha · apollo_cache · manual · unknown
//                     114: apollo · lusha · apollo_cache · manual · unknown
//   acquisition_mode  109: search · reveal · waterfall · cache · manual
//                     114: search · reveal · waterfall · cache · manual
//
// Son el mismo par ortogonal, y la 114 lo dice explícitamente («109 vocabularies»).
// Un mapa que ya cubre el conjunto grande cubre el pequeño por construcción; lo que
// NO se puede es tener dos mapas que respondan distinto a la misma pregunta sobre
// el mismo hecho —«¿de dónde salió este número?»— según qué pantalla lo enseñe.
//
// LÓGICA PURA. Sin red, sin base, sin entorno, sin reloj.

import type { PhoneSource } from '@/server/agents/contact-enrichment-toolkit/phone-classification';

/**
 * Orden de presentación de las procedencias de UN número. Fijo, para que
 * «Apollo · Lusha» no cambie de orden entre dos renders del mismo dato.
 */
export const STORED_PHONE_SOURCE_DISPLAY_ORDER: readonly PhoneSource[] = [
  'apollo_reveal',
  'lusha_reveal',
  'apollo_cache',
  'apollo_search',
  'provider_payload',
  'manual',
  'unknown',
];

/**
 * Traduce `(provider, acquisition_mode)` de una tabla de procedencias —la del
 * candidato (109) o la oficial (114)— al vocabulario `PhoneSource` que el drawer
 * ya sabe rotular.
 *
 * FAIL-SAFE hacia `unknown`: una combinación que este mapa no reconozca se rotula
 * «Fuente desconocida» y NUNCA se asimila a una conocida. Rotular de más es peor
 * que rotular de menos — «Apollo reveal» sobre algo que no lo era es una
 * afirmación falsa sobre de dónde salió un dato personal.
 */
export function resolveStoredPhoneSourceKey(
  provider: string | null,
  acquisitionMode: string | null,
): PhoneSource {
  const mode = typeof acquisitionMode === 'string' ? acquisitionMode.trim() : '';
  switch (typeof provider === 'string' ? provider.trim() : '') {
    case 'apollo':
      if (mode === 'search') return 'apollo_search';
      if (mode === 'cache') return 'apollo_cache';
      // `reveal`, `waterfall` y `manual` son el MISMO hecho para quien lee la
      // pantalla: Apollo reveló este número. El disparo (automático, en cascada o
      // a mano) es contabilidad de la corrida, no procedencia del dato.
      if (mode === 'reveal' || mode === 'waterfall' || mode === 'manual') {
        return 'apollo_reveal';
      }
      return 'unknown';
    case 'apollo_cache':
      // Reutilización de un reveal ya pagado: distinta de `apollo_reveal` a
      // propósito, y esa distinción ya es doctrina del subsistema.
      return 'apollo_cache';
    case 'lusha':
      if (mode === 'reveal' || mode === 'waterfall' || mode === 'manual') {
        return 'lusha_reveal';
      }
      return 'unknown';
    case 'manual':
      return 'manual';
    default:
      return 'unknown';
  }
}

/**
 * Las procedencias VIVAS de un número, deduplicadas y en orden estable.
 *
 * Es una LISTA porque el mismo número observado por Apollo y por Lusha es UNA
 * fila con DOS procedencias, y aplanarlo a una sola fuente inventaría una
 * exclusividad que la base no afirma.
 */
export function projectStoredPhoneSources(
  rows: readonly { readonly provider: string | null; readonly acquisition_mode: string | null }[],
): readonly PhoneSource[] {
  const keys = new Set<PhoneSource>();
  for (const row of rows) {
    keys.add(resolveStoredPhoneSourceKey(row.provider, row.acquisition_mode));
  }
  return STORED_PHONE_SOURCE_DISPLAY_ORDER.filter((key) => keys.has(key));
}
