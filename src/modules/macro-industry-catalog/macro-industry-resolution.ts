/**
 * ══ AGENT1-MACRO-RESOLUTION-SINGLE-AUTHORITY-1 ═══════════════════════════════
 *
 * LA autoridad única para resolver un identificador PUBLICADO de macro industria
 * —un `slug` o un nombre visible— a la identidad canónica del catálogo.
 *
 * ── El defecto que cierra ────────────────────────────────────────────────────
 *
 * El catálogo expone DOS puertas de bajo nivel para esa resolución
 * (`getMacroIndustryBySlug` y `resolveMacroIndustryByDisplayName`) y cada punta
 * del wizard las combinaba a su manera. Tres comportamientos distintos convivían
 * en la MISMA corrida:
 *
 *   · metadata y adaptador del pipeline → slug ?? nombre ?? null
 *   · capa gratuita y pierna Lusha      → slug ?? null          (cadena TRUNCADA)
 *   · Apollo                            → SÓLO nombre visible
 *
 * Cuando el slug publicado por la resolución de catálogo no coincidía con ningún
 * slug macro pero el nombre visible SÍ resolvía, Apollo encontraba la macro y la
 * pierna Lusha se saltaba con `macro_industry_unmapped`. Dos puntas de la misma
 * ejecución discrepaban sobre qué se había pedido, y el síntoma aparecía en la
 * pierna que NO tenía la culpa.
 *
 * ── La regla ────────────────────────────────────────────────────────────────
 *
 * UNA cadena de precedencia, aquí y en ningún otro sitio:
 *
 *     1. `slug`         — identidad PUBLICADA y estable. Es lo que las
 *                         migraciones 118/119 sembraron en base de datos a
 *                         partir de `MACRO_INDUSTRIES[].slug`, así que manda.
 *     2. `displayName`  — nombre visible canónico, por igualdad de la forma
 *                         normalizada. Respaldo para una fila cuyo slug se
 *                         hubiera reescrito sin tocar el nombre.
 *     3. `null`         — fail-closed EXPLÍCITO.
 *
 * 🔴 Y nada más. Sin `includes`, sin `startsWith`, sin coincidencia parcial y sin
 * caer a una macro arbitraria: «Retail» es subcadena de otras etiquetas del
 * catálogo y un match difuso resolvería la macro EQUIVOCADA sin que nadie lo
 * note. Un identificador que no está en el catálogo tiene que salir como `null`
 * con motivo estático, porque un `null` es un dato auditable y una macro
 * adivinada es un error silencioso que se paga en créditos.
 *
 * Este módulo NO define taxonomía: no toca `MACRO_INDUSTRIES`, ni las 12 claves,
 * ni slugs, ni nombres visibles, ni familias, ni términos. Sólo compone las dos
 * puertas del catálogo en el único orden que el producto reconoce.
 *
 * Puro: sin I/O, sin red, sin reloj, sin aleatoriedad.
 */

import {
  getMacroIndustryBySlug,
  resolveMacroIndustryByDisplayName,
  type MacroIndustryDefinition,
  type MacroIndustryKey,
} from './macro-industries';

/**
 * Motivo estático del no-resuelto.
 *
 * Reutiliza a propósito el vocabulario que Apollo ya publicaba como
 * `blockReason`, en vez de inventar una etiqueta nueva: el corte unifica la
 * resolución, no crea un segundo diccionario de motivos.
 */
export const MACRO_INDUSTRY_IDENTITY_UNRESOLVED_REASON = 'macro_industry_not_in_catalog';

/**
 * Qué paso de la cadena resolvió. Existe para TRAZABILIDAD: permite distinguir
 * «el slug publicado estaba bien» de «el slug no servía y salvó el nombre
 * visible», que es exactamente la señal que faltaba cuando el defecto ocurría.
 */
export type MacroIndustryIdentitySource = 'slug' | 'display_name';

/** Identidad canónica de una macro industria, resuelta desde el catálogo. */
export type MacroIndustryIdentity = {
  /** Definición completa del catálogo, para quien necesite plan de consulta o términos. */
  definition: MacroIndustryDefinition;
  key: MacroIndustryKey;
  slug: string;
  displayName: string;
  source: MacroIndustryIdentitySource;
};

/**
 * Identificador tal como lo publica la resolución de catálogo.
 *
 * Los dos campos son opcionales porque no toda punta dispone de los dos: Apollo
 * recibe únicamente el nombre canónico de la industria (`input.industry`) y no
 * tiene slug a mano. Pasar sólo uno es legítimo y NO degrada la regla — la
 * cadena se aplica sobre lo que haya.
 */
export type MacroIndustryPublishedIdentifier = {
  slug?: string | null;
  displayName?: string | null;
};

function toIdentity(
  definition: MacroIndustryDefinition,
  source: MacroIndustryIdentitySource,
): MacroIndustryIdentity {
  return {
    definition,
    key: definition.key,
    slug: definition.slug,
    displayName: definition.displayName,
    source,
  };
}

/**
 * Resuelve un identificador publicado a la identidad canónica.
 *
 * `null` cuando el identificador no corresponde a ninguna de las 12 macros. Ese
 * `null` NO es un error del llamador: bajo la taxonomía v1 (8 industrias legacy)
 * es lo normal y significa «esta búsqueda no tiene ruta macro», nunca «bloquea».
 */
export function resolveMacroIndustryIdentity(
  input: MacroIndustryPublishedIdentifier,
): MacroIndustryIdentity | null {
  // Paso 1 — slug publicado. `getMacroIndustryBySlug` ya hace `.trim()` y
  // resuelve contra un índice exacto, nunca por subcadena.
  const bySlug = getMacroIndustryBySlug(input.slug);
  if (bySlug) return toIdentity(bySlug, 'slug');

  // Paso 2 — nombre visible canónico, por igualdad de la forma normalizada
  // (minúsculas, sin acentos, sin espacios de sobra).
  const byDisplayName = resolveMacroIndustryByDisplayName(input.displayName);
  if (byDisplayName) return toIdentity(byDisplayName, 'display_name');

  // Paso 3 — fail-closed. Aquí NO se adivina.
  return null;
}

/**
 * Atajo para el caso mayoritario: sólo la clave canónica.
 *
 * Delega en `resolveMacroIndustryIdentity` para que no puedan existir dos
 * cadenas de precedencia — es la razón entera de este módulo.
 */
export function resolveMacroIndustryKey(
  input: MacroIndustryPublishedIdentifier,
): MacroIndustryKey | null {
  return resolveMacroIndustryIdentity(input)?.key ?? null;
}
