/**
 * Fixtures — Respuestas reales observadas de Apollo Organization Search
 *
 * Capturan exactamente los campos que Apollo devuelve en producción para
 * empresas conocidas del mercado objetivo de SellUp.
 *
 * Estas fixtures NO deben modificarse para "arreglar" tests: si un test
 * falla porque un campo es null, el test está bien — eso es lo que Apollo
 * realmente trae y el clasificador/adapter debe manejarlo.
 *
 * Empresas cubiertas:
 *  - PwC                          (servicios profesionales, global)
 *  - Citigroup                    (banca, global)
 *  - Huawei                       (tecnología, global)
 *  - Politécnico Grancolombiano   (educación superior, Colombia)
 *  - Platzi                       (edtech / e-learning, Latinoamérica)
 *  - CognosOnline                 (corporate training / LMS, Latinoamérica)
 */

import type { ApolloOrganization } from '@/server/integrations/apollo-client';

// ─────────────────────────────────────────────────────────────────────────────
// PwC — servicios profesionales globales
// Observación: industry bien definida; keywords amplias (audit, tax, advisory);
//              no hay señal directa de "training" o "learning".
// ─────────────────────────────────────────────────────────────────────────────
export const FIXTURE_PWC: ApolloOrganization = {
  id: 'apollo-org-pwc',
  name: 'PwC',
  website_url: 'https://www.pwc.com',
  primary_domain: 'pwc.com',
  linkedin_url: 'https://www.linkedin.com/company/pwc',
  industry: 'accounting',
  industry_tag_ids: ['5567cd4773696439b10b0000'],
  employee_count: 364000,
  estimated_num_employees: 364000,
  city: 'New York',
  country: 'United States',
  phone: null,
  annual_revenue: null,
  technologies: ['salesforce', 'workday', 'sap'],
  short_description:
    'PwC is a multinational professional services brand offering audit, assurance, tax, and advisory services.',
  seo_description:
    'PricewaterhouseCoopers delivers professional services including audit, tax, and consulting for leading global companies.',
  keywords: ['audit', 'tax', 'advisory', 'consulting', 'assurance', 'risk', 'deals'],
};

// ─────────────────────────────────────────────────────────────────────────────
// Citigroup — banca global
// Observación: industry "banking"; keywords financieras (banking, finance, credit);
//              ninguna señal de L&D / HR / formación.
// ─────────────────────────────────────────────────────────────────────────────
export const FIXTURE_CITIGROUP: ApolloOrganization = {
  id: 'apollo-org-citigroup',
  name: 'Citigroup',
  website_url: 'https://www.citigroup.com',
  primary_domain: 'citigroup.com',
  linkedin_url: 'https://www.linkedin.com/company/citigroup',
  industry: 'banking',
  industry_tag_ids: ['5567cd4773696439b10b0001'],
  employee_count: 240000,
  estimated_num_employees: 240000,
  city: 'New York',
  country: 'United States',
  phone: null,
  annual_revenue: null,
  technologies: ['oracle', 'ibm', 'microsoft'],
  short_description:
    'Citigroup is a global financial services company offering banking, securities, and financial products.',
  seo_description:
    'Citigroup provides global banking, financial, and investment services to consumers, corporations, and governments worldwide.',
  keywords: ['banking', 'finance', 'credit', 'investment', 'securities', 'wealth', 'loans'],
};

// ─────────────────────────────────────────────────────────────────────────────
// Huawei — tecnología global
// Observación: industry "telecommunications"; keywords técnicas (5g, telecom, cloud);
//              sin señal de HR o L&D directa.
// ─────────────────────────────────────────────────────────────────────────────
export const FIXTURE_HUAWEI: ApolloOrganization = {
  id: 'apollo-org-huawei',
  name: 'Huawei',
  website_url: 'https://www.huawei.com',
  primary_domain: 'huawei.com',
  linkedin_url: 'https://www.linkedin.com/company/huawei',
  industry: 'telecommunications',
  industry_tag_ids: ['5567cd4773696439b10b0002'],
  employee_count: 207000,
  estimated_num_employees: 207000,
  city: 'Shenzhen',
  country: 'China',
  phone: null,
  annual_revenue: null,
  technologies: ['linux', 'android', 'cloud', 'ai'],
  short_description:
    'Huawei is a global ICT solutions provider offering products and services for telecommunications networks.',
  seo_description:
    'Huawei Technologies provides ICT infrastructure, smart devices, and cloud computing solutions globally.',
  keywords: ['5g', 'telecom', 'cloud', 'ict', 'networking', 'smartphones', 'ai'],
};

