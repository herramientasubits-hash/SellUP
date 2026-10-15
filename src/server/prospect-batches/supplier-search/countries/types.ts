/**
 * AGENT1-SUPPLIER-SEARCH-ALL-1 — contrato de un país en «Proveedores de una empresa» por
 * compras públicas (puro). Cada país vive en sus propios archivos de esta carpeta:
 *
 *   <cc>.ts            configuración pura (+ reglas de número fiscal, nombre, clasificador)
 *   <cc>.loader.ts     sólo países «loaded»: archivos a bajar y lector → ProcurementLine
 *   <cc>.server.ts     sólo países «live» (o «loaded» con industria por actividad): consultas
 *   __tests__/<cc>.test.ts
 *
 * y se enchufa con UNA línea en `index.ts` (y en `index.server.ts` / `loaders.ts`).
 */

import type { CountrySourceCompany } from '@/server/prospect-batches/country-source-discovery/country-source-types';
import type { ProcurementClassifier, ProcurementLine } from '../procurement-links';

export type TaxIdentifierType = NonNullable<CountrySourceCompany['taxIdentifierType']>;

/** Lo común a cualquier país. */
type CountryBase = {
  countryCode: string;
  /** `source_key` de las filas/candidatos (y de su entrada en el Catálogo de fuentes). */
  sourceKey: string;
  taxIdentifierType: TaxIdentifierType;
  /** Cómo se normaliza el nombre de la entidad compradora (lo que escribe la persona). */
  normalizeBuyerName: (raw: string) => string;
};

/**
 * País con el resumen cargado en `public_procurement_supplier_links` (como Chile).
 * La búsqueda es la genérica (`loaded-lookups.server.ts`).
 */
export type LoadedCountrySource = CountryBase & {
  kind: 'loaded';
  currency: string;
  /** Piso acumulado entidad × proveedor en la ventana, en `currency` (~US$10 mil). */
  minPairAmount: number;
  /** Industria por lo que le vende a la entidad (tabla aprobada). */
  classifier: ProcurementClassifier;
  /**
   * Industria por la ACTIVIDAD oficial del proveedor (CIIU de su ficha) en vez de la
   * clasificación de compras (Ecuador, Costa Rica: sus datos no traen clasificación).
   * La da `<cc>.server.ts` (`activityMacroByTaxId`).
   */
  industryByActivity?: boolean;
  /** `source_company_snapshots.source_key` donde buscar la web del proveedor por número fiscal. */
  domainSourceKeys: readonly string[];
  /** Ídem para trabajadores (`raw_data.workers`); vacío si el país no los tiene. */
  workersSourceKeys: readonly string[];
  /** Nombre corto de la fuente de trabajadores para la ficha («SII», «SUNAT»…). */
  workersSourceLabel?: string;
  /** Cómo puede estar guardado el número fiscal en `source_company_snapshots.tax_id`. */
  snapshotTaxIdForms?: (taxId: string) => string[];
};

/** País consultado EN VIVO por comprador (como Colombia): su `<cc>.server.ts` da todo. */
export type LiveCountrySource = CountryBase & { kind: 'live' };

export type PublicBuyerCountrySource = LoadedCountrySource | LiveCountrySource;

/** Lector de un país «loaded» (sólo para el cargador, corre en Node). */
export type ProcurementLoaderSource = {
  country: LoadedCountrySource;
  /** Archivos de la ventana (más viejo primero), terminando en el mes `end` («2026-9»). */
  files: (end: { year: number; month: number }, months: number) => Array<{ url: string; name: string }>;
  /**
   * Lee un archivo ya descargado y entrega SÓLO líneas de proveedores EMPRESA (sin
   * personas naturales ni otras entidades públicas), en el formato común.
   */
  readLines: (filePath: string, onLine: (line: ProcurementLine) => void) => Promise<void>;
};
