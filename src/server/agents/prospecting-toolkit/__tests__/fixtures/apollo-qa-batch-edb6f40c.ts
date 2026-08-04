/**
 * apollo-qa-batch-edb6f40c.ts — La corrida QA real, congelada como fixture.
 *
 * A1-APOLLO-TWO-ROUND-QUERY-QUALITY-2 · § 11.
 *
 *   batch_id      = edb6f40c-1c6a-4d70-8347-47efd4454b1c
 *   wizard_run_id = 0b7daa3246d5ada9042f80c10708c2be
 *   rondas        = 2 · raw por ronda = 3 · únicas = 3 · elegibles = 0
 *   enrichments   = 1 (Citigroup) · créditos registrados = 7
 *
 * Selección del usuario: Retail y Consumo → Supermercados e Hipermercados, en
 * Colombia. Apollo recibió `retail, commerce, ecommerce, retail chain, comercio`
 * y devolvió LO MISMO en las dos rondas.
 *
 * Este archivo NO llama a Apollo ni lee entorno: es la respuesta observada,
 * escrita a mano y sanitizada. Ninguna prueba que lo use gasta un crédito.
 */

import type { WebSearchResult } from '../../types';

// ─── Selección del wizard ─────────────────────────────────────────────────────

export const QA_BATCH_ID = 'edb6f40c-1c6a-4d70-8347-47efd4454b1c';
export const QA_WIZARD_RUN_ID = '0b7daa3246d5ada9042f80c10708c2be';

export const QA_WIZARD_SELECTION = {
  country: 'Colombia',
  countryCode: 'CO',
  industry: 'Retail y Consumo',
  subindustries: ['Supermercados e Hipermercados'],
  additionalCriteriaTokens: [] as string[],
} as const;

/**
 * Los términos que la corrida QA envió realmente. Es el defecto, no el objetivo:
 * ninguna de estas cinco palabras distingue un supermercado de un banco minorista.
 */
export const QA_OBSERVED_KEYWORD_TAGS: readonly string[] = [
  'retail',
  'commerce',
  'ecommerce',
  'retail chain',
  'comercio',
];

// ─── Resultados observados ────────────────────────────────────────────────────

type QaOrganization = {
  rank: number;
  organizationId: string;
  name: string;
  domain: string;
  industry: string;
  industries: string[];
  keywords: string[];
  employeeCount: number | null;
  city: string | null;
  country: string | null;
  linkedinUrl: string | null;
};

/**
 * Las tres organizaciones que Apollo devolvió, en las DOS rondas, en el mismo
 * orden. `google.com` llega por `gmail.com.co`: un dominio de correo que el gate
 * de dominio ya conoce.
 */
export const QA_OBSERVED_ORGANIZATIONS: readonly QaOrganization[] = [
  {
    rank: 1,
    organizationId: '5f2a1b3c4d5e6f7a8b9c0d11',
    name: 'Falabella Retail Colombia',
    domain: 'falabella.com.pe',
    industry: 'retail',
    industries: ['retail', 'department stores'],
    keywords: ['retail', 'department store', 'ecommerce'],
    employeeCount: 12000,
    city: 'Lima',
    country: 'Peru',
    linkedinUrl: 'https://www.linkedin.com/company/falabella',
  },
  {
    rank: 2,
    organizationId: '5f2a1b3c4d5e6f7a8b9c0d22',
    name: 'Citigroup',
    domain: 'citi.com',
    industry: 'retail banking',
    industries: ['retail banking', 'financial services', 'investment banking'],
    keywords: ['banking', 'credit cards', 'wealth management'],
    employeeCount: 240000,
    city: 'New York',
    country: 'United States',
    linkedinUrl: 'https://www.linkedin.com/company/citi',
  },
  {
    rank: 3,
    organizationId: '5f2a1b3c4d5e6f7a8b9c0d33',
    name: 'gmail.com.co',
    domain: 'google.com',
    industry: 'internet',
    industries: ['internet', 'software'],
    keywords: ['search engine', 'advertising'],
    employeeCount: 180000,
    city: 'Mountain View',
    country: 'United States',
    linkedinUrl: 'https://www.linkedin.com/company/google',
  },
];

