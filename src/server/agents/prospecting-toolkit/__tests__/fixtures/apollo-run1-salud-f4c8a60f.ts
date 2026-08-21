/**
 * Fixture — RUN 1 Salud, lote `f4c8a60f-43fe-411a-896e-4a19bd06505d`.
 *
 * AGENT1-APOLLO-SECTOR-EVIDENCE-BOOTSTRAP-1 · § 9.
 *
 * Los VEINTE resultados reales de la única corrida live de Salud (2026-08-12,
 * `wizard_run 0e87d5c46212b330a7835f50c9e94c86`, SHA de producción `5b888b69`),
 * exportados READ-ONLY de
 * `prospect_batches.metadata->apollo_two_round_checkpoint->candidate_snapshots`.
 *
 * El hecho que hace falta reproducir, y que estos veinte demuestran:
 * `mixed_companies/search` los devolvió TODOS sin un solo campo clasificatorio —
 * `industry`, `industries`, `keywords`, `organization_keywords`, las tres
 * descripciones y `employee_count` son nulos o vacíos en los veinte—. Por eso la
 * ausencia se declara UNA vez en el constructor y no veinte veces en la tabla: no
 * es una simplificación del fixture, es el dato.
 *
 * Gasto de la corrida: 2 búsquedas, 20 créditos, 0 enrichments, 0 candidatos
 * persistidos. NO se vuelve a ejecutar nada contra el proveedor: este fixture
 * existe precisamente para no tener que hacerlo.
 */

import type { ApolloTwoRoundCandidateEvidenceSnapshot } from '../../apollo-two-round/checkpoint';

/** Lo que la corrida decidió para cada resultado, para comparar contra el nuevo contrato. */
export type Run1SaludSnapshot = {
  candidateKey: string;
  roundNumber: number;
  providerRank: number;
  /** Motivo terminal REAL de la corrida live. */
  rejectionReason: string;
  /** Veredicto sectorial REAL de la corrida live. */
  sectorEvidenceState: string;
  evidence: ApolloTwoRoundCandidateEvidenceSnapshot;
};

type Row = {
  key: string;
  round: number;
  rank: number;
  title: string;
  domain: string;
  url: string;
  city: string | null;
  linkedin: string;
  rejection: string;
};

/**
 * Constructor de la evidencia. Fija en null/vacío todo campo clasificatorio
 * porque así llegaron los veinte: es la premisa del hito, no una comodidad.
 */
function evidenceOf(row: Row): ApolloTwoRoundCandidateEvidenceSnapshot {
  const location = [row.city ? `Ciudad: ${row.city}` : null, 'País: Colombia']
    .filter((part): part is string => part !== null)
    .join(' | ');
  return {
    title: row.title,
    url: row.url,
    snippet: `Empresa: ${row.title} | ${location} | [Fuente: Apollo Organizations]`,
    rank: row.rank,
    source: 'apollo_organizations',
    origin_query: null,
    provider_organization_id: row.key.replace(/^apollo:/, ''),
    domain: row.domain,
    linkedin_url: row.linkedin,
    industry: null,
    industries: [],
    keywords: [],
    organization_keywords: [],
    short_description: null,
    seo_description: null,
    description: null,
    city: row.city,
    country: 'Colombia',
    country_code: null,
    employee_count: null,
    enrichment_fields_added: [],
  };
}

