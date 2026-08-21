/**
 * lusha-run-identity-registry.ts — una empresa se cuenta UNA vez por corrida,
 * aunque la devuelvan dos ramas distintas.
 *
 * AGENT1-LUSHA-MACRO-V2-MULTIBRANCH-EXECUTOR-1 §§ 10, 11.
 *
 * ── Por qué el `Set<string>` de antes no alcanza ───────────────────────────────
 *
 * El ejecutor de una sola búsqueda deduplicaba con un `Set` de UNA clave por
 * empresa: `dominio ?? nombre`. Con ramas eso se rompe de una forma concreta y
 * costosa. `energy_mining_environment` pide Oil/Gas/Mining y luego Utilities;
 * una generadora que Lusha clasifique en las dos vuelve en las dos ramas. Si su
 * dominio viene vacío en una respuesta y presente en la otra —cosa que pasa: el
 * gate del preview marca `missing_domain` como un defecto frecuente— las dos
 * claves NO coinciden, y la misma empresa se cuenta dos veces contra el objetivo,
 * se enriquece dos veces y se persiste dos veces.
 *
 * De ahí que la identidad sea PLURAL: cuatro señales independientes, y basta que
 * UNA coincida para que la empresa ya se conozca.
 *
 * ── El orden es de fuerza, no de gusto ────────────────────────────────────────
 *
 *   1. id de empresa del proveedor  — lo más fuerte que Lusha da.
 *   2. dominio normalizado          — la clave que la corrida ya usaba.
 *   3. URL de LinkedIn normalizada  — identidad pública estable.
 *   4. nombre normalizado, SÓLO como respaldo (ver abajo).
 *
 * El motivo que se reporta es el primero que aplica, de modo que la telemetría
 * nombre siempre la señal más defendible.
 *
 * ── 🔴 El nombre es RESPALDO, y eso es deliberado ─────────────────────────────
 *
 * El nombre sólo participa cuando la empresa NO trae dominio, que es exactamente
 * el papel que ya tenía (`dominio ?? nombre`). Promoverlo a señal permanente
 * parecería «más dedupe» y sería un defecto: «Servicios Integrales S.A.S.» existe
 * decenas de veces en Colombia con dominios y NITs distintos, así que colapsar
 * por nombre a dos empresas con dominios diferentes las declararía la misma y
 * descartaría un candidato legítimo — y lo haría en silencio, contado como
 * «duplicado». La misma conclusión a la que llegó el registro de Apollo
 * (`seen-registry.ts`), que sólo admite el nombre acompañado de un dominio ya
 * conocido.
 *
 * ── Normalizadores REUTILIZADOS, no nuevos ────────────────────────────────────
 *
 * Ninguna de las cuatro normalizaciones se INVENTA aquí:
 *
 *   · `normalizeDomain`            — el del preview de Lusha, el MISMO que la
 *     corrida ya usaba. Cambiarlo por el «dominio registrable» de Apollo movería
 *     qué se considera duplicado en la ruta que hoy está viva, y eso no es lo que
 *     este trabajo autoriza.
 *   · `normalizeLinkedinUrl`       — el normalizador neutral de proveedor que ya
 *     existe en `prospecting-toolkit/normalization`.
 *   · `normalizeLushaCompanyName`  — el del writer de Lusha, cuya implementación
 *     canónica se MUEVE aquí y el writer re-exporta, para que no haya dos.
 *
 * No hay lógica difusa nueva: ni conteo de empleados, ni descripción, ni
 * ubicación. Nada de eso identifica una empresa.
 *
 * Puro: sin env, sin I/O, sin cliente de proveedor, sin DB, sin reloj.
 */

import { normalizeDomain } from './lusha-preview';
import { normalizeLinkedinUrl } from '@/server/agents/prospecting-toolkit/normalization';
import type { LushaPreviewCompany } from './lusha-preview';

// ─── Contrato ─────────────────────────────────────────────────────────────────

/** Las cuatro identidades normalizadas de una empresa. `null` = no la trae. */
export type LushaCompanyIdentity = {
  providerCompanyId: string | null;
  normalizedDomain: string | null;
  normalizedLinkedInUrl: string | null;
  /** Nombre normalizado. Siempre se calcula; sólo DECIDE si no hay dominio. */
  normalizedName: string | null;
};

/**
 * Por qué una empresa se reconoció como ya vista.
 *
 * `unusable` no es un duplicado: es una fila que el esquema no puede persistir
 * (`prospect_candidates.name` es NOT NULL). Se mantiene separado porque
 * confundirlo con un duplicado haría creer que el proveedor repitió resultados
 * cuando lo que hizo fue devolver basura.
 */
