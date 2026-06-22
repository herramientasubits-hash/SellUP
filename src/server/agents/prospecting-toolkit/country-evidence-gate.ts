/**
 * Country Evidence Gate — Hito v1.4
 *
 * Evalúa si hay evidencia real del país objetivo en los datos del candidato
 * (URL, dominio, snippet, título) o si la única señal de país viene de la
 * query que encontró el candidato.
 *
 * Reglas:
 * - strong: TLD del país OR path con señal de país OR snippet/title mencionan país.
 * - query_only: ninguna evidencia en el candidato, pero la query contiene el país.
 * - weak: ninguna evidencia en ningún lado.
 *
 * Sin llamadas externas. Sin writes. Sin LLM. Determinístico.
 */

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type CountryEvidenceLevel = 'strong' | 'weak' | 'query_only';

export type CountryEvidenceResult = {
  evidenceLevel: CountryEvidenceLevel;
  evidenceSources: string[];
  /** Warning a registrar en metadata del candidato cuando la evidencia es débil. */
  warning: string | null;
};

// ─── Señales Colombia (CO) ────────────────────────────────────────────────────

const CO_URL_SIGNALS = [
  '.com.co',
  '.net.co',
  '.org.co',
  '.gov.co',
  '.edu.co',
  '.mil.co',
  '/colombia',
  '/es-co',
  '/co-es',
  '-colombia',
];

const CO_TEXT_SIGNALS = [
  'colombia',
  'colombiano',
  'colombiana',
  'bogotá',
  'bogota',
  'medellín',
  'medellin',
  'cali ',
  'barranquilla',
  'cartagena',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeForSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// ─── Evaluación CO ────────────────────────────────────────────────────────────

function evaluateColombia(input: {
  website: string | null;
  domain: string | null;
  sourceSnippet: string | null;
  sourceTitle: string | null;
  queryText: string | null;
}): CountryEvidenceResult {
  const sources: string[] = [];

  // 1. URL / dominio
  const urlToCheck = normalizeForSearch(input.website ?? input.domain ?? '');
  for (const signal of CO_URL_SIGNALS) {
    if (urlToCheck.includes(signal)) {
      sources.push(`url:${signal}`);
      break;
    }
  }

  // 2. Snippet + title
  const combinedText = normalizeForSearch(
    `${input.sourceSnippet ?? ''} ${input.sourceTitle ?? ''}`,
  );
  for (const signal of CO_TEXT_SIGNALS) {
    const normalized = normalizeForSearch(signal);
    if (combinedText.includes(normalized)) {
      sources.push(`text:${signal.trim()}`);
      break;
    }
  }

  if (sources.length > 0) {
    return { evidenceLevel: 'strong', evidenceSources: sources, warning: null };
  }

  // 3. ¿El país solo viene de la query?
  const queryLower = normalizeForSearch(input.queryText ?? '');
  if (queryLower.includes('colombia')) {
    return {
      evidenceLevel: 'query_only',
      evidenceSources: ['query_text'],
      warning:
        'País no confirmado por evidencia del sitio — solo presente en la query de búsqueda',
    };
  }

  return {
    evidenceLevel: 'weak',
    evidenceSources: [],
    warning: 'País no confirmado por ninguna evidencia del candidato',
  };
}

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Evalúa el nivel de evidencia de país en los datos del candidato.
 * MVP soporta Colombia (CO). Para otros países retorna 'weak' sin warning.
 */
export function evaluateCountryEvidence(input: {
  website: string | null;
  domain: string | null;
  sourceSnippet: string | null;
  sourceTitle: string | null;
  queryText: string | null;
  targetCountryCode: string | null;
}): CountryEvidenceResult {
  if (input.targetCountryCode === 'CO') {
    return evaluateColombia(input);
  }

  // Otros países: no implementado aún — retorna sin penalizar
  return { evidenceLevel: 'weak', evidenceSources: [], warning: null };
}
