/**
 * GT RGAE — CAPACIDAD_ECONOMICA Parser
 *
 * Parser explícito para el campo CAPACIDAD_ECONOMICA del XLSX RGAE Guatemala.
 * Valores reales observados: "N/A", "COMPRA DIRECTA", decimal strings.
 *
 * Reglas:
 * - No asumir moneda (GTQ vs USD no está documentado en el dataset).
 * - No llamar revenue ni ARR — no es tamaño de empresa.
 * - Preservar raw value siempre.
 * - Negativos → unparsed salvo evidencia real contraria.
 *
 * Hito: Centroamérica.7G.1
 */

import type { GtRgaeEconomicCapacity } from './gt-rgae-types';

const NOT_APPLICABLE_PATTERNS = /^\s*n\/?a\s*$/i;
const DIRECT_PURCHASE_PATTERN = /^\s*compra\s+directa\s*$/i;

/**
 * Parsea el campo CAPACIDAD_ECONOMICA.
 * Nunca lanza. Devuelve kind='unparsed' para valores no reconocidos.
 */
export function parseEconomicCapacity(
  raw: string | number | null | undefined,
): GtRgaeEconomicCapacity {
  if (raw === null || raw === undefined) {
    return { kind: 'unparsed', amount: null, raw: null };
  }

  const rawStr = typeof raw === 'number' ? String(raw) : String(raw);

  if (NOT_APPLICABLE_PATTERNS.test(rawStr)) {
    return { kind: 'not_applicable', amount: null, raw: rawStr };
  }

  if (DIRECT_PURCHASE_PATTERN.test(rawStr)) {
    return { kind: 'direct_purchase', amount: null, raw: rawStr };
  }

  // Intentar parsear como número decimal
  // Limpiar separadores de miles comunes (comas o puntos como separador de miles)
  const cleaned = rawStr.trim().replace(/,/g, '');
  const parsed = parseFloat(cleaned);

  if (!isNaN(parsed) && isFinite(parsed)) {
    // Negativos → unparsed (sin evidencia real de valores negativos en dataset)
    if (parsed < 0) {
      return { kind: 'unparsed', amount: null, raw: rawStr };
    }
    return { kind: 'numeric', amount: parsed, raw: rawStr };
  }

  return { kind: 'unparsed', amount: null, raw: rawStr };
}
