/**
 * Agente 3 · Primera llamada — «ninguna cifra sin fuente» (puro).
 *
 * Saca las cifras de un texto y comprueba que cada una aparezca en sus fuentes
 * (los hechos de la ficha y la biblioteca de UBITS). «1.200», «1200» y «1,200»
 * son la misma cifra. Los porcentajes nunca se dan por buenos sin fuente.
 */

export interface NumberToken {
  /** Sólo dígitos («1.200» → «1200»). */
  digits: string;
  isPercent: boolean;
  raw: string;
}

/**
 * Cifras chicas o de agenda que un guion puede decir sin fuente: «3 ciudades» no,
 * pero «2 preguntas», «20 minutos» o «la próxima semana» sí. Nunca un porcentaje.
 */
const GENERIC_NUMBERS = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '15', '20', '30', '45']);

export function extractNumbers(text: string): NumberToken[] {
  const tokens: NumberToken[] = [];
  const re = /\d[\d.,]*\d|\d/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const raw = match[0];
    const after = text.slice(match.index + raw.length, match.index + raw.length + 12);
    tokens.push({
      digits: raw.replace(/[.,]/g, ''),
      isPercent: /^\s?(%|por ciento)/i.test(after),
      raw,
    });
  }
  return tokens;
}

/**
 * Cifras de un texto que NO aparecen en las fuentes (vacío = todo respaldado).
 * `strict`: sin la excepción de cifras de agenda (para los datos de la ficha, que
 * sólo pueden repetir lo que dice su cita).
 */
export function unsupportedNumbers(text: string, sources: readonly string[], options: { strict?: boolean } = {}): string[] {
  const allowed = new Set(sources.flatMap((s) => extractNumbers(s).map((t) => t.digits)));
  const missing: string[] = [];
  for (const token of extractNumbers(text)) {
    if (allowed.has(token.digits)) continue;
    if (!options.strict && !token.isPercent && GENERIC_NUMBERS.has(token.digits)) continue;
    missing.push(token.isPercent ? `${token.raw}%` : token.raw);
  }
  return [...new Set(missing)];
}
