// AGENT2-APOLLO-ACCOUNTS-VS-ORGANIZATIONS-1 — identificar la empresa sin confundir cuentas con empresas
//
// `mixed_companies/search` devuelve dos listas: `organizations` (la base de Apollo) y `accounts`
// (las cuentas guardadas en NUESTRO espacio de Apollo, p. ej. las sincronizadas desde HubSpot).
// `searchApolloOrganizations` hacía `accounts ?? organizations`: con `accounts: []` perdía las
// empresas reales, y con cuentas usaba `accounts[*].id` —el id del registro del espacio— como si
// fuera el de la empresa. Buscar personas con ese id da 0 siempre. Así quedaron «Davivienda
// Colombia», «La boliviana Ciacruz» y «elangel.co.cr» (nombres escritos por nosotros, no por
// Apollo) en el Agente 2 hasta el 20-10.
//
// El Agente 1 ya había cerrado este mismo defecto en su normalizador moderno: aquí se reutiliza.
// `searchApolloOrganizations` no se toca porque la usan rutas del Agente 1.

import {
  searchApolloOrganizationsPage,
  type ApolloOrganization,
  type ApolloSearchResult,
  type SearchOrganizationsParams,
} from '@/server/integrations/apollo-client';
import {
  normalizeApolloOrganizationsResponse,
  type ApolloOrganizationsRawPayload,
  type NormalizedApolloOrganization,
} from '../prospecting-toolkit/apollo-organizations-response-normalizer';

export interface OrgSearchForPeopleResult extends ApolloSearchResult<ApolloOrganization> {
  /**
   * Entradas crudas de la página (`organizations` + `accounts`). Apollo cobra 1 crédito por página
   * con CUALQUIER resultado, aunque sólo traiga cuentas sin empresa: el conteo de créditos usa
   * esto, no la lista ya depurada.
   */
  rawEntries: number;
}

function toOrganization(org: NormalizedApolloOrganization): ApolloOrganization {
  return {
    id: org.providerReference.providerOrganizationId,
    name: org.name,
    website_url: org.websiteUrl ?? (org.primaryDomain ? `http://${org.primaryDomain}` : null),
    primary_domain: org.primaryDomain,
    all_domains: org.normalizedDomains,
    linkedin_url: org.linkedinUrl,
    industry: org.industry,
    industry_tag_ids: [],
    employee_count: org.estimatedNumEmployees,
    estimated_num_employees: org.estimatedNumEmployees,
    city: org.city,
    country: org.country,
    phone: org.phone,
    annual_revenue: null,
    technologies: org.technologies,
    short_description: org.shortDescription,
    keywords: org.keywords,
  };
}

/** Puro: payload crudo de la página → empresas reales (id de organización) + entradas crudas. */
export function organizationsForPeopleSearch(payload: unknown): { organizations: ApolloOrganization[]; rawEntries: number } {
  const raw: NonNullable<ApolloOrganizationsRawPayload> = (payload ?? {}) as NonNullable<ApolloOrganizationsRawPayload>;
  const rawEntries =
    (Array.isArray(raw.organizations) ? raw.organizations.length : 0) + (Array.isArray(raw.accounts) ? raw.accounts.length : 0);
  const organizations = normalizeApolloOrganizationsResponse(raw).organizations.map(toOrganization);
  // El normalizador del Agente 1 descarta, por contrato de DESCUBRIMIENTO, una cuenta cuya empresa
  // no vino en `organizations`. Para identificar una empresa ya elegida sí sirve: su
  // organization_id apunta a la empresa real de Apollo. Nunca se usa el id de la cuenta.
  const seen = new Set(organizations.map((o) => o.id));
  for (const account of Array.isArray(raw.accounts) ? raw.accounts : []) {
    const organizationId = typeof account?.organization_id === 'string' ? account.organization_id.trim() : '';
    if (!organizationId || seen.has(organizationId)) continue;
    seen.add(organizationId);
    const domain = typeof account.primary_domain === 'string' ? account.primary_domain : null;
    organizations.push({
      id: organizationId,
      name: typeof account.name === 'string' ? account.name : null,
      website_url: typeof account.website_url === 'string' ? account.website_url : domain ? `http://${domain}` : null,
      primary_domain: domain,
      linkedin_url: null,
      industry: null,
      industry_tag_ids: [],
      employee_count: null,
      estimated_num_employees: null,
      city: null,
      country: null,
      phone: null,
      annual_revenue: null,
      technologies: [],
      short_description: null,
      keywords: [],
    });
  }
  return { organizations, rawEntries };
}

export async function searchApolloOrganizationsForPeople(params: SearchOrganizationsParams): Promise<OrgSearchForPeopleResult> {
  const page = await searchApolloOrganizationsPage({ ...params, page: 1 } as Record<string, unknown>);
  if (!page.ok || page.malformedBody) {
    return {
      success: false,
      rawEntries: 0,
      error: {
        error: page.status ? `HTTP_${page.status}` : 'NETWORK',
        message: page.errorBody ?? 'Error en búsqueda de empresas',
        statusCode: page.status ?? 0,
      },
    };
  }
  const { organizations, rawEntries } = organizationsForPeopleSearch(page.payload);
  return { success: true, data: organizations, rawEntries };
}
