/**
 * Domain→Name Coverage — AGENT1-OWNERSHIP-DOMAIN-TO-NAME-X6.9
 *
 * ── El defecto que cierra ─────────────────────────────────────────────────────
 *
 * Las reglas 1-4 de `company-ownership-gate.ts` preguntan «¿el NOMBRE está
 * dentro del DOMINIO?» comparando cadenas concatenadas. La pregunta de
 * propiedad es la INVERSA: «¿todo lo que DICE el dominio lo dice también el
 * nombre?». Si el dominio no introduce ninguna entidad que el nombre no nombre,
 * el dominio no puede ser de otra organización.
 *
 * La diferencia no es retórica. La auditoría X6.8 sobre el lote `71a6f75b`
 * midió 21 decisiones reales de ownership y 7 falsos positivos demostrables.
 * Seis de los siete fallan por la dirección de la pregunta:
 *
 *   «Caja de la Vivienda Popular»    → cajaviviendapopular.gov.co
 *        nombre concatenado: cajaDELAviviendapopular   ← sobran los conectores
 *        dominio:            caja + vivienda + popular ← los tres son del nombre
 *
 *   «Concejo Municipal de Bello»     → concejodebello.gov.co
 *        el dominio no está segmentado, así que la regla territorial —que
 *        compara TOKENS por igualdad— no puede ver `bello` dentro de
 *        `concejodebello`.
 *
 * Este módulo segmenta la etiqueta del dominio y exige que CADA pieza esté
 * justificada. No busca subcadenas: descompone.
 *
 * ── 🔴 Lo que este módulo NO hace ────────────────────────────────────────────
 *
 * NO acepta por TLD. El TLD ya viene recortado por el llamador y aquí no se
 * mira: `.gov.co` no es evidencia de nada, y la regla es igual de válida —e
 * igual de exigente— bajo `.com`.
 *
 * NO acepta por vocabulario. Una segmentación que sólo consume conectores,
 * sustantivos institucionales, adjetivos o calificativos territoriales se
 * RECHAZA: sin al menos una pieza que sea contenido distintivo del propio
 * nombre, `antioquia.gov.co` valdría para cualquier «Alcaldía de …», y
 * `secretariadeeducacion.gov.co` para cualquier secretaría del país.
 *
 * NO acepta nombres sin contenido distintivo. «Alcaldía» y «Alcaldía Municipal»
 * son sustantivo + adjetivo institucional y nada más: no hay identidad que
 * comparar, así que no se evalúan.
 *
 * NO conoce ninguna entidad colombiana. El vocabulario es el léxico genérico
 * cerrado que ya existía (`public-entity-lexicon.ts`); ninguna entrada nombra
 * una organización. Un caso que sólo se resolviera añadiendo un nombre propio
 * NO está resuelto: falta una regla.
 *
 * Sin IA. Sin llamadas externas. Determinístico. Sin reloj, sin red, sin base.
 */

import {
  ADMINISTRATIVE_QUALIFIER_WORDS,
  COLOMBIAN_DEPARTMENT_WORDS,
  INSTITUTIONAL_ADJECTIVES,
  INSTITUTIONAL_HEAD_NOUNS,
  SPANISH_CONNECTOR_TOKENS,
} from './public-entity-lexicon';

export type DomainNameCoverageResult = {
  matched: boolean;
  /** Explicación legible de la cobertura encontrada. Vacía si no hubo. */
  detail: string;
};

const NO_MATCH: DomainNameCoverageResult = { matched: false, detail: '' };

/** Longitud mínima de un token del nombre para valer como evidencia. */
const MIN_NAME_TOKEN_LENGTH = 3;

/**
 * Longitud mínima del PREFIJO de un token del nombre que el dominio puede usar
 * en lugar del token completo («educacion» → `educa…`).
 *
 * Cinco, no menos, y la diferencia es exactamente el caso «Caracol Televisión»
 * ↔ `caracoltv.com`: con un mínimo de dos, `tv` pasaría por prefijo de
 * «televisión» y el gate aceptaría una marca comercial como si fuera la razón
 * social. Con cinco, `tv` no es prefijo de nada y el caso sigue rechazado.
 */
const MIN_NAME_STEM_LENGTH = 5;

// ─── Normalización ────────────────────────────────────────────────────────────

function stripDiacritics(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Tokens alfanuméricos en minúscula, sin tildes y sin conectores. */
function tokenize(text: string): string[] {
  return stripDiacritics(text.toLowerCase())
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0 && !SPANISH_CONNECTOR_TOKENS.has(token));
}

