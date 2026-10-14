/**
 * br-receita-macro-table.ts — qué macro industria corresponde a cada actividad
 * principal (CNAE 2.3) de una empresa del cadastro CNPJ de la Receita Federal.
 *
 * SOURCES-BR-LIGHT-1 — tabla aprobada por la dueña el 13-10-2026.
 *
 * ── Misma tabla por división que Argentina, Perú y Ecuador ──────────────────
 *
 * La CNAE 2.3 deriva de la CIIU Rev. 4: sus dos primeros dígitos (la división)
 * son los mismos. La división se resuelve con la tabla aprobada para Argentina
 * (`AR_RNS_DIVISION_MACRO`). Aquí sólo se añaden las CLASES (4 dígitos de la CNAE)
 * que la división no distingue — las mismas decisiones que Argentina v2:
 *
 *   - 4644 comercio atacadista de medicamentos y 4771 farmacias → Salud (la CNAE,
 *     como ARCA, sí separa a los mayoristas de medicamentos).
 *   - 4651 y 4652 atacado de informática y de componentes electrónicos y de
 *     telecomunicaciones, 4751 varejo de informática → Tecnología.
 *
 * ── Fuera del buscador gratuito (ruido medido el 13-10-2026) ────────────────
 *
 * Holdings y fondos (6461, 6462, 6463, 6470) y SPE inmobiliarias (4110
 * incorporación, 6810 compraventa de inmuebles propios, 6821 y 6822
 * intermediación y gestión inmobiliaria): eran 2 de cada 3 empresas «grandes» por
 * capital y casi nunca son la empresa operativa. Siguen en el registro para el
 * CNPJ por nombre; sólo no se ofrecen en el buscador.
 *
 * Reglas: la clase manda sobre su división; una división que no aparece no tiene
 * macro (hoteles, restaurantes, medios, educación, asociaciones). Cambiar esta
 * tabla es una decisión de producto: no se edita sin el visto bueno de la dueña.
 *
 * Puro: sin env, sin I/O, sin DB, sin reloj.
 */

import type { MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';
import { AR_RNS_DIVISION_MACRO } from './ar-rns-macro-table';

/** Versión de la tabla. */
export const BR_RECEITA_MACRO_TABLE_VERSION = 'br-cnae23-receita-macro-v1' as const;

/** Clase CNAE (4 dígitos) → macro. Manda sobre la división. */
export const BR_RECEITA_CLASS_MACRO: Readonly<Record<string, MacroIndustryKey>> = Object.freeze({
  '4644': 'health_pharma', // comércio atacadista de produtos farmacêuticos para uso humano e veterinário
  '4771': 'health_pharma', // comércio varejista de produtos farmacêuticos (farmácias)
  '4651': 'technology', // comércio atacadista de computadores, periféricos e suprimentos de informática
  '4652': 'technology', // comércio atacadista de componentes eletrônicos e equipamentos de telefonia
  '4751': 'technology', // comércio varejista especializado de equipamentos e suprimentos de informática
});

/** Clases CNAE que nunca se ofrecen en el buscador gratuito (holdings, fondos, SPE inmobiliarias). */
export const BR_RECEITA_DISCOVERY_EXCLUDED_CLASSES: ReadonlySet<string> = new Set([
  '6461', '6462', '6463', '6470', '4110', '6810', '6821', '6822',
]);

/** CNAE tal como llega (7 dígitos, con o sin puntuación) → 7 dígitos, o `null`. */
export function normalizeBrCnaeCode(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.replace(/[^0-9]/g, '');
  return /^\d{7}$/.test(code) ? code : null;
}

/** Macro de UNA actividad CNAE, o `null` si no tiene. */
export function resolveBrCnaeMacro(raw: string | null | undefined): MacroIndustryKey | null {
  const code = normalizeBrCnaeCode(raw);
  if (code === null) return null;
  return BR_RECEITA_CLASS_MACRO[code.slice(0, 4)] ?? AR_RNS_DIVISION_MACRO[code.slice(0, 2)] ?? null;
}

/** ¿Se puede ofrecer una empresa con esta actividad en el buscador gratuito? */
export function brCnaeAllowedInDiscovery(raw: string | null | undefined): boolean {
  const code = normalizeBrCnaeCode(raw);
  return code !== null && !BR_RECEITA_DISCOVERY_EXCLUDED_CLASSES.has(code.slice(0, 4));
}

/** ¿Tiene esta macro alguna actividad brasileña clasificada? */
export function macroHasBrReceitaCoverage(macroIndustryKey: string | null | undefined): boolean {
  if (typeof macroIndustryKey !== 'string') return false;
  return (
    Object.values(AR_RNS_DIVISION_MACRO).includes(macroIndustryKey as MacroIndustryKey) ||
    Object.values(BR_RECEITA_CLASS_MACRO).includes(macroIndustryKey as MacroIndustryKey)
  );
}
