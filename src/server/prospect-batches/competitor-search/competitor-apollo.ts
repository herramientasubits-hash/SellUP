/**
 * Agente 1 · «Competidores de una empresa» — Apollo como ÚLTIMO recurso (puro; la
 * búsqueda, el juez y la escritura se inyectan).
 *
 * Decisión de la dueña (15-10): «Sí, como último recurso». Corre sólo cuando lo
 * gratuito y las rondas de Claude en la web no llenaron Por revisar.
 *
 * Primero «empresas parecidas» de Apollo (soporte de Apollo, 15-10): con el dominio
 * de la referencia se obtiene su ID de organización (`q_organization_domains_list`)
 * y con ese ID una página de `lookalike_organization_ids` en el país, sin los
 * dominios ya vistos. Si no hay dominio, no se resuelve el ID o las parecidas no
 * traen nada nuevo, se cae a la consulta por las palabras clave en inglés de la
 * ficha. Cada página con resultados cuesta 1 crédito (una vacía no cobra): a lo
 * sumo 3 páginas por corrida (ID + parecidas + palabras clave).
 *
 * Lo devuelto pasa por el MISMO juez de Claude que lo gratuito: sólo se escribe lo
 * que compite con la referencia; si el juez no responde, no entra NINGUNA (nunca
 * una empresa sin filtrar).
 *
 * No usa la ruta Apollo del asistente (`wizard-apollo-executor`, dos rondas): esa
 * escribe directo al lote sin dejar filtrar. Nunca toca presupuesto del piloto ni
 * tablas de créditos: la única puerta de gasto es la cuota del proveedor.
 */

import type { CompetitorReference } from '@/modules/prospect-batches/competitor-search/competitor-reference';
import {
  COMPETITOR_JUDGE_MAX_ITEMS,
  type CompetitorJudgeItem,
} from '@/server/agents/prospecting-toolkit/claude-classifier/competitor-judge';
import type { ApolloOrganizationInput } from '@/server/agents/prospecting-toolkit/web-search-providers/apollo-organizations-search-provider';
import { isReferenceItself, type CompetitorJudgeFn } from './competitor-free-sources';

/** Resultados por página de búsqueda: 100 cuesta lo mismo que 25 (1 crédito, soporte 15-10). */
export const COMPETITOR_APOLLO_PER_PAGE = 100;
/** Página para hallar el ID de la referencia por su dominio: basta con pocas filas. */
export const COMPETITOR_APOLLO_RESOLVE_PER_PAGE = 5;
/** Tope de la lista de exclusión de Apollo (`not_organization_websites_list`). */
export const COMPETITOR_APOLLO_MAX_EXCLUDED_DOMAINS = 500;

export type CompetitorApolloStepInput = {
  reference: CompetitorReference;
  countryCode: string;
  countryName: string;
  industryName: string;
};

export type CompetitorApolloPage = {
  ok: boolean;
  organizations: ApolloOrganizationInput[];
  /** Filas crudas de la respuesta: > 0 ⇒ Apollo cobró la página. */
  rawCount: number;
  error: string | null;
};

/** Una organización que el juez eligió, con el motivo en una línea. */
export type CompetitorApolloPick = { organization: ApolloOrganizationInput; reason: string };

/** Para qué se pidió cada página (clave de uso y `flow` del registro). */
export type CompetitorApolloPagePurpose = 'resolve' | 'lookalikes' | 'keywords';

export type CompetitorApolloWriteResult = {
  persistedCount: number;
  completeValidCandidates: number | null;
  errors: string[];
};

export type CompetitorApolloStepDeps = {
  /** `ENABLE_APOLLO_COMPANY_SEARCH` (el kill switch de Apollo). */
  isEnabled: () => boolean;
  /** Cuota de Apollo en Proveedores; sin cuota no se llama. */
  checkQuota: () => Promise<{ allowed: boolean }>;
  /** El país como lo entiende Apollo («Colombia», «United States»); null ⇒ no se busca. */
  resolveLocation: (countryCode: string, countryName: string) => string | null;
  /** Dominios ya vistos en el lote. Si la lectura falla, se lanza y no se gasta. */
  loadExcludedDomains: () => Promise<string[]>;
  searchPage: (body: Record<string, unknown>) => Promise<CompetitorApolloPage>;
  logUsage: (entry: {
    purpose: CompetitorApolloPagePurpose;
    page: CompetitorApolloPage;
    body: Record<string, unknown>;
    durationMs: number;
  }) => Promise<void>;
  judge: CompetitorJudgeFn;
  writeCandidates: (picks: readonly CompetitorApolloPick[]) => Promise<CompetitorApolloWriteResult>;
  nowMs?: () => number;
};

