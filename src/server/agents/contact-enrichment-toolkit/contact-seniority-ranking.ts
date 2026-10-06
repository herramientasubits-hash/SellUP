// Agente 2A — Orden por seniority antes de gastar créditos de enriquecimiento.
// AGENT2A-COVERAGE-DECISION-MAKERS-1
//
// Lusha cobra por cada /v3/contacts/enrich. Antes se enriquecían los primeros N
// candidatos tal como llegaban de Prospecting, sin mirar el cargo. Este módulo
// ordena de mayor a menor seniority para que, con el mismo tope, los créditos
// vayan primero a dueños, C-level, VP y directores.
//
// Puro y estable: no llama a ningún proveedor y conserva el orden original entre
// candidatos del mismo nivel. Nunca descarta: solo reordena.

/** Nivel 0 = más senior. Lo desconocido queda al final. */
export const SENIORITY_RANK_UNKNOWN = 6;

function normalize(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Reglas por orden de prioridad; la primera que coincide define el nivel. */
const RANK_RULES: Array<{ rank: number; pattern: RegExp }> = [
  {
    rank: 0,
    pattern:
      /\b(owner|founder|fundador|fundadora|c[- ]?level|c[- ]?suite|cxo|ceo|coo|cfo|chro|cpo|chief|president[ea]?|gerente general|general manager|director general|managing director|country manager)\b/,
  },
  { rank: 1, pattern: /\b(vp|vice ?president[ea]?|vicepresident[ea]?|partner|socio)\b/ },
  { rank: 2, pattern: /\b(director|directora|head|jefe|jefa)\b/ },
  { rank: 3, pattern: /\b(manager|gerente|lead|lider|coordinador|coordinadora)\b/ },
  { rank: 4, pattern: /\b(senior|sr)\b/ },
];

/**
 * Nivel de seniority de un contacto. Usa primero la seniority del proveedor y,
 * si no la hay o no se reconoce, el título del cargo.
 */
export function seniorityRank(seniority: string | null | undefined, title?: string | null): number {
  for (const source of [normalize(seniority), normalize(title)]) {
    if (!source) continue;
    for (const rule of RANK_RULES) {
      if (rule.pattern.test(source)) return rule.rank;
    }
  }
  // Seniority del proveedor presente pero no reconocida (p. ej. "entry") → justo antes de lo vacío.
  return seniority || title ? SENIORITY_RANK_UNKNOWN - 1 : SENIORITY_RANK_UNKNOWN;
}

/** Devuelve una copia ordenada de mayor a menor seniority (orden estable). */
export function rankContactsBySeniority<T>(
  items: readonly T[],
  getSeniority: (item: T) => string | null | undefined,
  getTitle: (item: T) => string | null | undefined,
): T[] {
  return items
    .map((item, index) => ({ item, index, rank: seniorityRank(getSeniority(item), getTitle(item)) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.item);
}
