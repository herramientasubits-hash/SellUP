/**
 * Benchmark — Name Normalizer (Hito 16AB.23.2)
 *
 * Normaliza nombres de empresa eliminando adiciones parentéticas informales.
 * El campo Empresa debe contener únicamente el nombre limpio.
 * Las relaciones históricas o legales deben ir en Notas.
 *
 * Sin llamadas externas. Completamente determinístico.
 */

export type NameNormalizationResult = {
  cleanName: string;
  extractedNotes: string | null;
  wasNormalized: boolean;
};

// ─── Patrones de adiciones informales a eliminar ─────────────────────────────

// Captura: "Nombre Principal (comentario adicional)" → cleanName + nota
// Ejemplos:
//   "Perficient Latin America (ex-PSL)"    → "Perficient Latin America", nota "ex-PSL"
//   "Truora Inc. (Colombia)"               → "Truora", nota "Colombia"
//   "Celes (Barranquilla)"                 → "Celes", nota "Barranquilla"
//   "Empresa S.A. (formerly X)"            → "Empresa S.A.", nota "formerly X"

const PARENTHETICAL_RE = /\s*\([^)]+\)\s*$/;

// Sufijos legales que se deben conservar cuando no hay paréntesis adicionales
// (se limpian solo si van seguidos de paréntesis)
const LEGAL_SUFFIX_STANDALONE_RE = /\s+(S\.A\.S\.?|S\.A\.?|Inc\.?|LLC\.?|Corp\.?|Ltd\.?)\s*$/i;

// ─── Normalización principal ──────────────────────────────────────────────────

/**
 * Normaliza un nombre de empresa:
 * 1. Elimina contenido parentético final → mueve a notas
 * 2. Elimina sufijos legales solos (Inc., S.A.S.) cuando van al final sin contexto
 *    — solo si el nombre tiene más de una palabra
 *
 * Ejemplos:
 *   "Truora Inc. (Colombia)" → { cleanName: "Truora", extractedNotes: "Inc. (Colombia)" }
 *   "Perficient Latin America (ex-PSL)" → { cleanName: "Perficient Latin America", extractedNotes: "ex-PSL" }
 *   "Celes (Barranquilla)" → { cleanName: "Celes", extractedNotes: "Barranquilla" }
 *   "Sofka Technologies S.A.S." → { cleanName: "Sofka Technologies", extractedNotes: "S.A.S." }
 *   "Siigo S.A." → { cleanName: "Siigo", extractedNotes: "S.A." }
 *   "Heinsohn Business Technology S.A. BIC" → no change (BIC is part of name)
 */
export function normalizeCompanyName(rawName: string): NameNormalizationResult {
  const trimmed = rawName.trim();
  let working = trimmed;
  const notes: string[] = [];

  // 1. Extraer contenido parentético final
  const parenMatch = working.match(PARENTHETICAL_RE);
  if (parenMatch) {
    const parenContent = parenMatch[0].trim().replace(/^\(|\)$/g, '').trim();
    notes.push(parenContent);
    working = working.replace(PARENTHETICAL_RE, '').trim();
  }

  // 2. Eliminar sufijos legales solos al final (solo si el nombre resultante
  //    tiene al menos 2 palabras, para no truncar nombres como "Inc.")
  const legalMatch = working.match(LEGAL_SUFFIX_STANDALONE_RE);
  if (legalMatch) {
    const withoutLegal = working.replace(LEGAL_SUFFIX_STANDALONE_RE, '').trim();
    const wordCount = withoutLegal.split(/\s+/).length;
    if (wordCount >= 1 && withoutLegal.length > 3) {
      notes.unshift(legalMatch[0].trim()); // legal suffix goes first in notes
      working = withoutLegal;
    }
  }

  const cleanName = working.trim();
  const extractedNotes = notes.length > 0 ? notes.join('; ') : null;
  const wasNormalized = cleanName !== trimmed;

  return { cleanName, extractedNotes, wasNormalized };
}

/**
 * Fusiona las notas extraídas de la normalización con las notas existentes.
 */
export function mergeNotes(existingNotes: string | null, extractedNotes: string | null): string | null {
  if (!extractedNotes) return existingNotes;
  if (!existingNotes) return extractedNotes;
  // Avoid duplicating content
  if (existingNotes.includes(extractedNotes)) return existingNotes;
  return `${existingNotes}; ${extractedNotes}`;
}
