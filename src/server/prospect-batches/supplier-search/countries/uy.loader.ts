/**
 * Uruguay — lector de las adjudicaciones OCDS de ARCE para el cargador genérico
 * (`--country UY`). Los datos abiertos son un zip por AÑO con un JSON por mes
 * («2025/a-12-2025.json» = adjudicaciones publicadas en diciembre); el último publicado es
 * 2025 (19-01-2026): no hay 2026 todavía.
 *
 * El primer «archivo» de la lista es el catálogo SICE (imp_catalogo.tgz): de ahí sale la
 * clase «familia-subfamilia-clase» de cada artículo (`x_catalogo_arce`). Los ítems con
 * `x_ODG` (objeto del gasto, casi siempre código 0) no tienen clase: cuentan en el monto
 * pero no clasifican.
 *
 * El OCDS de ARCE deja vacío el monto de la adjudicación: se usa cantidad × precio unitario
 * de cada ítem, pasado a pesos con los cambios fijos de `UY_UYU_PER` (aproximado: sólo para
 * el piso y el orden, no es contabilidad).
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { ProcurementLine } from '../procurement-links';
import { httpsUrl } from '../procurement-links';
import { readZipEntries } from './loader-io';
import { isUyCompanySupplier, parseUyRutId, UY_COUNTRY, UY_MAX_ITEM_AMOUNT_UYU, UY_UYU_PER, uyBuyerOf } from './uy';
import type { ProcurementLoaderSource } from './types';

export const UY_SICE_CATALOG_URL = 'http://www.comprasestatales.gub.uy/datos_abiertos/imp_catalogo.tgz';

/** Recurso CKAN de cada año (catalogodatos.gub.uy, «arce-datos-historicos-de-compras»). */
export const UY_OCDS_YEAR_URLS: Readonly<Record<number, string>> = Object.freeze({
  2024: 'https://catalogodatos.gub.uy/dataset/5203d170-e9ec-44d3-b09c-c0ef02270cc9/resource/12508c0e-6857-406b-8aca-a63e66920e9f/download/ocds-2024.zip',
  2025: 'https://catalogodatos.gub.uy/dataset/5203d170-e9ec-44d3-b09c-c0ef02270cc9/resource/cb26fe02-3bc2-4d79-95f3-a9d8d502134a/download/ocds-2025.zip',
});

const ARTICLE_ROW = /values \((\d+),'(?:[^']|'')*',(\d+),(\d+),(\d+),/;

type OcdsItem = {
  quantity?: unknown;
  classification?: { id?: unknown; scheme?: unknown } | null;
  unit?: { value?: { amount?: unknown; currency?: unknown } | null } | null;
};
type OcdsAward = {
  status?: unknown;
  date?: unknown;
  documents?: Array<{ url?: unknown }> | null;
  items?: OcdsItem[] | null;
  suppliers?: Array<{ id?: unknown; name?: unknown }> | null;
};
export type UyOcdsRelease = {
  ocid?: unknown;
  id?: unknown;
  date?: unknown;
  buyer?: { id?: unknown; name?: unknown } | null;
  awards?: OcdsAward[] | null;
};

const str = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '');

/** Monto de un ítem en pesos uruguayos (0 si falta algo o es absurdo). */
export function uyItemAmount(item: OcdsItem): number {
  const amount = item.unit?.value?.amount;
  const rate = UY_UYU_PER[str(item.unit?.value?.currency).toUpperCase()];
  if (typeof amount !== 'number' || typeof item.quantity !== 'number' || rate === undefined) return 0;
  const total = amount * item.quantity * rate;
  return total > 0 && total < UY_MAX_ITEM_AMOUNT_UYU ? total : 0;
}

