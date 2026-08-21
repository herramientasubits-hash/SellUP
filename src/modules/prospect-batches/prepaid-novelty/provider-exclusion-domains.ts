/**
 * provider-exclusion-domains.ts — la lista de dominios que se le pide al
 * proveedor que NO devuelva.
 *
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 11, 18, 22(H), 22(I).
 *
 * ── 🔴 Esto es una PISTA ECONÓMICA, no la autoridad de dedupe ─────────────────
 *
 * Excluir dominios ahorra filas pagadas; no decide qué se persiste. El dedupe
 * local POSTERIOR al proveedor sigue siendo obligatorio y sigue siendo el único
 * que manda, por tres razones que no se pueden arreglar aquí: el proveedor puede
 * ignorar la exclusión, puede devolver la misma empresa bajo otro dominio, y la
 * lista viaja acotada (ver el tope de abajo) así que nunca es completa.
 *
 * ── 🔴 Sólo dominios. Nada más está probado ──────────────────────────────────
 *
 * El contrato de Lusha V3 que el repo tiene verificado es
 * `filters.companies.exclude.domains: string[]` — y sólo eso. Excluir por nombre,
 * por LinkedIn, por identificador fiscal o por id de empresa del proveedor NO
 * está demostrado en ningún sitio, así que este módulo no los modela. Apollo no
 * recibe exclusiones por la misma razón: su contrato no las prueba (§ 18).
 *
 * ── 🔴 El tope es NUESTRO, no del proveedor ──────────────────────────────────
 *
 * Ninguna documentación verificada del repo declara un máximo de dominios en
 * `exclude.domains`. Por eso el tope de abajo se declara como decisión propia y
 * conservadora, no como «el límite del proveedor»: llamarlo límite del proveedor
 * sería inventar un hecho. Lo que sí se hace es CONTARLO — `omittedDueToCap` deja
 * dicho cuántos conocidos no viajaron, para que un recorte silencioso no se lea
 * como «se excluyó todo lo que sabíamos» (§ 20, «no silent caps»).
 *
 * Puro: sin env, sin I/O, sin proveedor, sin DB, sin reloj.
 */

/**
 * Cuántos dominios como MÁXIMO viajan al proveedor en una petición.
 *
 * Decisión propia (ver cabecera). 100 es holgado frente a los pocos cientos de
 * dominios que SellUp conoce hoy y sigue siendo una URL/JSON manejable.
 */
export const PREPAID_EXCLUSION_DOMAIN_CAP = 100;

export type ProviderExclusionDomainPlan = {
  /** Dominios conocidos y utilizables, ya normalizados y deduplicados. */
  available: number;
  /** Los que realmente viajan, en orden determinista. */
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
 * Construye la lista acotada que viaja al proveedor.
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
    sent,
    omittedDueToCap: ordered.length - sent.length,
  };
}
