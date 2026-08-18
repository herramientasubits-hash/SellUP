/**
 * lusha-industry-metadata.ts — la taxonomía de industrias que Lusha declara,
 * capturada del propio proveedor y congelada en el repo.
 *
 * AGENT1-LUSHA-MACRO-V2-PLAN-CATALOG-1 § 3.
 *
 * ── Por qué este fichero existe ───────────────────────────────────────────────
 *
 * El catálogo de planes de búsqueda (`lusha-macro-search-plan.ts`) es una lista
 * de números. Un número equivocado no se ve: `12` y `13` son igual de
 * plausibles a la vista, y el error sólo aparecería como «la macro industria
 * devuelve empresas de otro sector» después de haber gastado créditos.
 *
 * La única defensa que no depende de que alguien revise bien es comparar cada ID
 * contra lo que el proveedor REALMENTE publica. Eso exige tener la lista dentro
 * del repo: una prueba no puede llamar a Lusha (§ 3 lo prohíbe, y una suite que
 * dependiera de la red dejaría de ser determinista).
 *
 * ── Procedencia ───────────────────────────────────────────────────────────────
 *
 * Captura literal de `GET /v3/companies/prospecting/filters/industriesLabels`
 * (2026-08-18), el endpoint de METADATA. Es gratis, y eso está probado y no
 * asumido: `GET /v3/account/usage` leído antes y después devolvió `used` 52127
 * en ambos lados — delta 0 créditos. Sólo avanzaron los contadores de
 * rate-limit.
 *
 * 17 industrias principales (ids 1..19; 2 y 4 no existen) y 132 sub-industrias.
 *
 * ── 🔴 Los IDs son estables; las ETIQUETAS no ─────────────────────────────────
 *
 * La misma captura demostró que el proveedor REESCRIBE etiquetas conservando el
 * id: `Mental Health` → `Mental Health Care`, `Cybersecurity` → `Computer &
 * Network Security Services`, `Telecom` → `Telecommunications`, `E-Learning` →
 * `E-Learning Providers`, `Biotech Research` → `Biotechnology Research
 * Services`. Por eso `label` es EXCLUSIVAMENTE observabilidad: sirve para que un
 * humano lea un diff y entienda qué rama tocó, y para nada más. Ninguna
 * decisión —de mapeo, de routing o de validación— puede leerla.
 *
 * ── 🔴 Lo que esta captura NO puede decir ─────────────────────────────────────
 *
 * La respuesta no trae ningún campo de estado, de vigencia ni de jerarquía más
 * allá del anidamiento. No es posible distinguir una industria retirada de una
 * viva, ni detectar que el proveedor añadió una nueva. Este fichero prueba que
 * un ID EXISTÍA y bajo qué padre el 2026-08-18; no prueba que la lista de hoy
 * siga siendo ésta. Refrescarlo es volver a llamar al endpoint gratuito.
 *
 * Puro: sin env, sin I/O, sin cliente de proveedor, sin DB.
 */

/** Sub-industria declarada por el proveedor. `label` es observabilidad. */
export type LushaSubIndustryMetadata = {
  id: number;
  label: string;
};

/** Industria principal declarada por el proveedor. `label` es observabilidad. */
export type LushaMainIndustryMetadata = {
  id: number;
  label: string;
  subIndustries: readonly LushaSubIndustryMetadata[];
};

/** Fecha de la captura. Cualquier afirmación de este módulo es de ESTE día. */
export const LUSHA_INDUSTRY_METADATA_CAPTURED_AT = '2026-08-18' as const;

/** Endpoint exacto del que salió. Gratuito y de sólo lectura. */
export const LUSHA_INDUSTRY_METADATA_SOURCE =
  'GET /v3/companies/prospecting/filters/industriesLabels' as const;

/**
 * La taxonomía capturada, ordenada por id para que un diff futuro sea legible.
 *
 * Transcrita mecánicamente desde el JSON de la captura, no a mano.
 */
