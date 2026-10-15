/**
 * Agente 1 · «Competidores de una empresa» — lo GRATUITO, filtrado por Claude
 * (puro; el juez y las lecturas se inyectan).
 *
 * Decisión de la dueña (14-10): conectar a Competidores lo que ya usa la búsqueda
 * por criterios —registros oficiales del país y banco de empresas— sin que entren
 * «empresas de la misma industria» que no le compiten a nadie. Por eso:
 *
 *   · en Colombia se lee por el CIIU EXACTO de la referencia (si está en el
 *     registro y su código es de la industria elegida), no por toda la macro;
 *   · Claude (sin búsqueda web) elige de la lista cuáles compiten; si el juez no
 *     responde, no entra NINGUNA (nunca una empresa sin filtrar);
 *   · la referencia misma nunca se ofrece al juez (mismo dominio o mismo nombre).
 */

import type { CandidateRelationshipEvidence, ProspectingPipelineCandidate } from '@/server/agents/prospecting-toolkit/types';
import type {
  CompetitorJudgeInput,
  CompetitorJudgeItem,
  CompetitorJudgeOutcome,
} from '@/server/agents/prospecting-toolkit/claude-classifier/competitor-judge';
import type { CountrySourceCompany } from '@/server/prospect-batches/country-source-discovery/country-source-types';

/** Cuántas sacar del banco para que el juez elija (las no elegidas vuelven al banco). */
export const COMPETITOR_BANK_DRAW_LIMIT = 40;

/** Palabras de forma societaria o de relleno que no identifican a la empresa. */
const NAME_NOISE = new Set([
  's', 'a', 'sa', 'sas', 'saa', 'bic', 'ltda', 'ltd', 'inc', 'cia', 'y', 'e', 'de', 'del', 'la', 'el', 'los', 'las',
  'sociedad', 'anonima', 'limitada', 'compania', 'company', 'corp', 'corporation', 'grupo', 'group',
]);

/** «Almacenera del Agro S.A. (ALMAGRO)» → «almacenera agro» (minúsculas, sin tildes). */
export function normalizeReferenceName(name: string): string {
  return name
    .replace(/\([^)]*\)/g, ' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((word) => word.length > 0 && !NAME_NOISE.has(word))
    .join(' ');
}

/**
 * Patrón `ilike` para buscar la referencia por nombre en el registro (palabras en
 * orden, con lo que sea entre ellas). `null` ⇒ el nombre no deja nada útil.
 */
export function buildReferenceNamePattern(name: string): string | null {
  const words = normalizeReferenceName(name).split(' ').filter((word) => word.length >= 3).slice(0, 4);
  if (words.length === 0) return null;
  return `%${words.join('%')}%`;
}

/**
 * Los CIIU de las filas del registro que son la referencia, sólo los que caen en la
 * industria elegida (si no, la capa gratuita los rechazaría igual). Orden estable.
 */
export function pickReferenceActivityCodes(
  rows: ReadonlyArray<{ ciiu: string | null }>,
  macroCodes: readonly string[],
  normalizeCode: (code: string) => string | null,
): string[] {
  const allowed = new Set(macroCodes);
  const picked = new Set<string>();
  for (const row of rows) {
    const code = row.ciiu ? normalizeCode(row.ciiu) : null;
    if (code && allowed.has(code)) picked.add(code);
  }
  return [...picked].sort();
}

/**
 * ¿Se busca el CIIU de la referencia? Sólo si la búsqueda es en Colombia Y la
 * referencia es colombiana: una empresa de otro país no está en el registro y su
 * nombre puede coincidir con otra (Prod 15-10: «Grupo Caballero», mexicana, cayó
 * en una confeccionista colombiana «… Caballero» y se leyó el CIIU 1410).
 */
export function shouldResolveReferenceActivityCodes(
  searchCountryCode: string,
  reference: { homeCountryCode?: string | null },
): boolean {
  return searchCountryCode === 'CO' && reference.homeCountryCode === 'CO';
}

/**
 * ¿Esta fila del registro ES la referencia? Coincidencia EXACTA: misma web, o el
 * mismo nombre normalizado completo de al menos dos palabras (una sola palabra
 * —«caballero»— es demasiado común para identificar a nadie).
 */
