/**
 * apollo-keyword-accent-variants.ts — la forma CON tilde de las etiquetas en
 * español que el catálogo guarda sin ella.
 *
 * AGENT1-APOLLO-KEYWORD-ACCENT-VARIANTS-1.
 *
 * El catálogo macro guarda los términos sin tilde (`clinica`, `logistica`) y la
 * normalización (`normalizeApolloTermKey`) las quita. Apollo Support (2026-09-29)
 * confirmó que `q_organization_keyword_tags[]` es un OR, pero NO documenta si
 * compara ignorando tildes, y recomendó enviar las dos formas (`clinica` y
 * `clínica`). Este módulo sólo sabe restaurar la tilde de las palabras que el
 * catálogo usa; no adivina ortografía.
 *
 * Diccionario por PALABRA, no por término: `laboratorio clinico` →
 * `laboratorio clínico`. Una palabra fuera del diccionario se deja igual; si
 * ninguna cambia, no hay variante.
 *
 * Puro: sin env, sin I/O.
 */

/**
 * Palabras del catálogo macro (versión 2.0.0) que en español llevan tilde o eñe.
 * Una prueba recorre el catálogo y exige que cada palabra conocida con forma
 * acentuada esté aquí, para que un término nuevo no quede sin su variante.
 */
export const SPANISH_ACCENT_RESTORATIONS: Readonly<Record<string, string>> = Object.freeze({
  administracion: 'administración',
  agricola: 'agrícola',
  alcaldia: 'alcaldía',
  almacen: 'almacén',
  auditoria: 'auditoría',
  clinica: 'clínica',
  clinico: 'clínico',
  compania: 'compañía',
  concesion: 'concesión',
  construccion: 'construcción',
  consultoria: 'consultoría',
  credito: 'crédito',
  diagnostico: 'diagnóstico',
  edificacion: 'edificación',
  electrica: 'eléctrica',
  energia: 'energía',
  exploracion: 'exploración',
  farmaceutico: 'farmacéutico',
  frio: 'frío',
  ganaderia: 'ganadería',
  generacion: 'generación',
  gestion: 'gestión',
  gobernacion: 'gobernación',
  inversion: 'inversión',
  investigacion: 'investigación',
  logistica: 'logística',
  logistico: 'logístico',
  medicos: 'médicos',
  mensajeria: 'mensajería',
  metalmecanica: 'metalmecánica',
  mineria: 'minería',
  operacion: 'operación',
  petroleo: 'petróleo',
  plantacion: 'plantación',
  plasticos: 'plásticos',
  produccion: 'producción',
  publica: 'pública',
  publico: 'público',
  quimica: 'química',
  refineria: 'refinería',
  tecnologia: 'tecnología',
  transmision: 'transmisión',
});

/** La forma acentuada de `term`, o `null` si ninguna palabra la necesita. */
export function apolloKeywordAccentVariant(term: string): string | null {
  const words = term.split(' ');
  let changed = false;
  const out = words.map((word) => {
    const restored = SPANISH_ACCENT_RESTORATIONS[word];
    if (restored === undefined) return word;
    changed = true;
    return restored;
  });
  return changed ? out.join(' ') : null;
}
