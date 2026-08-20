/**
 * country-source-types.ts — el contrato NEUTRAL de una fuente de país gratuita.
 *
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 3, 5, 6, 7, 12.
 *
 * Una fuente de país expone dos cosas y nada más: qué empresas devuelve para unos
 * criterios, y qué evidencia declarada trae cada una. Quién decide si esa
 * evidencia prueba pertenencia NO es la fuente — es el evaluador canónico.
 *
 * Puro: sin env, sin I/O, sin DB, sin reloj.
 */

/**
 * Una empresa tal y como la fuente oficial la declara.
 *
 * 🔴 `website`/`domain` no aparecen a propósito en las fuentes colombianas
 * cableadas hoy: ni el snapshot co_siis ni el RUES publican web. § 22(I) es
 * explícito —una empresa sin web se evalúa por identidad legal y NO se le fabrica
 * un dominio— así que el campo es opcional y su ausencia es un estado legítimo,
 * no un dato que falte por rellenar.
 */
export type CountrySourceCompany = {
  /** Identidad estable del registro dentro de la fuente. */
  recordIdentityKey: string;
  legalName: string | null;
  normalizedLegalName: string | null;
  taxId: string | null;
  taxIdentifierType: 'NIT' | 'RFC' | 'RUT' | 'RUC' | 'CUIT' | 'CNPJ' | 'RNC' | 'RTN' | 'cedula_juridica' | 'other' | null;
  countryCode: string;
  city: string | null;
  region: string | null;
  /** Dominio si la fuente lo publica. Casi siempre `null` en registros oficiales. */
  domain: string | null;
  /**
   * Industria DECLARADA por la fuente, en texto. Es lo único con carga
   * clasificatoria que llega al evaluador canónico.
   */
  declaredIndustry: string | null;
  /** Código de la clasificación oficial (CIIU en Colombia). Trazabilidad. */
  industryCode: string | null;
  /**
   * Sector grueso que la fuente publica (`MACROSECTOR` en co_siis: COMERCIO,
   * SERVICIOS, MANUFACTURA…).
   *
   * 🔴 NO es evidencia y NUNCA viaja al evaluador. Seis cubetas no pueden
   * demostrar pertenencia a doce macro industrias, y admitirlo repetiría
   * literalmente el defecto de #306: cinco empresas de «Manufacturing genérico»
   * confirmadas con 100 de score en una búsqueda de salud. Se conserva sólo como
   * metadato de trazabilidad.
   */
  coarseSector: string | null;
};

/** Lo que una fuente de país devuelve para unos criterios. */
export type CountrySourceDiscoveryResult = {
  sourceKey: string;
  companies: readonly CountrySourceCompany[];
  /** Cuántos registros leyó la fuente antes de recortar al límite. */
  recordsRead: number;
};

/**
 * Criterios que la fuente DEBE poder aplicar antes de devolver nada.
 *
 * 🔴 § 4 — una fuente que no pueda aplicarlos no devuelve una muestra genérica:
 * devuelve cero. Un proveedor de construcción genérica jamás puede reducir el
 * objetivo de una búsqueda de `health_pharma` sólo porque la fuente lo tenía a
 * mano.
 */
export type CountrySourceCriteria = {
  countryCode: string;
  macroIndustryKey: string;
  /** Cuántas empresas como máximo se quieren leer. Acotado por el llamador. */
  limit: number;
};

/** Puerta de E/S inyectada. Sólo lectura, siempre. */
export type CountrySourceAdapter = (
  criteria: CountrySourceCriteria,
) => Promise<CountrySourceDiscoveryResult>;