/**
 * Etiqueta registrable del dominio, ya sin TLD, reducida a alfanuméricos.
 *
 * De `a.b` se queda con `b`: el subdominio no identifica al titular. Los
 * guiones desaparecen porque un dominio oficial escribe la MISMA identidad con
 * y sin ellos (`santarosadecabal-risaralda` ≡ `santarosadecabalrisaralda`), y
 * la segmentación no debe depender de esa elección tipográfica.
 */
function readDomainLabel(domainIdentityKey: string): string {
  const segments = stripDiacritics(domainIdentityKey.toLowerCase()).split('.');
  const label = segments[segments.length - 1] ?? '';
  return label.replace(/[^a-z0-9]/g, '');
}

// ─── Vocabulario: lo que NO identifica a nadie ───────────────────────────────

/**
 * ¿Este token es vocabulario genérico —institucional, territorial o
 * gramatical— en lugar de contenido que identifique a UNA organización?
 *
 * `genericDomainWords` lo aporta el gate, que es donde esa lista ya vive, para
 * que no existan dos copias divergentes de la misma política.
 */
function isGenericVocabulary(token: string, genericDomainWords: ReadonlySet<string>): boolean {
  return (
    SPANISH_CONNECTOR_TOKENS.has(token) ||
    INSTITUTIONAL_HEAD_NOUNS.has(token) ||
    INSTITUTIONAL_ADJECTIVES.has(token) ||
    COLOMBIAN_DEPARTMENT_WORDS.has(token) ||
    ADMINISTRATIVE_QUALIFIER_WORDS.has(token) ||
    genericDomainWords.has(token)
  );
}

type Piece = {
  readonly text: string;
  readonly kind: string;
  /** `true` sólo si la pieza es contenido distintivo del NOMBRE. */
  readonly distinctive: boolean;
  /**
   * Posición del token del nombre que originó la pieza, o `-1` si la pieza es
   * vocabulario genérico.
   *
   * Es lo que sostiene la restricción de ORDEN (ver `segment`). El vocabulario
   * queda exento a propósito: un conector o un calificativo no identifica a
   * nadie, así que su posición no puede ser evidencia ni en contra ni a favor.
   */
  readonly nameIndex: number;
};

/** Ninguna pieza de vocabulario participa en la restricción de orden. */
const VOCABULARY_INDEX = -1;

/**
 * Piezas con las que se puede explicar el dominio, de más larga a más corta.
 *
 * El orden importa: ante `secretariadeambiente`, consumir primero `secretaria`
 * —la pieza más larga que encaja— evita que una pieza corta bloquee una
 * segmentación que sí existe. La recursión con memo cubre el resto.
 */
function buildVocabulary(
  nameTokens: readonly string[],
  genericDomainWords: ReadonlySet<string>,
): Piece[] {
  const pieces: Piece[] = [];

  for (const [nameIndex, token] of nameTokens.entries()) {
    const distinctive = !isGenericVocabulary(token, genericDomainWords);
    if (token.length >= MIN_NAME_TOKEN_LENGTH) {
      pieces.push({ text: token, kind: `token del nombre "${token}"`, distinctive, nameIndex });
    }
    // El dominio puede abreviar un token del nombre por su prefijo.
    for (let length = MIN_NAME_STEM_LENGTH; length < token.length; length++) {
      pieces.push({
        text: token.slice(0, length),
        kind: `prefijo de "${token}"`,
        distinctive,
        nameIndex,
      });
    }
  }

  const addVocabulary = (words: ReadonlySet<string>, kind: string): void => {
    for (const word of words) {
      pieces.push({ text: word, kind, distinctive: false, nameIndex: VOCABULARY_INDEX });
    }
  };
  addVocabulary(SPANISH_CONNECTOR_TOKENS, 'conector');
  addVocabulary(INSTITUTIONAL_HEAD_NOUNS, 'sustantivo institucional');
  addVocabulary(INSTITUTIONAL_ADJECTIVES, 'adjetivo institucional');
  addVocabulary(COLOMBIAN_DEPARTMENT_WORDS, 'departamento');
  addVocabulary(ADMINISTRATIVE_QUALIFIER_WORDS, 'calificativo administrativo');

  return pieces.sort((a, b) => b.text.length - a.text.length);
}