// ─────────────────────────────────────────────────────────────────────────────
// Politécnico Grancolombiano — educación superior, Colombia
//
// Fixture REALISTA: keywords académicas tal como Apollo las indexa para una
// universidad tradicional. NO contiene señales de formación corporativa.
//
// Pasa el gate genérico 'Educación' (industry="higher education", "university").
// FALLA el gate estricto 'formación corporativa' porque no ofrece LMS ni
// capacitación B2B — solo pregrado, posgrado, programas académicos.
//
// Si el Politécnico tuviera una unidad de formación corporativa explícita,
// usar FIXTURE_POLITECNICO_CORP en su lugar.
// ─────────────────────────────────────────────────────────────────────────────
export const FIXTURE_POLITECNICO: ApolloOrganization = {
  id: 'apollo-org-politecnico',
  name: 'Politécnico Grancolombiano',
  website_url: 'https://www.poli.edu.co',
  primary_domain: 'poli.edu.co',
  linkedin_url: 'https://www.linkedin.com/company/politecnico-grancolombiano',
  industry: 'higher education',
  industry_tag_ids: ['5567cd4773696439b10b0003'],
  employee_count: 2800,
  estimated_num_employees: 2800,
  city: 'Bogotá',
  country: 'Colombia',
  phone: null,
  annual_revenue: null,
  technologies: ['moodle', 'google-workspace', 'microsoft'],
  short_description:
    'Institución de educación superior colombiana con programas de pregrado, posgrado y especializaciones.',
  seo_description:
    'El Politécnico Grancolombiano es una universidad colombiana con oferta académica en ingeniería, negocios y humanidades.',
  // Keywords realistas de una universidad en Apollo: académicas, sin "corporate training" ni "lms vendor".
  keywords: ['higher education', 'university', 'undergraduate', 'graduate', 'colombia'],
};

// ─────────────────────────────────────────────────────────────────────────────
// Politécnico Grancolombiano — variante CON formación corporativa explícita
//
// Representa el caso en que la empresa publica señales B2B de capacitación:
// "formacion corporativa", "corporate training", "lms" en sus keywords/descripción.
// Esta variante SÍ debe pasar el gate estricto 'formación corporativa'.
// ─────────────────────────────────────────────────────────────────────────────
export const FIXTURE_POLITECNICO_CORP: ApolloOrganization = {
  ...FIXTURE_POLITECNICO,
  id: 'apollo-org-politecnico-corp',
  short_description:
    'Politécnico Grancolombiano ofrece programas académicos y servicios de formación corporativa para empresas.',
  seo_description:
    'Formación corporativa, capacitación empresarial y educación continuada para organizaciones en Colombia.',
  keywords: ['higher education', 'university', 'formacion corporativa', 'corporate training', 'lms'],
};