export type LushaIdentityDuplicateReason =
  | 'provider_company_id'
  | 'normalized_domain'
  | 'normalized_linkedin_url'
  | 'normalized_name_fallback';

export type LushaIdentityVerdict =
  | { outcome: 'unique'; identity: LushaCompanyIdentity }
  | { outcome: 'unusable'; identity: LushaCompanyIdentity }
  | {
      outcome: 'duplicate';
      identity: LushaCompanyIdentity;
      reason: LushaIdentityDuplicateReason;
    };

/**
 * El registro compartido por TODA la corrida: todas las páginas de todas las
 * ramas. § 11 es explícito en que no puede haber un conjunto por página ni por
 * rama, porque es justo por esa rendija por donde se escapan los duplicados.
 */
export type LushaRunIdentityRegistry = {
  providerCompanyIds: ReadonlySet<string>;
  normalizedDomains: ReadonlySet<string>;
  normalizedLinkedInUrls: ReadonlySet<string>;
  normalizedNames: ReadonlySet<string>;
};

export function createLushaRunIdentityRegistry(): LushaRunIdentityRegistry {
  return {
    providerCompanyIds: new Set<string>(),
    normalizedDomains: new Set<string>(),
    normalizedLinkedInUrls: new Set<string>(),
    normalizedNames: new Set<string>(),
  };
}

// ─── Normalización ────────────────────────────────────────────────────────────

/**
 * Nombre de empresa normalizado para dedupe y para la columna `normalized_name`.
 *
 * 🔑 Ésta es la ÚNICA implementación: `lusha-pending-review` la re-exporta con
 * este mismo nombre en lugar de conservar su copia. Dos normalizadores de nombre
 * con la misma intención derivarían —uno quitaría un caracter que el otro no— y
 * la clave de dedupe dejaría de coincidir con la columna persistida sin que nada
 * fallara.
 */
export function normalizeLushaCompanyName(
  name: string | null | undefined,
): string | null {
  if (!name) return null;
  const normalized = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.length > 0 ? normalized : null;
}

export function resolveLushaCompanyIdentity(
  company: Pick<
    LushaPreviewCompany,
    'providerCompanyId' | 'name' | 'domain' | 'linkedinUrl'
  >,
): LushaCompanyIdentity {
  const providerCompanyId =
    typeof company.providerCompanyId === 'string' && company.providerCompanyId.trim()
      ? company.providerCompanyId.trim()
      : null;
  return {
    providerCompanyId,
    normalizedDomain: normalizeDomain(company.domain),
    normalizedLinkedInUrl: normalizeLinkedinUrl(company.linkedinUrl),
    normalizedName: normalizeLushaCompanyName(company.name),
  };
}

// ─── Decisión ─────────────────────────────────────────────────────────────────

/**
 * ¿Ya conocemos esta empresa en esta corrida?
 *
 * No muta el registro: registrar es un paso aparte (`registerLushaCompanyIdentity`)
 * para que el llamador pueda decidir entre saber y comprometerse — y para cumplir
 * la regla de inmutabilidad del repo.
 */
export function evaluateLushaCompanyIdentity(
  registry: LushaRunIdentityRegistry,
  company: Pick<
    LushaPreviewCompany,
    'providerCompanyId' | 'name' | 'domain' | 'linkedinUrl'
  >,
): LushaIdentityVerdict {
  const identity = resolveLushaCompanyIdentity(company);

  // Sin nombre la fila es impersistible (columna NOT NULL). Se decide ANTES de
  // mirar duplicados: una fila que no puede existir no es un duplicado de nada.
  if (identity.normalizedName === null) {
    return { outcome: 'unusable', identity };
  }

  if (
    identity.providerCompanyId !== null &&
    registry.providerCompanyIds.has(identity.providerCompanyId)
  ) {
    return { outcome: 'duplicate', identity, reason: 'provider_company_id' };
  }
  if (
    identity.normalizedDomain !== null &&
    registry.normalizedDomains.has(identity.normalizedDomain)
  ) {
    return { outcome: 'duplicate', identity, reason: 'normalized_domain' };
  }
  if (
    identity.normalizedLinkedInUrl !== null &&
    registry.normalizedLinkedInUrls.has(identity.normalizedLinkedInUrl)
  ) {
    return { outcome: 'duplicate', identity, reason: 'normalized_linkedin_url' };
  }
  // Respaldo: sólo cuando la empresa no trae dominio. Ver la cabecera.
  if (
    identity.normalizedDomain === null &&
    registry.normalizedNames.has(identity.normalizedName)
  ) {
    return { outcome: 'duplicate', identity, reason: 'normalized_name_fallback' };
  }

  return { outcome: 'unique', identity };
}