/** Proyecta una organización observada al contrato `WebSearchResult` del pipeline. */
export function toQaSearchResult(organization: QaOrganization): WebSearchResult {
  return {
    title: organization.name,
    url: `https://${organization.domain}`,
    snippet:
      `Empresa: ${organization.name} | Industria: ${organization.industry} | ` +
      `Keywords: ${organization.keywords.join(', ')} [Fuente: Apollo Organizations]`,
    rank: organization.rank,
    provider: 'apollo_organizations',
    metadata: {
      apollo_organization_id: organization.organizationId,
      domain: organization.domain,
      industry: organization.industry,
      industries: organization.industries,
      keywords: organization.keywords,
      employee_count: organization.employeeCount,
      city: organization.city,
      country: organization.country,
      linkedin_url: organization.linkedinUrl,
      apollo_profile: {
        organization_id: organization.organizationId,
        primary_domain: organization.domain,
        industry: organization.industry,
        industries: organization.industries,
        keywords: organization.keywords,
        organization_keywords: organization.keywords,
        estimated_num_employees: organization.employeeCount,
        city: organization.city,
        country: organization.country,
        linkedin_url: organization.linkedinUrl,
      },
    },
  };
}

export function qaSearchResults(): WebSearchResult[] {
  return QA_OBSERVED_ORGANIZATIONS.map(toQaSearchResult);
}

// ─── Supermercados reales, para el camino feliz ───────────────────────────────

/**
 * Cinco supermercados colombianos plausibles, sanitizados: son el contrafactual
 * del § 11 — con la consulta correcta, el objetivo de cinco es alcanzable en dos
 * rondas.
 */
export const QA_SUPERMARKET_ORGANIZATIONS: readonly QaOrganization[] = [
  {
    rank: 1,
    organizationId: '6a1b2c3d4e5f60718293a401',
    name: 'Cadena de Supermercados Andina',
    domain: 'supermercadosandina.com.co',
    industry: 'supermarkets',
    industries: ['supermarkets', 'food retail'],
    keywords: ['supermercado', 'grocery', 'food retail'],
    employeeCount: 4200,
    city: 'Bogotá',
    country: 'Colombia',
    linkedinUrl: 'https://www.linkedin.com/company/supermercados-andina',
  },
  {
    rank: 2,
    organizationId: '6a1b2c3d4e5f60718293a402',
    name: 'Hipermercados del Caribe',
    domain: 'hipercaribe.com.co',
    industry: 'hypermarkets',
    industries: ['hypermarkets', 'grocery'],
    keywords: ['hipermercado', 'grocery store'],
    employeeCount: 2600,
    city: 'Barranquilla',
    country: 'Colombia',
    linkedinUrl: 'https://www.linkedin.com/company/hipercaribe',
  },
  {
    rank: 3,
    organizationId: '6a1b2c3d4e5f60718293a403',
    name: 'Autoservicios del Valle',
    domain: 'autoserviciosdelvalle.com.co',
    industry: 'grocery stores',
    industries: ['grocery stores'],
    keywords: ['autoservicio', 'supermercado'],
    employeeCount: 900,
    city: 'Cali',
    country: 'Colombia',
    linkedinUrl: 'https://www.linkedin.com/company/autoservicios-del-valle',
  },
  {
    rank: 1,
    organizationId: '6a1b2c3d4e5f60718293a404',
    name: 'Mercados Cafeteros',
    domain: 'mercadoscafeteros.com.co',
    industry: 'food retail',
    industries: ['food retail', 'supermarkets'],
    keywords: ['supermercado', 'cadena de supermercados'],
    employeeCount: 1500,
    city: 'Pereira',
    country: 'Colombia',
    linkedinUrl: 'https://www.linkedin.com/company/mercados-cafeteros',
  },
  {
    rank: 2,
    organizationId: '6a1b2c3d4e5f60718293a405',
    name: 'Almacenes de Cadena Oriente',
    domain: 'cadenaoriente.com.co',
    industry: 'supermarkets',
    industries: ['supermarkets'],
    keywords: ['almacen de cadena', 'grocery chain'],
    employeeCount: 3100,
    city: 'Bucaramanga',
    country: 'Colombia',
    linkedinUrl: 'https://www.linkedin.com/company/cadena-oriente',
  },
];
