// AGENT2-APOLLO-PEOPLE-SEARCH-V2-1 — diagnóstico: búsqueda de siempre vs. formato documentado
//
// Para una empresa, corre los intentos de siempre y los documentados (v2) y devuelve cuántas
// personas trajo cada intento y una muestra de CARGOS. Sirve para decidir con datos reales si
// se enciende ENABLE_APOLLO_PEOPLE_SEARCH_V2.
//
// Costo: 0 créditos. Sólo llama a la búsqueda de personas, que es gratis. NO vuelve a buscar la
// empresa en Apollo (eso cobra): usa el organization_id que guardó la última búsqueda de
// contactos de ese dominio, o sólo el dominio si no hay ninguno. No guarda nada, no crea
// candidatos y no devuelve nombres, correos ni teléfonos: sólo conteos y cargos.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { searchApolloPeopleForCompany, type ApolloPeopleAdapterDeps, type ApolloPeopleAdapterResult } from './apollo-people-adapter';
import { buildDomainLookupSpellings } from './local-reviewable-candidate-reuse-gate';
import type { ApolloOrgResolutionResult } from './apollo-organization-resolver';

const SAMPLE_TITLES = 5;

export interface PeopleSearchDiagnosticTarget {
  companyName: string;
  companyDomain: string | null;
  countryCode: string | null;
  organizationId: string | null;
}

export interface PeopleSearchDiagnosticSide {
  status: ApolloPeopleAdapterResult['status'];
  reason: string | null;
  attempts: Array<{ attempt: string; filters: string; people: number }>;
  chosenAttempt: string | null;
  peopleReturned: number;
  sampleTitles: string[];
}

export interface PeopleSearchDiagnosticReport {
  target: PeopleSearchDiagnosticTarget;
  creditsUsed: 0;
  current: PeopleSearchDiagnosticSide;
  documented: PeopleSearchDiagnosticSide;
}

function toSide(result: ApolloPeopleAdapterResult): PeopleSearchDiagnosticSide {
  return {
    status: result.status,
    reason: result.reason ?? null,
    attempts: result.attempts.map((a) => ({ attempt: a.attempt, filters: a.filters, people: a.rawResultsCount })),
    chosenAttempt: result.chosenAttempt ?? null,
    peopleReturned: result.people.length,
    sampleTitles: result.people
      .map((p) => (typeof p.title === 'string' ? p.title.trim() : ''))
      .filter((t) => t.length > 0)
      .slice(0, SAMPLE_TITLES),
  };
}

/** Corre las dos versiones con el organization_id ya conocido: nunca paga por resolver la empresa. */
export async function runPeopleSearchDiagnostic(
  target: PeopleSearchDiagnosticTarget,
  deps: Pick<ApolloPeopleAdapterDeps, 'isConnected' | 'searchPeople' | 'searchPeopleByQuery'> = {},
): Promise<PeopleSearchDiagnosticReport> {
  const knownOrg = async (): Promise<ApolloOrgResolutionResult | null> =>
    target.organizationId
      ? {
          organizationId: target.organizationId,
          organizationName: target.companyName,
          organizationDomain: target.companyDomain,
          resolutionStatus: 'found_by_domain',
          resolutionMethod: 'domain',
          candidatesCount: 1,
          // 0 y 0: aquí no se consultó la búsqueda de empresas, así que no se cobró nada.
          diagnostics: {
            domain_query_results: 0,
            name_query_results: 0,
            selected_organization_id: target.organizationId,
            selected_organization_name: target.companyName,
            selected_organization_domain: target.companyDomain,
          },
        }
      : null;
  const input = {
    runId: 'diagnostic',
    companyName: target.companyName,
    companyDomain: target.companyDomain,
    companyCountryCode: target.countryCode,
  };
  const current = await searchApolloPeopleForCompany(input, { ...deps, resolveOrganization: knownOrg, isDocumentedPeopleSearchEnabled: () => false });
  const documented = await searchApolloPeopleForCompany(input, { ...deps, resolveOrganization: knownOrg, isDocumentedPeopleSearchEnabled: () => true });
  return { target, creditsUsed: 0, current: toSide(current), documented: toSide(documented) };
}

/** Lo que guardó la última búsqueda de contactos de ese dominio: nombre, país y organization_id. */
export async function loadDiagnosticTargetForDomain(domain: string): Promise<PeopleSearchDiagnosticTarget | null> {
  const spellings = buildDomainLookupSpellings(domain);
  if (spellings.length === 0) return null;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('contact_enrichment_runs')
    .select('company_name, company_domain, company_country_code, summary, created_at')
    .in('company_domain', spellings)
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (rows.length === 0) return null;
  const withOrg = rows.find((row) => readOrganizationId(row.summary) !== null) ?? rows[0];
  return {
    companyName: String(withOrg.company_name ?? domain),
    companyDomain: spellings[0],
    countryCode: typeof withOrg.company_country_code === 'string' ? withOrg.company_country_code : null,
    organizationId: readOrganizationId(withOrg.summary),
  };
}

export function readOrganizationId(summary: unknown): string | null {
  const enrichment = (summary as { apollo_enrichment?: { apollo_organization_resolution?: { organization_id?: unknown } } } | null)
    ?.apollo_enrichment?.apollo_organization_resolution;
  const id = enrichment?.organization_id;
  return typeof id === 'string' && id.trim().length > 0 ? id.trim() : null;
}