const ROWS: readonly Row[] = [
  { key: 'apollo:5f488a7e901b45008c12d237', round: 1, rank: 1, title: 'PwC Colombia', domain: 'pwc.com', url: 'http://www.pwc.com', city: null, linkedin: 'http://www.linkedin.com/company/pwc', rejection: 'sector_not_mapped' },
  { key: 'apollo:55f6c3bcf3e5bb193f0178d7', round: 1, rank: 2, title: 'AstraZeneca', domain: 'astrazeneca.com', url: 'http://www.astrazeneca.com', city: null, linkedin: 'http://www.linkedin.com/company/astrazeneca', rejection: 'sector_not_mapped' },
  { key: 'apollo:5ed1f86c3e1db70001f9d71e', round: 1, rank: 3, title: 'Novo Nordisk', domain: 'novonordisk.com', url: 'http://www.novonordisk.com', city: 'Bogota', linkedin: 'http://www.linkedin.com/company/novo-nordisk', rejection: 'sector_not_mapped' },
  { key: 'apollo:5e56ea366950520001a188bc', round: 1, rank: 4, title: 'Huawei Technologies Co., Ltd', domain: 'huawei.com', url: 'http://www.huawei.com', city: null, linkedin: 'http://www.linkedin.com/company/huawei', rejection: 'sector_not_mapped' },
  { key: 'apollo:5f44e44ff0e10700016835e8', round: 1, rank: 5, title: 'Philip Morris International', domain: 'pmi.com', url: 'http://www.pmi.com', city: null, linkedin: 'http://www.linkedin.com/company/insidepmi', rejection: 'sector_not_mapped' },
  { key: 'apollo:54a1233869702d8ed4ee5703', round: 1, rank: 6, title: 'DELOITTE & TOUCHE COLOMBIA', domain: 'deloitte.com', url: 'http://www.deloitte.com', city: 'Tunja', linkedin: 'http://www.linkedin.com/company/deloitte', rejection: 'sector_not_mapped' },
  { key: 'apollo:5f472d17465466000112c98f', round: 1, rank: 7, title: 'Chubb Seguros Colombia', domain: 'chubb.com', url: 'http://www.chubb.com', city: null, linkedin: 'http://www.linkedin.com/company/chubb', rejection: 'sector_not_mapped' },
  { key: 'apollo:54a12a0f69702d9548a1dd01', round: 1, rank: 8, title: 'KUEHNE + NAGEL COLOMB', domain: 'kuehne-nagel.com', url: 'http://www.kuehne-nagel.com', city: null, linkedin: 'http://www.linkedin.com/company/kuehne-nagel', rejection: 'sector_not_mapped' },
  { key: 'apollo:54a1b8507468695860c70d0b', round: 1, rank: 9, title: 'Postobón S.A', domain: 'postobon.com', url: 'http://www.postobon.com', city: 'Medellin', linkedin: 'http://www.linkedin.com/company/postobon-s.a.', rejection: 'sector_not_mapped' },
  { key: 'apollo:559213d97369644785e53300', round: 1, rank: 10, title: 'Coomeva Sector Financiero', domain: 'coomeva.com.co', url: 'http://www.coomeva.com.co', city: 'Cali', linkedin: 'http://www.linkedin.com/company/coomeva', rejection: 'sector_not_mapped' },
  { key: 'apollo:5f4671a076f4b70001946b37', round: 2, rank: 1, title: 'BRITISH AMERICAN TOBACCO', domain: 'bat.com', url: 'http://www.bat.com', city: 'Rondon, Boyaca', linkedin: 'http://www.linkedin.com/company/british-american-tobacco', rejection: 'sector_not_mapped' },
  { key: 'apollo:54a12b1169702da2209e5f02', round: 2, rank: 2, title: 'Alpina', domain: 'alpina.com', url: 'http://www.alpina.com', city: 'Sopo', linkedin: 'http://www.linkedin.com/company/alpina', rejection: 'cooldown_or_prior_suggestion' },
  { key: 'apollo:5da6101046467d0001aa0296', round: 2, rank: 3, title: 'Colombina', domain: 'colombina.com', url: 'http://www.colombina.com', city: 'Cali', linkedin: 'http://www.linkedin.com/company/colombina-s-a', rejection: 'sector_not_mapped' },
  { key: 'apollo:5f2a39cb77a7440112460cf5', round: 2, rank: 4, title: 'Amazon Costa Rica', domain: 'amazon.com', url: 'http://www.amazon.com', city: 'Costa Rica', linkedin: 'http://www.linkedin.com/company/amazon', rejection: 'external_platform_domain' },
  { key: 'apollo:5b159c3da6da987143b08cff', round: 2, rank: 5, title: 'AJE Group', domain: 'ajegroup.com', url: 'http://www.ajegroup.com', city: 'Sabana de Torres', linkedin: 'http://www.linkedin.com/company/ajeglobal', rejection: 'sector_not_mapped' },
  { key: 'apollo:5592238973696418bca48d00', round: 2, rank: 6, title: 'Cruz Verde', domain: 'cruzverde.com.co', url: 'http://www.cruzverde.com.co', city: 'Bogota', linkedin: 'http://www.linkedin.com/company/droguerias-cruz-verde-colombia', rejection: 'sector_not_mapped' },
  { key: 'apollo:55698f0c7369642598a15700', round: 2, rank: 7, title: 'Grupo Gloria', domain: 'gloria.com.pe', url: 'http://www.gloria.com.pe', city: null, linkedin: 'http://www.linkedin.com/company/gloria-peru', rejection: 'country_incompatible' },
  { key: 'apollo:5592113d73696418a5784d00', round: 2, rank: 8, title: 'Cushman & Wakefield plc', domain: 'cushmanwakefield.com', url: 'http://www.cushmanwakefield.com', city: 'Rondón, Boyacá', linkedin: 'http://www.linkedin.com/company/cushman-&-wakefield', rejection: 'sector_not_mapped' },
  { key: 'apollo:54a1290469702dcef9d25b01', round: 2, rank: 9, title: 'Colsubsidio', domain: 'colsubsidio.com', url: 'http://www.colsubsidio.com', city: 'Bogota', linkedin: 'http://www.linkedin.com/company/colsubsidio', rejection: 'sector_not_mapped' },
  { key: 'apollo:5f4a27ddd2ebba00013a3201', round: 2, rank: 10, title: 'Davivienda', domain: 'davivienda.com', url: 'http://www.davivienda.com', city: 'Bogota', linkedin: 'http://www.linkedin.com/company/davivienda', rejection: 'sector_not_mapped' },
];