/** Una adjudicación OCDS → líneas en formato común (una por ítem de cada proveedor empresa). */
export function uyLinesFromRelease(release: UyOcdsRelease, articleClass: ReadonlyMap<string, string>): ProcurementLine[] {
  const buyer = uyBuyerOf(str(release.buyer?.id), str(release.buyer?.name));
  const orderCode = str(release.ocid) || str(release.id);
  if (!buyer || !orderCode) return [];
  const out: ProcurementLine[] = [];
  for (const award of release.awards ?? []) {
    if (!['active', ''].includes(str(award.status))) continue;
    const date = (str(award.date) || str(release.date)).slice(0, 10) || null;
    const orderUrl = httpsUrl(str(award.documents?.[0]?.url)) ?? null;
    for (const supplier of award.suppliers ?? []) {
      const rut = parseUyRutId(str(supplier.id));
      const supplierName = str(supplier.name).replace(/\s+/g, ' ').trim();
      if (!isUyCompanySupplier(rut, supplierName)) continue;
      for (const item of award.items ?? []) {
        const code = str(item.classification?.scheme) === 'x_catalogo_arce' ? str(item.classification?.id) : '';
        out.push({
          buyerCode: buyer.code,
          buyerName: buyer.name,
          supplierTaxId: rut,
          supplierName,
          amount: uyItemAmount(item),
          orderCode,
          orderUrl,
          date,
          classificationKey: articleClass.get(code) ?? null,
        });
      }
    }
  }
  return out;
}

async function readArticleClasses(tgzPath: string, into: Map<string, string>): Promise<void> {
  const child = spawn('tar', ['-xzOf', tgzPath, 'ART_SERV_OBRA.sql'], { stdio: ['ignore', 'pipe', 'inherit'] });
  const lines = createInterface({ input: child.stdout.setEncoding('latin1'), crlfDelay: Infinity });
  for await (const line of lines) {
    const match = ARTICLE_ROW.exec(line);
    if (match) into.set(match[1], `${match[2]}-${match[3]}-${match[4]}`);
  }
  const code: number = await new Promise((resolve) => child.on('close', resolve));
  if (code !== 0) throw new Error(`tar_failed:${tgzPath}:${code}`);
}

/** Lector con su ventana (la fija `files()`) y el catálogo SICE (el primer archivo). */
export function createUyLoader(): ProcurementLoaderSource {
  const articleClass = new Map<string, string>();
  let monthsInWindow = new Set<string>();
  return {
    country: UY_COUNTRY,
    files: (end, months) => {
      const keys: string[] = [];
      const years = new Set<number>();
      for (let i = months - 1; i >= 0; i--) {
        const index = end.year * 12 + (end.month - 1) - i;
        const year = Math.floor(index / 12);
        keys.push(`${String((index % 12) + 1).padStart(2, '0')}-${year}`);
        years.add(year);
      }
      monthsInWindow = new Set(keys);
      const missing = [...years].filter((y) => !UY_OCDS_YEAR_URLS[y]);
      if (missing.length > 0) throw new Error(`uy_ocds_year_not_published:${missing.join(',')} (último publicado: 2025)`);
      return [
        { url: UY_SICE_CATALOG_URL, name: 'uy-sice-catalogo.tgz' },
        ...[...years].sort().map((y) => ({ url: UY_OCDS_YEAR_URLS[y], name: `uy-ocds-${y}.zip` })),
      ];
    },
    readLines: async (filePath, onLine) => {
      if (filePath.endsWith('.tgz')) return readArticleClasses(filePath, articleClass);
      if (articleClass.size === 0) throw new Error('uy_sice_catalog_not_loaded');
      await readZipEntries(
        filePath,
        (entry) => {
          const month = /(?:^|\/)a-(\d{2}-\d{4})\.json$/.exec(entry)?.[1];
          return month !== undefined && monthsInWindow.has(month);
        },
        (_entry, text) => {
          const releases = (JSON.parse(text) as { releases?: UyOcdsRelease[] }).releases ?? [];
          for (const release of releases) for (const line of uyLinesFromRelease(release, articleClass)) onLine(line);
        },
      );
    },
  };
}

export const UY_LOADER: ProcurementLoaderSource = createUyLoader();
