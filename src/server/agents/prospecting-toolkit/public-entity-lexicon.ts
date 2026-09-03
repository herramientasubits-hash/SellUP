/**
 * Public-Entity Lexicon — AGENT1-OWNERSHIP-GATE-GOVERNMENT-P0
 *
 * Vocabulario CERRADO y genérico que el motor de correspondencia
 * nombre↔dominio (`institutional-domain-ownership.ts`) necesita para razonar
 * sobre entidades públicas. Vive separado de la lógica a propósito: la lógica
 * es la regla, esto es el diccionario.
 *
 * Lo que este archivo SÍ es:
 *   - sustantivos institucionales genéricos ("ministerio", "alcaldía"…),
 *   - adjetivos institucionales genéricos ("nacional", "distrital"…),
 *   - conectores del español,
 *   - la división político-administrativa de primer nivel de Colombia
 *     (32 departamentos + Bogotá D.C.), que es una lista oficial, cerrada y
 *     estable, y es la ÚNICA forma de saber que "antioquia" en
 *     `segovia-antioquia.gov.co` es el calificativo territorial del municipio
 *     y no una organización distinta.
 *
 * Lo que este archivo NO es, y nunca debe llegar a ser: un catálogo de
 * entidades colombianas. Ninguna entrada nombra una entidad concreta. Si un
 * caso sólo se resuelve añadiendo el nombre de una entidad, el caso NO está
 * resuelto: falta una regla.
 */

/**
 * Sustantivos que ENCABEZAN el nombre oficial de una entidad pública. El
 * dominio oficial casi nunca los transcribe completos: los abrevia
 * ("ministerio" → "min") o los omite ("Alcaldía de Segovia" → "segovia-…").
 */
export const INSTITUTIONAL_HEAD_NOUNS: ReadonlySet<string> = new Set([
  'alcaldia',
  'gobernacion',
  'municipio',
  'departamento',
  'distrito',
  'ministerio',
  'superintendencia',
  'instituto',
  'institucion',
  'agencia',
  'unidad',
  'secretaria',
  'direccion',
  'contraloria',
  'procuraduria',
  'fiscalia',
  'defensoria',
  'registraduria',
  'personeria',
  'concejo',
  'consejo',
  'comision',
  'autoridad',
  'servicio',
  'servicios',
]);

/**
 * Los sustantivos anteriores que además denotan una entidad TERRITORIAL. Sólo
 * para estas tiene sentido la composición «topónimo + departamento» que usan
 * los dominios oficiales de municipios y gobernaciones.
 */
export const TERRITORIAL_HEAD_NOUNS: ReadonlySet<string> = new Set([
  'alcaldia',
  'gobernacion',
  'municipio',
  'departamento',
  'distrito',
  'concejo',
  'personeria',
]);

/**
 * Adjetivos que califican a la entidad sin identificarla. Nunca son la parte
 * distintiva del nombre, así que no pueden sostener por sí solos una
 * correspondencia con el dominio.
 */
export const INSTITUTIONAL_ADJECTIVES: ReadonlySet<string> = new Set([
  'nacional',
  'nacionales',
  'colombiano',
  'colombiana',
  'colombianos',
  'colombianas',
  'distrital',
  'distritales',
  'departamental',
  'departamentales',
  'municipal',
  'municipales',
  'publico',
  'publica',
  'publicos',
  'publicas',
  'estatal',
  'estatales',
  'territorial',
  'territoriales',
  'general',
  'generales',
]);

/** Conectores del español: ruido gramatical, nunca evidencia de identidad. */
export const SPANISH_CONNECTOR_TOKENS: ReadonlySet<string> = new Set([
  'de',
  'del',
  'la',
  'las',
  'el',
  'los',
  'y',
  'e',
  'en',
  'al',
  'a',
  'con',
  'por',
  'para',
]);

/**
 * División político-administrativa de primer nivel de Colombia (DIVIPOLA):
 * 32 departamentos + Bogotá D.C., en palabras normalizadas.
 *
 * Se guarda por PALABRA y no por nombre completo porque los dominios oficiales
 * usan la palabra suelta: `…-nortedesantander.gov.co`, `…-valle.gov.co`,
 * `…-sanandres.gov.co`.
 */
export const COLOMBIAN_DEPARTMENT_WORDS: ReadonlySet<string> = new Set([
  'amazonas',
  'antioquia',
  'arauca',
  'atlantico',
  'bolivar',
  'boyaca',
  'caldas',
  'caqueta',
  'casanare',
  'cauca',
  'cesar',
  'choco',
  'cordoba',
  'cundinamarca',
  'guainia',
  'guaviare',
  'huila',
  'guajira',
  'magdalena',
  'meta',
  'narino',
  'santander',
  'nortedesantander',
  'putumayo',
  'quindio',
  'risaralda',
  'sucre',
  'tolima',
  'valle',
  'valledelcauca',
  'vaupes',
  'vichada',
  'sanandres',
  'providencia',
  'archipielago',
  'bogota',
]);

/**
 * Palabras que un dominio oficial añade para decir «esto es la entidad», sin
 * nombrar a ninguna otra organización. Un token de dominio sobrante que sea uno
 * de éstos no contradice la correspondencia; cualquier otro sí.
 */
export const ADMINISTRATIVE_QUALIFIER_WORDS: ReadonlySet<string> = new Set([
  'gov',
  'gob',
  'gobierno',
  'alcaldia',
  'gobernacion',
  'municipio',
  'departamento',
  'distrito',
  'colombia',
  'oficial',
  'portal',
  'sitio',
  'web',
]);
