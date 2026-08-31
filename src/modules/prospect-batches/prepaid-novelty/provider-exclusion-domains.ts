/**
 * provider-exclusion-domains.ts — el colector CANÓNICO de dominios conocidos:
 * qué sabe SellUp, ya normalizado, y cuánto de eso podría viajar.
 *
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 11, 18, 22(H), 22(I).
 * AGENT1-LUSHA-CUT-L1-CLIENT-SIDE-EXCLUSION §§ 1, 2, 3.
 *
 * ── 🔴 CUT-L1 · Lusha V3 NO tiene exclusión server-side ──────────────────────
 *
 * El soporte HUMANO de Lusha confirmó que `POST /v3/companies/prospecting` NO
 * soporta un array de exclusión del lado del servidor: ni por dominio ni por id
 * de empresa. No existe `excludeDomains` y no existe `excludeCompanyIds`. Este
 * contrato HUMANO reemplaza cualquier afirmación anterior de este repo según la
 * cual `filters.companies.exclude.domains` estaba verificado — no lo estaba, y la
 * petición ya no emite ningún bloque de exclusión.
 *
 * Consecuencia económica, dicha sin adornos: la supresión de empresas ya
 * conocidas ocurre en el CLIENTE, DESPUÉS de la respuesta. Una empresa histórica
 * que Lusha devuelva puede haber costado ya sus créditos de Prospecting, y CUT-L1
 * no puede ahorrar ese crédito. Lo que sí impide es que vuelva a contar como
 * net-new y que arrastre trabajo pagado aguas abajo.
 *
 * ── 🔴 Dos preguntas DISTINTAS, y aquí no se mezclan ─────────────────────────
 *
 *   A. ¿Qué CONOCE SellUp?     → `availableValues`, siempre completo.
 *   B. ¿Qué puede ENVIARSE?    → `sent`, que hoy queda vacío para Lusha porque
 *                                su capacidad está apagada por contrato.
 *
 * Confundirlas fue el riesgo concreto de este corte: derivar la supresión local
 * de `sent` habría tirado a la basura la evidencia de dominios conocidos justo
 * cuando es la ÚNICA protección que queda. Por eso `availableValues` existe y por
 * eso viaja aparte.
 *
 * ── 🔴 Esto nunca fue la autoridad de dedupe ─────────────────────────────────
 *
 * No decide qué se persiste. El dedupe local POSTERIOR al proveedor sigue siendo
 * obligatorio y sigue siendo el único que manda.
 *
 * ── 🔴 El tope es NUESTRO, no del proveedor ──────────────────────────────────
 *
 * `PREPAID_EXCLUSION_DOMAIN_CAP` es una decisión propia y conservadora, no un
 * límite publicado por ningún proveedor. Acota SÓLO lo que podría viajar; nunca
 * recorta `availableValues`, que es evidencia local y no una petición.
 *
 * Puro: sin env, sin I/O, sin proveedor, sin DB, sin reloj.
 */

/**
 * Cuántos dominios como MÁXIMO viajarían al proveedor en una petición.
 *
 * Decisión propia (ver cabecera). 🔴 CUT-L1: hoy NINGÚN proveedor vivo tiene la
 * capacidad encendida, así que este tope no recorta ninguna petición real. Se
 * conserva porque es el tope de la DIMENSIÓN, no del proveedor, y borrarlo
 * obligaría a reinventarlo el día que un proveedor sí soporte exclusión.
 */
export const PREPAID_EXCLUSION_DOMAIN_CAP = 100;

export type ProviderExclusionDomainPlan = {
  /** Cuántos dominios conocidos y utilizables hay, ya normalizados y deduplicados. */
  available: number;
  /**
   * 🔴 CUT-L1 § 3 — los dominios conocidos EN SÍ, normalizados, deduplicados y en
   * orden determinista. Es la respuesta a «¿qué sabe SellUp?», y NO se recorta por
   * el tope: el tope acota lo que se ENVÍA, no lo que se sabe.
   *
   * Ésta es la lista de la que se alimenta la supresión CLIENTE. Derivarla de
   * `sent` tiraría la evidencia entera cuando la capacidad está apagada.
   */
  availableValues: readonly string[];
  /**
   * Los que realmente viajarían al proveedor, en orden determinista.
   *
   * 🔴 CUT-L1 § 2 — vacío para Lusha por contrato HUMANO. «Vacío» aquí significa
   * «el proveedor no puede recibirlos», nunca «no había nada».
   */
  sent: readonly string[];
  /** Cuántos conocidos se quedaron fuera por el tope. */
  omittedDueToCap: number;
};

/**
 * Normaliza un dominio a su forma comparable: minúsculas, sin esquema, sin
 * `www.`, sin credenciales, sin puerto, sin ruta y sin punto final.
 *
 * Devuelve `null` cuando el valor no puede ser un dominio. 🔴 Un `null` NO se
 * sustituye por nada: § 22(I) prohíbe fabricar un dominio para una empresa que no
 * tiene web. Una empresa sin dominio simplemente no aporta exclusión — se conoce
 * igual, y el dedupe local posterior sigue viéndola.
 */
export function normalizeExclusionDomain(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;

  let host = value.trim().toLowerCase();
  if (host === '') return null;

  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  const atIndex = host.lastIndexOf('@');
  if (atIndex !== -1) host = host.slice(atIndex + 1);
  host = host.split('/')[0] ?? '';
  host = host.split('?')[0] ?? '';
  host = host.split('#')[0] ?? '';
  host = host.split(':')[0] ?? '';
  host = host.replace(/^www\./, '').replace(/\.+$/, '');

  if (host === '') return null;
  // Un dominio utilizable tiene al menos una etiqueta y un TLD alfabético.
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(host)) return null;
  return host;
}

/**
 * Colecta los dominios conocidos y construye, de la MISMA lista, la vista acotada
 * que podría viajar al proveedor.
 *
 * 🔴 CUT-L1 § 3 — una sola normalización, un solo dedupe, un solo orden: las dos
 * vistas (`availableValues` y `sent`) salen de aquí para que no puedan divergir.
 *
 * La selección cuando hay más conocidos que tope es DETERMINISTA (§ 11): orden
 * lexicográfico y recorte por la cola. Determinista y no «los N más recientes»
 * porque dos corridas idénticas tienen que emitir la MISMA petición: si la lista
 * cambiara entre corridas, dos ejecuciones del mismo trabajo devolverían páginas
 * distintas y el dedupe entre ellas dejaría de ser reproducible.
 */
export function planProviderExclusionDomains(
  rawDomains: Iterable<string | null | undefined>,
  cap: number = PREPAID_EXCLUSION_DOMAIN_CAP,
): ProviderExclusionDomainPlan {
  const normalized = new Set<string>();
  for (const raw of rawDomains) {
    const domain = normalizeExclusionDomain(raw);
    if (domain !== null) normalized.add(domain);
  }

  const ordered = [...normalized].sort();
  const safeCap = Number.isFinite(cap) ? Math.max(0, Math.trunc(cap)) : 0;
  const sent = ordered.slice(0, safeCap);

  return {
    available: ordered.length,
    // 🔴 CUT-L1 § 3 — la evidencia local COMPLETA, sin recortar por tope.
    availableValues: ordered,
    sent,
    omittedDueToCap: ordered.length - sent.length,
  };
}
