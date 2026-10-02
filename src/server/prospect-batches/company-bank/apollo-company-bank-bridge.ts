/**
 * apollo-company-bank-bridge.ts — cómo una empresa de Apollo entra al banco y
 * cómo vuelve a salir. Puro: sin env, sin I/O.
 *
 * AGENT1-COMPANY-BANK. Ver `docs/agent1/COMPANY_BANK_DESIGN.md`.
 *
 * ── Qué entra ─────────────────────────────────────────────────────────────────
 *
 * Sólo lo que el TOPE DE ENTREGA dejó fuera: empresas que ya pasaron todos los
 * filtros gratuitos de la corrida (exclusión, país, propiedad, duplicado en
 * SellUp/HubSpot, reclamo global, novedad) y que no cupieron en los 10 del
 * vendedor. Nada de «Descartadas».
 *
 *   · Completa (contaba para la meta) ⇒ `ready`; si no ⇒ `to_complete`.
 *   · Sin dominio, sin evidencia o sin ninguna clave de reclamo ⇒ NO entra: se
 *     devuelve aparte y el llamador la deja en «Descartadas» como antes.
 *
 * ── Qué se guarda ─────────────────────────────────────────────────────────────
 *
 * La evidencia de búsqueda de Apollo (`ApolloTwoRoundCandidateEvidenceSnapshot`),
 * la MISMA que el checkpoint usa para reanudar una corrida sin volver a pagar. Es
 * acotada por construcción (textos ≤ 300, listas ≤ 10) y, al sacarla, se
 * reconstruye por el mismo camino que una reanudación: la empresa vuelve a pasar
 * todos los filtros gratis y la escribe el escritor de siempre, que es quien la
 * reclama para el vendedor.
 */

import { normalizeDomain } from '@/server/agents/prospecting-toolkit/normalization';
import type { DeliveryCappedCompany } from '@/server/agents/prospecting-toolkit/types';
import type { ApolloTwoRoundCandidateEvidenceSnapshot } from '@/server/agents/prospecting-toolkit/apollo-two-round/checkpoint';
import { COMPANY_BANK_MAX_PAYLOAD_BYTES } from './company-bank-types';
import { PIPELINE_CANDIDATE_BANK_PAYLOAD_KIND } from './pipeline-candidate-bank-payload';
import type {
  CompanyBankDepositItem,
  CompanyBankDrawnCompany,
  CompanyBankSettleItem,
} from './company-bank-types';

/** Versión del formato del `payload`. Un formato nuevo llega con su lector. */
export const APOLLO_BANK_PAYLOAD_KIND = 'apollo_evidence_v1';

/** Cuántas empresas saca del banco una corrida de Apollo (= el tope de entrega). */
export const APOLLO_BANK_DRAW_PER_RUN = 10;

/**
 * Cuánto dura la reserva. Una corrida de Apollo puede tardar varios minutos; si
 * la reserva vence antes de escribir, el reclamo del escritor sigue impidiendo
 * que dos vendedores reciban la misma empresa.
 */
export const APOLLO_BANK_RESERVE_SECONDS = 900;

/** Motivo de `missing_fields` de una `to_complete` de Apollo. */
export const APOLLO_BANK_MISSING_TARGET_CONDITIONS = 'target_conditions';

/** Interruptor de apagado (Vercel). Ausente ⇒ el banco funciona. */
export const COMPANY_BANK_DISABLED_ENV_VAR = 'AGENT1_COMPANY_BANK_DISABLED';

export function isCompanyBankDisabled(env: Record<string, string | undefined>): boolean {
  const raw = env[COMPANY_BANK_DISABLED_ENV_VAR];
  return typeof raw === 'string' && ['1', 'true', 'yes'].includes(raw.trim().toLowerCase());
}

/** La clave de evidencia del runner (`candidateKeyFor`), desde la empresa recortada. */
export function apolloEvidenceKeyForCapped(company: DeliveryCappedCompany): string {
  if (company.providerOrganizationId) return `apollo:${company.providerOrganizationId}`;
  const domain = company.domain ? normalizeDomain(company.domain) : null;
  if (domain) return `domain:${domain}`;
  return `name:${(company.name ?? '').trim().toLowerCase()}`;
}

export type ApolloBankDepositPlan = {
  items: CompanyBankDepositItem[];
  /** Lo que NO puede ir al banco: el llamador lo deja en «Descartadas». */
  notBankable: DeliveryCappedCompany[];
};