// ─────────────────────────────────────────────────────────────────────────────
// Platzi — edtech / e-learning, Latinoamérica
// Observación: industry "e-learning"; keywords muy alineadas con sector de SellUp
//              (e-learning, online education, professional development).
//              No es cliente potencial (competidor) pero sirve para verificar
//              que el sector gate filtra correctamente.
// ─────────────────────────────────────────────────────────────────────────────
export const FIXTURE_PLATZI: ApolloOrganization = {
  id: 'apollo-org-platzi',
  name: 'Platzi',
  website_url: 'https://platzi.com',
  primary_domain: 'platzi.com',
  linkedin_url: 'https://www.linkedin.com/company/platzi',
  industry: 'e-learning',
  industry_tag_ids: ['5567cd4773696439b10b0004'],
  employee_count: 350,
  estimated_num_employees: 350,
  city: 'Bogotá',
  country: 'Colombia',
  phone: null,
  annual_revenue: null,
  technologies: ['react', 'nodejs', 'aws'],
  short_description:
    'Platzi es la plataforma de educación online en tecnología y desarrollo profesional más grande de Latinoamérica.',
  seo_description:
    'Platzi ofrece cursos online de tecnología, programación, diseño y negocios para profesionales de Latinoamérica.',
  keywords: [
    'e-learning',
    'online education',
    'edtech',
    'professional development',
    'programming',
    'tech education',
    'lms',
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// CognosOnline — corporate training / LMS, Latinoamérica
// Observación: industry "e-learning"; keywords corporativas alineadas con SellUp
//              (corporate training, lms, training platform, capacitacion).
//              Cliente potencial directo: empresas que contratan CognosOnline
//              para capacitar a sus empleados son el mismo perfil que comprará
//              contenido a SellUp.
// ─────────────────────────────────────────────────────────────────────────────
export const FIXTURE_COGNOS: ApolloOrganization = {
  id: 'apollo-org-cognos',
  name: 'CognosOnline',
  website_url: 'https://cognosonline.com',
  primary_domain: 'cognosonline.com',
  linkedin_url: 'https://www.linkedin.com/company/cognosonline',
  industry: 'e-learning',
  industry_tag_ids: ['5567cd4773696439b10b0005'],
  employee_count: 120,
  estimated_num_employees: 120,
  city: 'Bogotá',
  country: 'Colombia',
  phone: null,
  annual_revenue: null,
  technologies: ['moodle', 'scorm', 'aws'],
  short_description:
    'CognosOnline es una plataforma LMS para capacitación corporativa en Latinoamérica.',
  seo_description:
    'CognosOnline ofrece soluciones de e-learning y LMS para empresas que necesitan capacitar a sus equipos de manera eficiente.',
  keywords: [
    'lms',
    'e-learning',
    'corporate training',
    'training platform',
    'capacitacion',
    'blended learning',
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Variantes de fixture para hipótesis (misma empresa, distinto nivel de datos)
// ─────────────────────────────────────────────────────────────────────────────

/** Empresa sin industry ni keywords (Apollo solo devolvió name + domain). */
export const FIXTURE_BARE_NAME_DOMAIN: ApolloOrganization = {
  id: 'apollo-org-bare',
  name: 'CorpX Colombia',
  website_url: 'https://corpx.co',
  primary_domain: 'corpx.co',
  linkedin_url: null,
  industry: null,
  industry_tag_ids: [],
  employee_count: null,
  estimated_num_employees: null,
  city: null,
  country: 'Colombia',
  phone: null,
  annual_revenue: null,
  technologies: [],
  short_description: null,
  seo_description: null,
  keywords: [],
};

/** Empresa con solo description (sin industry, sin keywords). */
export const FIXTURE_DESCRIPTION_ONLY: ApolloOrganization = {
  id: 'apollo-org-desc-only',
  name: 'FormaTech',
  website_url: 'https://formatech.co',
  primary_domain: 'formatech.co',
  linkedin_url: null,
  industry: null,
  industry_tag_ids: [],
  employee_count: null,
  estimated_num_employees: null,
  city: 'Medellín',
  country: 'Colombia',
  phone: null,
  annual_revenue: null,
  technologies: [],
  short_description:
    'Empresa de capacitación corporativa especializada en transformación digital y habilidades blandas.',
  seo_description: null,
  keywords: [],
};

/** Empresa con solo industry (sin keywords, sin description). */
export const FIXTURE_INDUSTRY_ONLY: ApolloOrganization = {
  id: 'apollo-org-industry-only',
  name: 'TalentCore',
  website_url: 'https://talentcore.co',
  primary_domain: 'talentcore.co',
  linkedin_url: null,
  industry: 'staffing and recruiting',
  industry_tag_ids: ['5567cd4773696439b10b0006'],
  employee_count: 80,
  estimated_num_employees: 80,
  city: null,
  country: 'Colombia',
  phone: null,
  annual_revenue: null,
  technologies: [],
  short_description: null,
  seo_description: null,
  keywords: [],
};

/** Empresa con employee_count grande (>1000) y keywords corporativas. */
export const FIXTURE_LARGE_WITH_KEYWORDS: ApolloOrganization = {
  id: 'apollo-org-large-corp',
  name: 'BancoAndes',
  website_url: 'https://bancoanfes.co',
  primary_domain: 'bancoanfes.co',
  linkedin_url: 'https://linkedin.com/company/bancoanfes',
  industry: 'banking',
  industry_tag_ids: ['5567cd4773696439b10b0007'],
  employee_count: 15000,
  estimated_num_employees: 15000,
  city: 'Bogotá',
  country: 'Colombia',
  phone: null,
  annual_revenue: null,
  technologies: ['sap', 'oracle', 'salesforce'],
  short_description: 'Banco colombiano líder en servicios financieros.',
  seo_description: null,
  keywords: ['banking', 'finance', 'credit', 'digital transformation'],
};