export function isExactReferenceRow(
  reference: { name: string; domain: string | null },
  row: { legalName: string | null; websiteDomain: string | null },
): boolean {
  const refDomain = reference.domain?.toLowerCase().replace(/^www\./, '') ?? null;
  const rowDomain = row.websiteDomain?.toLowerCase().replace(/^www\./, '') ?? null;
  if (refDomain && rowDomain && refDomain === rowDomain) return true;
  const refName = normalizeReferenceName(reference.name);
  if (refName.split(' ').length < 2 || !row.legalName) return false;
  return normalizeReferenceName(row.legalName) === refName;
}

/** ¿Es la referencia misma? Mismo dominio, o mismo nombre normalizado. */
export function isReferenceItself(
  reference: { name: string; domain: string | null },
  company: { name: string | null; domain: string | null },
): boolean {
  const refDomain = reference.domain?.toLowerCase().replace(/^www\./, '') ?? null;
  const domain = company.domain?.toLowerCase().replace(/^www\./, '') ?? null;
  if (refDomain && domain && refDomain === domain) return true;
  const refName = normalizeReferenceName(reference.name);
  return refName.length > 0 && company.name !== null && normalizeReferenceName(company.name) === refName;
}

export type CompetitorJudgeContext = Omit<CompetitorJudgeInput, 'items'>;

export type CompetitorJudgeFn = (input: CompetitorJudgeInput) => Promise<CompetitorJudgeOutcome | null>;

/** Las del catálogo que el juez eligió, con su relación. `null` ⇒ el juez no respondió. */
export async function selectCompetitorCompanies(
  companies: readonly CountrySourceCompany[],
  context: CompetitorJudgeContext,
  judge: CompetitorJudgeFn,
): Promise<CountrySourceCompany[] | null> {
  const offered = companies
    .map((company, index) => ({ company, key: `e${index + 1}` }))
    .filter(({ company }) => !isReferenceItself(context.reference, { name: company.legalName, domain: company.domain }));
  if (offered.length === 0) return [];
  const items: CompetitorJudgeItem[] = offered.map(({ company, key }) => ({
    key,
    name: company.legalName ?? 'Sin nombre',
    activity: company.declaredIndustry,
    activityCode: company.industryCode,
    domain: company.domain,
    city: company.city,
  }));
  const outcome = await judge({ ...context, items });
  if (!outcome) return null;
  const byKey = new Map(offered.map((entry) => [entry.key, entry.company]));
  return outcome.competitors.flatMap((verdict) => {
    const company = byKey.get(verdict.key);
    return company
      ? [{ ...company, competitorRelationship: { referenceCompanyName: context.reference.name, reason: verdict.reason } }]
      : [];
  });
}

/** Lo que Claude sabe de una empresa del banco: lo que guardó la búsqueda que la trajo. */
function bankActivity(candidate: ProspectingPipelineCandidate): string | null {
  return candidate.sourceSnippet ?? candidate.sourceTitle ?? null;
}

/** Las del banco que el juez eligió (índices), con su relación. `null` ⇒ el juez no respondió. */
export async function selectCompetitorBankCandidates(
  candidates: readonly ProspectingPipelineCandidate[],
  context: CompetitorJudgeContext,
  judge: CompetitorJudgeFn,
): Promise<Array<{ index: number; relationshipEvidence: CandidateRelationshipEvidence }> | null> {
  const offered = candidates
    .map((candidate, index) => ({ candidate, index, key: `b${index + 1}` }))
    .filter(({ candidate }) => !isReferenceItself(context.reference, { name: candidate.name, domain: candidate.domain }));
  if (offered.length === 0) return [];
  const outcome = await judge({
    ...context,
    items: offered.map(({ candidate, key }) => ({
      key,
      name: candidate.name,
      activity: bankActivity(candidate),
      activityCode: null,
      domain: candidate.domain,
      city: null,
    })),
  });
  if (!outcome) return null;
  const byKey = new Map(offered.map((entry) => [entry.key, entry.index]));
  return outcome.competitors.flatMap((verdict) => {
    const index = byKey.get(verdict.key);
    return index === undefined
      ? []
      : [
          {
            index,
            relationshipEvidence: {
              kind: 'competitor_of' as const,
              referenceCompanyName: context.reference.name,
              evidenceUrl: null,
              evidence: verdict.reason,
            },
          },
        ];
  });
}