/** Los 20 resultados de RUN 1, en el orden en que el proveedor los devolvió. */
export const RUN1_SALUD_SNAPSHOTS: readonly Run1SaludSnapshot[] = ROWS.map((row) => ({
  candidateKey: row.key,
  roundNumber: row.round,
  providerRank: row.rank,
  rejectionReason: row.rejection,
  // Los veinte llevaron el mismo veredicto sectorial en la corrida live.
  sectorEvidenceState: 'sector_not_mapped',
  evidence: evidenceOf(row),
}));

/** Criterios EXACTOS de la corrida, tal como el wizard los envió. */
export const RUN1_SALUD_REQUEST = {
  batchId: 'f4c8a60f-43fe-411a-896e-4a19bd06505d',
  country: 'Colombia',
  countryCode: 'CO',
  industry: 'Salud',
  subindustries: [
    'Redes Hospitalarias y Clínicas',
    'Laboratorios Clínicos y Diagnóstico',
    'Medicina Prepagada y EPS',
  ],
} as const;

/**
 * Estado de corrida que NO vive en el resultado del proveedor: el cooldown que
 * la memoria negativa tenía activo sobre `alpina.com` cuando la corrida se
 * ejecutó.
 *
 * Sin él, un replay en frío evalúa 18 candidatos contra el veredicto sectorial y
 * la corrida evaluó 17 — la diferencia no es del contrato, es de este dominio.
 */
export const RUN1_SALUD_COOLDOWN_DOMAINS: ReadonlySet<string> = new Set(['alpina.com']);

/** Desenlace REAL de la corrida, para que el replay compare contra hechos. */
export const RUN1_SALUD_LIVE_OUTCOME = {
  searchCalls: 2,
  creditsSpent: 20,
  enrichmentsExecuted: 0,
  candidatesPersisted: 0,
  sectorNotMappedRejections: 17,
} as const;