export type CompetitorApolloOutcome = {
  status: 'written' | 'skipped' | 'nothing_selected' | 'failed';
  /** Por qué no escribió (null si escribió). */
  reason: string | null;
  persistedCount: number;
  completeValidCandidates: number | null;
  telemetry: Record<string, unknown>;
};

function cleanDomain(value: string | null | undefined): string | null {
  const domain = value?.trim().toLowerCase().replace(/^www\./, '') ?? '';
  return domain ? domain : null;
}

function cleanExclusion(domains: readonly string[]): string[] {
  return [...new Set(domains.map(cleanDomain).filter((d): d is string => d !== null))].slice(
    0,
    COMPETITOR_APOLLO_MAX_EXCLUDED_DOMAINS,
  );
}

/**
 * Respaldo: palabras clave (OR en Apollo) + país + exclusión. `null` ⇒ la ficha
 * no trae palabras clave (fichas anteriores) y no se busca: sin ellas Apollo
 * devolvería «empresas del país», no competidoras.
 */
export function buildCompetitorApolloSearchBody(input: {
  keywords: readonly string[] | undefined;
  location: string;
  excludeDomains: readonly string[];
}): Record<string, unknown> | null {
  const keywords = [...new Set((input.keywords ?? []).map((k) => k.trim()).filter(Boolean))];
  if (keywords.length === 0) return null;
  const excluded = cleanExclusion(input.excludeDomains);
  return {
    q_organization_keyword_tags: keywords,
    organization_locations: [input.location],
    ...(excluded.length > 0 ? { not_organization_websites_list: excluded } : {}),
    per_page: COMPETITOR_APOLLO_PER_PAGE,
    page: 1,
  };
}

/** Hallar el ID de Apollo de la referencia por su dominio (sin país ni exclusión). */
export function buildCompetitorApolloResolveBody(domain: string | null | undefined): Record<string, unknown> | null {
  const clean = cleanDomain(domain);
  if (!clean) return null;
  return { q_organization_domains_list: [clean], per_page: COMPETITOR_APOLLO_RESOLVE_PER_PAGE, page: 1 };
}

/**
 * Las parecidas a la referencia en el país, sin las ya vistas. Apollo combina los
 * filtros como AND y no devuelve la semilla (soporte 15-10).
 */
export function buildCompetitorApolloLookalikeBody(input: {
  organizationId: string;
  location: string;
  excludeDomains: readonly string[];
}): Record<string, unknown> {
  const excluded = cleanExclusion(input.excludeDomains);
  return {
    lookalike_organization_ids: [input.organizationId],
    organization_locations: [input.location],
    ...(excluded.length > 0 ? { not_organization_websites_list: excluded } : {}),
    per_page: COMPETITOR_APOLLO_PER_PAGE,
    page: 1,
  };
}

function orgDomain(org: ApolloOrganizationInput): string | null {
  return cleanDomain(org.primary_domain ?? org.website_url?.replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0] ?? null);
}

/** Qué hace la organización, para el juez: industria y descripción de Apollo. */
function orgActivity(org: ApolloOrganizationInput): string | null {
  const description = org.short_description ?? org.seo_description ?? org.description ?? null;
  const parts = [org.industry, description].filter((p): p is string => !!p && !!p.trim());
  return parts.length > 0 ? parts.join(' — ') : null;
}

/**
 * Lo que se le ofrece al juez: sin la referencia misma, sin dominios ya vistos
 * (por si Apollo no aplicó la exclusión) y sin repetidas. Claves `a1`, `a2`…
 */