/**
 * Descompone `label` en piezas del vocabulario. `null` si sobra aunque sea un
 * carácter: una explicación parcial no es una explicación.
 *
 * ── 🔴 La restricción de ORDEN ───────────────────────────────────────────────
 *
 * Las piezas que vienen del nombre deben aparecer en el dominio en el MISMO
 * orden que en el nombre. Un dominio que transcribe una razón social conserva
 * su orden; uno que la permuta es otra cadena que casualmente comparte
 * vocabulario, y la diferencia es exactamente la que separa estos dos pares:
 *
 *   «Caja de la Vivienda Popular» ↔ cajaviviendapopular   orden preservado
 *   «Supermercados Caribe»        ↔ caribesupermercados   orden INVERTIDO
 *
 * Sin ella, el corpus congelado de X3 lo demuestra, la regla aceptaba tanto
 * `caribesupermercados.co` como `intercartagena.com` para
 * «cartagena hotel indias intercontinental» — dos rechazos que el gate tenía
 * decididos y que X6.9 no tiene mandato para mover.
 *
 * La restricción se evalúa DENTRO de la búsqueda, no filtrando después: una
 * segmentación válida puede existir aunque la primera que se encuentre viole el
 * orden, y descartarla al final perdería la buena.
 */
function segment(label: string, vocabulary: readonly Piece[]): Piece[] | null {
  const memo = new Map<string, Piece[] | null>();

  const solve = (index: number, lastNameIndex: number): Piece[] | null => {
    if (index === label.length) return [];
    const key = `${index}:${lastNameIndex}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    // Se marca ANTES de recurrir: sin esto, un vocabulario con una pieza vacía
    // o repetida podría reentrar en el mismo estado indefinidamente.
    memo.set(key, null);
    for (const piece of vocabulary) {
      if (!label.startsWith(piece.text, index)) continue;
      // Estrictamente creciente: el dominio no reordena ni repite un token.
      if (piece.nameIndex !== VOCABULARY_INDEX && piece.nameIndex <= lastNameIndex) continue;
      const nextNameIndex =
        piece.nameIndex === VOCABULARY_INDEX ? lastNameIndex : piece.nameIndex;
      const rest = solve(index + piece.text.length, nextNameIndex);
      if (rest === null) continue;
      const solution = [piece, ...rest];
      memo.set(key, solution);
      return solution;
    }
    return null;
  };

  return solve(0, VOCABULARY_INDEX);
}

// ─── Entrada pública ──────────────────────────────────────────────────────────

/**
 * ¿El dominio queda ENTERAMENTE explicado por el nombre de la empresa?
 *
 * Sólo puede AÑADIR un pase: si no encuentra cobertura devuelve
 * `matched: false` y el gate sigue su curso normal hacia el rechazo.
 *
 * Las dos condiciones, ambas necesarias:
 *   1. la etiqueta del dominio se descompone ENTERA en el vocabulario, y en el
 *      mismo ORDEN en que el nombre presenta sus tokens;
 *   2. al menos una pieza de esa descomposición es contenido distintivo del
 *      nombre (si no, el dominio sólo repite vocabulario genérico).
 *
 * 🔴 No hay una tercera condición «el nombre debe tener contenido distintivo».
 * La hubo, y el mutation testing demostró que era código muerto: ningún token
 * genérico puede producir una pieza distintiva, así que un nombre sin contenido
 * —«Alcaldía», «Alcaldía Municipal»— ya muere en la condición 2. Una guarda que
 * ninguna entrada puede ejercitar no protege nada; sólo hace creer que sí.
 *
 * @param companyName       Nombre de la entidad candidata.
 * @param domainIdentityKey Dominio SIN el TLD conocido, tal como el gate lo
 *                          calcula (`cajaviviendapopular`, `concejodebello`).
 * @param genericDomainWords Palabras que el gate ya considera genéricas.
 */
export function evaluateDomainExplainedByCompanyName(
  companyName: string,
  domainIdentityKey: string,
  genericDomainWords: ReadonlySet<string>,
): DomainNameCoverageResult {
  const nameTokens = tokenize(companyName);
  if (nameTokens.length === 0) return NO_MATCH;

  const label = readDomainLabel(domainIdentityKey);
  if (label.length === 0) return NO_MATCH;

  // 1. El dominio se descompone entero y en orden, o no se acepta.
  const pieces = segment(label, buildVocabulary(nameTokens, genericDomainWords));
  if (pieces === null) return NO_MATCH;

  // 2. Al menos una pieza tiene que identificar, no sólo calificar. Es también
  //    lo que descarta un nombre sin contenido propio: sus tokens son todos
  //    vocabulario, así que ninguna pieza puede salir distintiva.
  const distinctivePieces = pieces.filter((piece) => piece.distinctive);
  if (distinctivePieces.length === 0) return NO_MATCH;

  return {
    matched: true,
    detail: `dominio "${label}" se explica entero con el nombre (${pieces
      .map((piece) => `${piece.text}=${piece.kind}`)
      .join(' + ')})`,
  };
}