export const LUSHA_INDUSTRY_METADATA: readonly LushaMainIndustryMetadata[] = [
  {
    id: 1,
    label: 'Hospitality',
    subIndustries: [
      { id: 1, label: 'Food & Beverage Services' },
      { id: 2, label: 'Restaurants' },
      { id: 3, label: 'Hotels & Accommodation Services' },
      { id: 5, label: 'Events Services' },
      { id: 11, label: 'Travel & Reservation Services' },
      { id: 778, label: 'Other' },
    ],
  },
  {
    id: 3,
    label: 'Construction',
    subIndustries: [
      { id: 13, label: 'Specialty Trade Contractors' },
      { id: 15, label: 'Building Construction' },
      { id: 16, label: 'Civil Engineering' },
      { id: 791, label: 'Other' },
    ],
  },
  {
    id: 5,
    label: 'Community & Nonprofit Organizations',
    subIndustries: [
      { id: 7, label: 'Fundraising' },
      { id: 18, label: 'Philanthropic Fundraising Services' },
      { id: 20, label: 'Political Organizations' },
      { id: 21, label: 'Civic & Social Organizations' },
      { id: 22, label: 'Religious Institutions' },
      { id: 793, label: 'Other' },
    ],
  },
  {
    id: 6,
    label: 'Education',
    subIndustries: [
      { id: 23, label: 'E-Learning Providers' },
      { id: 24, label: 'Higher Education' },
      { id: 25, label: 'Primary & Secondary Education' },
      { id: 26, label: 'Training' },
      { id: 27, label: 'Preschools & Kindergartens' },
      { id: 50, label: 'Education Administration Programs' },
      { id: 140, label: 'Extracurricular & Enrichment Education' },
      { id: 794, label: 'Other' },
    ],
  },
  {
    id: 7,
    label: 'Entertainment',
    subIndustries: [
      { id: 28, label: 'Entertainment Providers' },
      { id: 29, label: 'Museums, Historical Sites, & Zoos' },
      { id: 30, label: 'Arts & Cultural Creators' },
      { id: 31, label: 'Performing Arts' },
      { id: 32, label: 'Sports' },
      { id: 33, label: 'Recreational Facilities' },
      { id: 34, label: 'Gambling Facilities & Casinos' },
      { id: 35, label: 'Wellness & Fitness Services' },
      { id: 795, label: 'Other' },
    ],
  },
  {
    id: 8,
    label: 'Farming, Ranching, Forestry',
    subIndustries: [
      { id: 36, label: 'Farming, Ranching, Forestry' },
    ],
  },
  {
    id: 9,
    label: 'Finance',
    subIndustries: [
      { id: 37, label: 'Financial Services' },
      { id: 38, label: 'Capital Markets' },
      { id: 40, label: 'Investment' },
      { id: 41, label: 'Venture Capital & Private Equity Principals' },
      { id: 42, label: 'Banking' },
      { id: 43, label: 'International Trade & Development' },
      { id: 44, label: 'Insurance' },
      { id: 92, label: 'Accounting & Services' },
      { id: 797, label: 'Other' },
    ],
  },
  {
    id: 10,
    label: 'Government',
    subIndustries: [
      { id: 45, label: 'Government Administration' },
      { id: 46, label: 'Administration of Justice' },
      { id: 49, label: 'Public Safety' },
      { id: 52, label: 'Housing & Community Development' },
      { id: 56, label: 'Government Executive Offices' },
      { id: 779, label: 'Other' },
    ],
  },
  {
    id: 11,
    label: 'Healthcare',
    subIndustries: [
      { id: 59, label: 'Hospitals & Clinics' },
      { id: 60, label: 'Community & Home Healthcare Services' },
      { id: 62, label: 'Alternative Medicine' },
      { id: 64, label: 'Mental Health Care' },
      { id: 65, label: 'Medical Practices' },
      { id: 66, label: 'Nursing Homes & Residential Care Facilities' },
      { id: 106, label: 'Biotechnology Research Services' },
      { id: 108, label: 'Veterinary Services' },
      { id: 780, label: 'Other' },
    ],
  },
  {
    id: 12,
    label: 'Manufacturing',
    subIndustries: [
      { id: 68, label: 'Computer & Electronics Manufacturing' },
      { id: 69, label: 'Chemicals & Related Products' },
      { id: 70, label: 'Personal Care Products' },
      { id: 71, label: 'Pharmaceuticals Manufacturing' },
      { id: 74, label: 'Semiconductor & Renewable Energy Semiconductor' },
      { id: 75, label: 'Fabricated Metal Products' },
      { id: 76, label: 'Food & Beverage' },
      { id: 77, label: 'Furniture' },
      { id: 78, label: 'Glass, Ceramics, Clay & Concrete' },
      { id: 79, label: 'Industrial Machinery & Equipment' },
      { id: 80, label: 'Medical Equipment' },
      { id: 81, label: 'Paper & Forest Product' },
      { id: 82, label: 'Plastics & Rubber Products' },
      { id: 83, label: 'Sporting Goods Manufacturing' },
      { id: 84, label: 'Textile & Apparel Manufacturing' },
      { id: 86, label: 'Aerospace & Defense' },
      { id: 87, label: 'Motor Vehicles' },
      { id: 89, label: 'Transportation Equipment & Machinery' },
      { id: 781, label: 'Other' },
    ],
  },
  {
    id: 13,
    label: 'Oil, Gas & Mining',
    subIndustries: [
      { id: 90, label: 'Mining' },
      { id: 91, label: 'Oil & Gas' },
      { id: 782, label: 'Other' },
    ],
  },
  {
    id: 14,
    label: 'Business Services',
    subIndustries: [
      { id: 8, label: 'Security & Investigations' },
      { id: 9, label: 'Staffing & Recruiting' },
      { id: 10, label: 'Translation & Localization' },
      { id: 12, label: 'Writing & Editing' },
      { id: 93, label: 'Advertising, Public Relations & Marketing Services' },
      { id: 96, label: 'Architecture & Planning' },
      { id: 97, label: 'Business Consulting & Services' },
      { id: 98, label: 'Environmental Services' },
      { id: 99, label: 'Human Resources Services' },
      { id: 100, label: 'Outsourcing & Offshoring Consulting' },
      { id: 101, label: 'Design Services' },
      { id: 104, label: 'Law Firms & Legal Services' },
      { id: 105, label: 'Photography Services' },
      { id: 783, label: 'Other' },
    ],
  },
  {
    id: 15,
    label: 'Real Estate',
    subIndustries: [
      { id: 6, label: 'Facilities Services' },
      { id: 142, label: 'Property Management' },
      { id: 143, label: 'Real Estate Agencies' },
      { id: 144, label: 'Real Estate Investment and Development' },
      { id: 796, label: 'Other' },
    ],
  },
  {
    id: 16,
    label: 'Retail & Wholesale Trade',
    subIndustries: [
      { id: 110, label: 'Luxury Goods & Jewelry Retail' },
      { id: 111, label: 'Food & Beverage Retail' },
      { id: 113, label: 'Apparel & Fashion Retail' },
      { id: 114, label: 'Home & Office Equipment Retail' },
      { id: 115, label: 'General Merchandise Retail' },
      { id: 138, label: 'Building & Garden Materials' },
      { id: 139, label: 'Wholesale Import & Export' },
      { id: 145, label: 'Health & Personal Care Stores Retail' },
      { id: 146, label: 'Motor Vehicle, Parts Dealers & Tire Stores' },
      { id: 147, label: 'Sport, Music, Books & Hobbies Retail' },
      { id: 785, label: 'Other' },
    ],
  },
  {
    id: 17,
    label: 'Technology, Information & Media',
    subIndustries: [
      { id: 103, label: 'IT Consulting & IT Services' },
      { id: 116, label: 'Book & Newspaper Publishing' },
      { id: 117, label: 'Broadcast Media Production & Distribution' },
      { id: 118, label: 'Movies, Videos & Sound' },
      { id: 119, label: 'Telecommunications' },
      { id: 120, label: 'Digital Information & Data Solutions' },
      { id: 122, label: 'Information Services' },
      { id: 123, label: 'Internet Publishing' },
      { id: 124, label: 'E-Commerce & Marketplace' },
      { id: 126, label: 'Computer & Mobile Games' },
      { id: 128, label: 'Computer & Network Security Services' },
      { id: 129, label: 'Software Development' },
      { id: 148, label: 'Computer Systems Architectural, Design & Services' },
      { id: 786, label: 'Other' },
    ],
  },
  {
    id: 18,
    label: 'Transportation & Logistics',
    subIndustries: [
      { id: 130, label: 'Airlines, Airports & Air Services' },
      { id: 131, label: 'Freight & Package Transportation' },
      { id: 132, label: 'Ground Passenger Transportation' },
      { id: 133, label: 'Maritime Transportation' },
      { id: 134, label: 'Truck Transportation' },
      { id: 135, label: 'Warehousing & Storage' },
      { id: 787, label: 'Other' },
    ],
  },
  {
    id: 19,
    label: 'Utilities',
    subIndustries: [
      { id: 136, label: 'Utilities' },
    ],
  },
] as const;