export function toCompetitorApolloJudgeItems(
  organizations: readonly ApolloOrganizationInput[],
  reference: Pick<CompetitorReference, 'name' | 'domain'>,
  excludeDomains: readonly string[],
): { items: CompetitorJudgeItem[]; byKey: Map<string, ApolloOrganizationInput> } {
  const excluded = new Set(excludeDomains.map(cleanDomain).filter((d): d is string => d !== null));
  const seen = new Set<string>();
  const items: CompetitorJudgeItem[] = [];
  const byKey = new Map<string, ApolloOrganizationInput>();
  for (const org of organizations) {
    const name = org.name?.trim();
    if (!name) continue;
    const domain = orgDomain(org);
    if (domain && excluded.has(domain)) continue;
    if (isReferenceItself(reference, { name, domain })) continue;
    const identity = domain ?? `id:${org.id}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const key = `a${items.length + 1}`;
    byKey.set(key, org);
    items.push({ key, name, activity: orgActivity(org), activityCode: null, domain, city: org.city ?? null });
  }
  return { items, byKey };
}

/**
 * El ID de Apollo de la referencia: sólo una organización cuyo dominio es el de la
 * referencia (principal, cualquiera de los suyos o el de su web). Si no coincide
 * ninguna, `null`: con el ID de otra empresa se buscarían sus parecidas, no las de
 * la referencia.
 */
export function pickReferenceApolloOrganizationId(
  organizations: readonly ApolloOrganizationInput[],
  referenceDomain: string,
): string | null {
  const wanted = cleanDomain(referenceDomain);
  if (!wanted) return null;
  for (const org of organizations) {
    const domains = [orgDomain(org), ...(org.all_domains ?? []).map(cleanDomain)];
    if (org.id && domains.includes(wanted)) return org.id;
  }
  return null;
}

/**
 * El juez acepta hasta `COMPETITOR_JUDGE_MAX_ITEMS` por llamada: la página (hasta
 * 100) se parte en lotes que se juzgan a la vez. Un lote sin respuesta no aporta
 * NINGUNA de las suyas; `null` sólo si no respondió ninguno.
 */
export async function judgeCompetitorApolloItems(
  items: readonly CompetitorJudgeItem[],
  context: Omit<Parameters<CompetitorJudgeFn>[0], 'items'>,
  judge: CompetitorJudgeFn,
): Promise<{ verdicts: Array<{ key: string; reason: string }>; chunks: number; failedChunks: number } | null> {
  const chunks: CompetitorJudgeItem[][] = [];
  for (let i = 0; i < items.length; i += COMPETITOR_JUDGE_MAX_ITEMS) {
    chunks.push(items.slice(i, i + COMPETITOR_JUDGE_MAX_ITEMS));
  }
  const outcomes = await Promise.all(chunks.map((chunk) => judge({ ...context, items: chunk }).catch(() => null)));
  const answered = outcomes.filter((o): o is NonNullable<typeof o> => o !== null);
  if (answered.length === 0) return null;
  return {
    verdicts: answered.flatMap((o) => o.competitors),
    chunks: chunks.length,
    failedChunks: chunks.length - answered.length,
  };
}

/** Nunca lanza: cualquier tropiezo deja la corrida como estaba (sin aporte de Apollo). */
export async function runCompetitorApolloStep(
  input: CompetitorApolloStepInput,
  deps: CompetitorApolloStepDeps,
): Promise<CompetitorApolloOutcome> {
  const keywords = [...(input.reference.keywords ?? [])];
  const pages: Array<{ purpose: CompetitorApolloPagePurpose; ok: boolean; returned: number; charged: number }> = [];
  const telemetry: Record<string, unknown> = { keywords, pages };
  const done = (
    status: CompetitorApolloOutcome['status'],
    reason: string | null,
    write: CompetitorApolloWriteResult | null = null,
  ): CompetitorApolloOutcome => ({
    status,
    reason,
    persistedCount: write?.persistedCount ?? 0,
    completeValidCandidates: write ? write.completeValidCandidates : null,
    telemetry: {
      ...telemetry,
      credits_charged: pages.reduce((sum, p) => sum + p.charged, 0),
      status,
      reason,
    },
  });

  try {
    if (!deps.isEnabled()) return done('skipped', 'apollo_disabled');
    const referenceDomain = cleanDomain(input.reference.domain);
    const hasKeywords = keywords.some((k) => k.trim());
    if (!referenceDomain && !hasKeywords) return done('skipped', 'no_reference_domain_or_keywords');
    const location = deps.resolveLocation(input.countryCode, input.countryName);
    if (!location) return done('skipped', 'country_not_supported');
    if (!(await deps.checkQuota().catch(() => ({ allowed: false }))).allowed) return done('skipped', 'apollo_quota_unavailable');

    let excludeDomains: string[];
    try {
      excludeDomains = await deps.loadExcludedDomains();
    } catch {
      return done('skipped', 'exclusion_read_failed');
    }
    const exclusion = referenceDomain ? [referenceDomain, ...excludeDomains] : excludeDomains;
    telemetry.location = location;
    telemetry.excluded_domains_count = cleanExclusion(exclusion).length;

    const now = deps.nowMs ?? Date.now;
    const fetchPage = async (purpose: CompetitorApolloPagePurpose, body: Record<string, unknown>) => {
      const startedAt = now();
      const page = await deps.searchPage(body);
      await deps.logUsage({ purpose, page, body, durationMs: now() - startedAt }).catch(() => undefined);
      pages.push({ purpose, ok: page.ok, returned: page.organizations.length, charged: page.rawCount > 0 ? 1 : 0 });
      return page;
    };

    // 1. Parecidas a la referencia (necesita su dominio para hallar el ID).
    let offered: ReturnType<typeof toCompetitorApolloJudgeItems> | null = null;
    let fallbackReason: string | null = null;
    const resolveBody = buildCompetitorApolloResolveBody(referenceDomain);
    if (!resolveBody) {
      fallbackReason = 'no_reference_domain';
    } else {
      const resolved = await fetchPage('resolve', resolveBody);
      const organizationId = resolved.ok ? pickReferenceApolloOrganizationId(resolved.organizations, referenceDomain!) : null;
      telemetry.reference_apollo_id = organizationId;
      if (!organizationId) {
        fallbackReason = resolved.ok ? 'reference_not_found_in_apollo' : 'resolve_failed';
      } else {
        const lookalikes = await fetchPage(
          'lookalikes',
          buildCompetitorApolloLookalikeBody({ organizationId, location, excludeDomains: exclusion }),
        );
        const items = lookalikes.ok ? toCompetitorApolloJudgeItems(lookalikes.organizations, input.reference, exclusion) : null;
        if (items && items.items.length > 0) offered = items;
        else fallbackReason = lookalikes.ok ? 'lookalikes_nothing_new' : 'lookalikes_failed';
      }
    }

    // 2. Respaldo: palabras clave de la ficha.
    let strategy: CompetitorApolloPagePurpose = 'lookalikes';
    if (!offered) {
      telemetry.fallback_reason = fallbackReason;
      const body = buildCompetitorApolloSearchBody({ keywords, location, excludeDomains: exclusion });
      if (!body) return done('nothing_selected', `${fallbackReason}_no_keywords`);
      strategy = 'keywords';
      const page = await fetchPage('keywords', body);
      if (!page.ok) return done('failed', 'apollo_search_failed');
      offered = toCompetitorApolloJudgeItems(page.organizations, input.reference, exclusion);
    }
    telemetry.strategy = strategy;
    const { items, byKey } = offered;
    telemetry.offered_to_judge = items.length;
    if (items.length === 0) return done('nothing_selected', 'apollo_returned_nothing_new');

    const verdict = await judgeCompetitorApolloItems(
      items,
      { reference: input.reference, countryName: input.countryName, industryName: input.industryName },
      deps.judge,
    );
    // Sin juez no entra ninguna: nunca una empresa sin filtrar.
    if (!verdict) return done('failed', 'judge_unavailable');
    telemetry.judge_chunks = verdict.chunks;
    if (verdict.failedChunks > 0) telemetry.judge_chunks_failed = verdict.failedChunks;
    const picks = verdict.verdicts.flatMap((v) => {
      const organization = byKey.get(v.key);
      return organization ? [{ organization, reason: v.reason }] : [];
    });
    telemetry.selected = picks.length;
    telemetry.selected_sample = picks.slice(0, 10).map((p) => ({ name: p.organization.name, domain: orgDomain(p.organization) }));
    if (picks.length === 0) return done('nothing_selected', 'judge_selected_none');

    const write = await deps.writeCandidates(picks);
    if (write.errors.length > 0) telemetry.write_errors = write.errors.slice(0, 5);
    return write.persistedCount > 0 ? done('written', null, write) : done('nothing_selected', 'writer_persisted_none', write);
  } catch (err) {
    telemetry.error = err instanceof Error ? err.message.slice(0, 200) : 'unknown';
    return done('failed', 'unexpected_error');
  }
}