export function planApolloBankDeposit(input: {
  countryCode: string;
  macroIndustryKey: string | null;
  sourceBatchId: string | null;
  /** AGENT1-COMPANY-BANK-FIRST-1 — subindustrias de la búsqueda que deposita (ver el lector). */
  requestedSubindustries?: readonly string[];
  capped: readonly DeliveryCappedCompany[];
  evidenceFor: (company: DeliveryCappedCompany) => ApolloTwoRoundCandidateEvidenceSnapshot | null;
}): ApolloBankDepositPlan {
  if (!input.macroIndustryKey) return { items: [], notBankable: [...input.capped] };
  const items: CompanyBankDepositItem[] = [];
  const notBankable: DeliveryCappedCompany[] = [];
  for (const company of input.capped) {
    const domain = company.domain ? normalizeDomain(company.domain) : null;
    const evidence = input.evidenceFor(company);
    const claims = (company.claims ?? []).filter((claim) => claim.key.trim() !== '');
    if (!domain || !evidence || claims.length === 0) {
      notBankable.push(company);
      continue;
    }
    const ready = company.countsTowardTarget === true;
    // AGENT1-COMPANY-BANK-FIRST-1 — con el candidato completo la fila sirve
    // también para sacarla ANTES de todo (sin Apollo). La evidencia se conserva:
    // la ronda 1 de Apollo sigue sabiendo leerla. Si no cabe, sólo evidencia.
    const withCandidate = company.bankCandidate
      ? {
          kind: PIPELINE_CANDIDATE_BANK_PAYLOAD_KIND,
          evidence,
          candidate: company.bankCandidate,
          requestedSubindustries: [...(input.requestedSubindustries ?? [])],
        }
      : null;
    const payload =
      withCandidate && Buffer.byteLength(JSON.stringify(withCandidate), 'utf8') <= COMPANY_BANK_MAX_PAYLOAD_BYTES
        ? withCandidate
        : { kind: APOLLO_BANK_PAYLOAD_KIND, evidence };
    items.push({
      countryCode: input.countryCode,
      macroIndustryKey: input.macroIndustryKey,
      tier: ready ? 'ready' : 'to_complete',
      sourceProvider: 'apollo',
      claims,
      payload,
      missingFields: ready ? [] : [APOLLO_BANK_MISSING_TARGET_CONDITIONS],
      sourceBatchId: input.sourceBatchId,
    });
  }
  return { items, notBankable };
}

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;
const strList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * Lee la evidencia de una fila del banco. Lo que viene de la base de datos se
 * trata como no confiable: un formato desconocido o sin nombre/dominio ⇒ `null`
 * (el llamador invalida la fila en vez de inventar una empresa).
 */
export function readApolloBankEvidence(
  company: Pick<CompanyBankDrawnCompany, 'sourceProvider' | 'payload'>,
): ApolloTwoRoundCandidateEvidenceSnapshot | null {
  if (company.sourceProvider !== 'apollo') return null;
  const payload = company.payload as Record<string, unknown> | null;
  if (
    !payload ||
    (payload.kind !== APOLLO_BANK_PAYLOAD_KIND && payload.kind !== PIPELINE_CANDIDATE_BANK_PAYLOAD_KIND)
  ) {
    return null;
  }
  const e = payload.evidence as Record<string, unknown> | null;
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
  const title = str(e.title);
  const domain = str(e.domain);
  if (!title || !domain) return null;
  return {
    title,
    url: str(e.url) ?? '',
    snippet: str(e.snippet),
    rank: num(e.rank) ?? 0,
    source: str(e.source),
    origin_query: str(e.origin_query),
    provider_organization_id: str(e.provider_organization_id),
    domain,
    website: str(e.website),
    domain_aliases: strList(e.domain_aliases),
    linkedin_url: str(e.linkedin_url),
    industry: str(e.industry),
    industries: strList(e.industries),
    keywords: strList(e.keywords),
    organization_keywords: strList(e.organization_keywords),
    short_description: str(e.short_description),
    seo_description: str(e.seo_description),
    description: str(e.description),
    city: str(e.city),
    country: str(e.country),
    country_code: str(e.country_code),
    employee_count: num(e.employee_count),
    enrichment_fields_added: strList(e.enrichment_fields_added),
  };
}

/**
 * Antepone las empresas del banco a las de la página de Apollo.
 *
 * Van primero (ya esperaron y ya pasaron los filtros una vez); las de Apollo
 * conservan su orden y se desplazan. Si Apollo devuelve la misma empresa, gana la
 * copia fresca de Apollo y la del banco se quita de la lista. Sin banco, la lista
 * de Apollo sale idéntica.
 */
export function mergeBankOrganizations<T extends { providerRank: number }>(
  bank: readonly T[],
  fresh: readonly T[],
  keyOf: (organization: T) => string,
): T[] {
  if (bank.length === 0) return [...fresh];
  const freshKeys = new Set(fresh.map(keyOf));
  const kept = bank.filter((organization) => !freshKeys.has(keyOf(organization)));
  return [
    ...kept.map((organization, index) => ({ ...organization, providerRank: index + 1 })),
    ...fresh.map((organization) => ({ ...organization, providerRank: organization.providerRank + kept.length })),
  ];
}

export type DrawnBankCompany = { bankId: string; domain: string };

/**
 * Cierra la extracción:
 *   · se escribió en el lote del vendedor ⇒ `assigned`;
 *   · el tope la volvió a dejar fuera ⇒ `released` (vuelve al banco);
 *   · cualquier otra cosa (un filtro la rechazó, otro vendedor la reclamó) ⇒
 *     `invalidated` y sale del banco para siempre.
 */
export function planBankSettlement(input: {
  batchId: string;
  drawn: readonly DrawnBankCompany[];
  persistedCandidateIdByDomain: ReadonlyMap<string, string>;
  cappedDomains: ReadonlySet<string>;
}): CompanyBankSettleItem[] {
  return input.drawn.map(({ bankId, domain }) => {
    const candidateId = input.persistedCandidateIdByDomain.get(domain);
    if (candidateId) return { id: bankId, outcome: 'assigned', batchId: input.batchId, candidateId };
    if (input.cappedDomains.has(domain)) return { id: bankId, outcome: 'released' };
    return { id: bankId, outcome: 'invalidated', reason: 'not_admitted_on_redraw' };
  });
}
