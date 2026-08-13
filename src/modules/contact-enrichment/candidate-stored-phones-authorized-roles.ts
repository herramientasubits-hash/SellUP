// Agente 2A — «Ver más números»: QUIÉN puede leer los teléfonos ya guardados
// (AGENT2A-PHONE-REVEAL-4O-G · extraído en P0-R4)
//
// ── POR QUÉ ESTA LISTA VIVE EN SU PROPIO MÓDULO ────────────────
//
// Vivía dentro del fichero de acciones, que lleva `'use server'`. Next envuelve
// TODA exportación de un módulo con esa directiva como Server Action y exige, en
// tiempo de ejecución, que cada una sea una función; un array no lo es. El
// resultado no era un fallo de esta lista: era el módulo entero negándose a
// evaluar, y con él TODAS las acciones de la pantalla de contactos, con 500. Un
// módulo vecino sin directiva es el sitio donde una constante puede existir sin
// convertirse en un endpoint.
//
// El contenido y su razón de ser no cambian: sigue siendo el MISMO `['admin']`
// que gobierna la revisión del candidato y la auditoría del waterfall, y sigue
// declarándose aparte —y no importándose de `phone-reveal-waterfall-core.ts`—
// para que el permiso de LEER no quede encadenado a un módulo cuyo asunto es
// GASTAR: si mañana se ensancha quién puede lanzar un waterfall, eso no debe
// ensanchar por accidente quién puede ver números guardados. Un test estático
// fija que ambas listas coincidan hoy.

/** Roles que pueden ver los teléfonos almacenados de un candidato. */
export const CANDIDATE_STORED_PHONES_AUTHORIZED_ROLE_KEYS: readonly string[] = ['admin'];