/**
 * Registra las identidades de una empresa y devuelve un registro NUEVO.
 *
 * El nombre se registra SÓLO cuando actúa como clave (sin dominio), que es la
 * regla que ya regía: una empresa con dominio nunca publicó su nombre al
 * conjunto, y hacerlo ahora convertiría a un homónimo posterior sin dominio en un
 * falso duplicado.
 */
export function registerLushaCompanyIdentity(
  registry: LushaRunIdentityRegistry,
  identity: LushaCompanyIdentity,
): LushaRunIdentityRegistry {
  const providerCompanyIds = new Set(registry.providerCompanyIds);
  const normalizedDomains = new Set(registry.normalizedDomains);
  const normalizedLinkedInUrls = new Set(registry.normalizedLinkedInUrls);
  const normalizedNames = new Set(registry.normalizedNames);

  if (identity.providerCompanyId !== null) {
    providerCompanyIds.add(identity.providerCompanyId);
  }
  if (identity.normalizedDomain !== null) {
    normalizedDomains.add(identity.normalizedDomain);
  }
  if (identity.normalizedLinkedInUrl !== null) {
    normalizedLinkedInUrls.add(identity.normalizedLinkedInUrl);
  }
  if (identity.normalizedDomain === null && identity.normalizedName !== null) {
    normalizedNames.add(identity.normalizedName);
  }

  return {
    providerCompanyIds,
    normalizedDomains,
    normalizedLinkedInUrls,
    normalizedNames,
  };
}

// ─── Dedupe de un lote ────────────────────────────────────────────────────────

export type LushaIdentityDedupeResult = {
  unique: LushaPreviewCompany[];
  /** Filas impersistibles (sin nombre). NO son duplicados. */
  unusableCount: number;
  /** Empresas descartadas por identidad ya conocida. */
  duplicateCount: number;
  /** Cuántos duplicados por cada señal. Telemetría, no decisión. */
  duplicateReasonCounts: Record<LushaIdentityDuplicateReason, number>;
  /** Registro resultante: el llamador lo encadena a la siguiente página/rama. */
  registry: LushaRunIdentityRegistry;
};

function emptyReasonCounts(): Record<LushaIdentityDuplicateReason, number> {
  return {
    provider_company_id: 0,
    normalized_domain: 0,
    normalized_linkedin_url: 0,
    normalized_name_fallback: 0,
  };
}

/**
 * Deduplica una página CONTRA toda la corrida y devuelve el registro encadenable.
 *
 * Los duplicados DENTRO de la misma página se resuelven igual que los de otra
 * página o rama, porque cada empresa se registra en cuanto se acepta: no hay un
 * segundo mecanismo para el caso intra-página.
 */
export function dedupeLushaCompaniesByIdentity(
  companies: readonly LushaPreviewCompany[],
  registry: LushaRunIdentityRegistry,
): LushaIdentityDedupeResult {
  const unique: LushaPreviewCompany[] = [];
  const duplicateReasonCounts = emptyReasonCounts();
  let unusableCount = 0;
  let duplicateCount = 0;
  let current = registry;

  for (const company of companies) {
    const verdict = evaluateLushaCompanyIdentity(current, company);
    if (verdict.outcome === 'unusable') {
      unusableCount++;
      continue;
    }
    if (verdict.outcome === 'duplicate') {
      duplicateCount++;
      duplicateReasonCounts[verdict.reason]++;
      continue;
    }
    current = registerLushaCompanyIdentity(current, verdict.identity);
    unique.push(company);
  }

  return {
    unique,
    unusableCount,
    duplicateCount,
    duplicateReasonCounts,
    registry: current,
  };
}

/** Vista serializable del registro. Sin PII: dominios, slugs e ids de empresa. */
export function toLushaIdentityRegistrySnapshot(
  registry: LushaRunIdentityRegistry,
): Record<string, number> {
  return {
    provider_company_id_count: registry.providerCompanyIds.size,
    normalized_domain_count: registry.normalizedDomains.size,
    normalized_linkedin_url_count: registry.normalizedLinkedInUrls.size,
    normalized_name_count: registry.normalizedNames.size,
  };
}