/** Cuántas industrias principales trajo la captura. */
export const LUSHA_MAIN_INDUSTRY_COUNT = 17;

/** Cuántas sub-industrias trajo la captura, sumando todas las principales. */
export const LUSHA_SUB_INDUSTRY_COUNT = 132;

/** La industria principal con ese id, o `null` si la captura no la trae. */
export function findLushaMainIndustry(
  mainIndustryId: number,
): LushaMainIndustryMetadata | null {
  return (
    LUSHA_INDUSTRY_METADATA.find((main) => main.id === mainIndustryId) ?? null
  );
}

/** ¿El proveedor declaraba esa industria principal? */
export function isKnownLushaMainIndustryId(mainIndustryId: number): boolean {
  return findLushaMainIndustry(mainIndustryId) !== null;
}

/**
 * ¿Esa sub-industria cuelga de ESA industria principal?
 *
 * La pregunta lleva el padre a propósito. Los ids de sub-industria son únicos en
 * todo el vocabulario, así que preguntar sólo «¿existe el 98?» pasaría por alto
 * el error que de verdad importa: colgar `Environmental Services` (98, bajo
 * Business Services) de `Oil, Gas & Mining` (13). Ese par produce un filtro que
 * el proveedor acepta y que no devuelve lo que se pidió.
 */
export function isLushaSubIndustryOfMain(
  mainIndustryId: number,
  subIndustryId: number,
): boolean {
  const main = findLushaMainIndustry(mainIndustryId);
  if (!main) return false;
  return main.subIndustries.some((sub) => sub.id === subIndustryId);
}

/** Etiqueta capturada de una rama, SÓLO para logs y mensajes de test. */
export function describeLushaBranchForObservability(
  mainIndustryId: number,
  subIndustryId: number | null | undefined,
): string {
  const main = findLushaMainIndustry(mainIndustryId);
  const mainLabel = main ? main.label : `unknown_main_${mainIndustryId}`;
  if (subIndustryId === null || subIndustryId === undefined) return mainLabel;
  const sub = main?.subIndustries.find((entry) => entry.id === subIndustryId);
  return `${mainLabel} › ${sub ? sub.label : `unknown_sub_${subIndustryId}`}`;
}
