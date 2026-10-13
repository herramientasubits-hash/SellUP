/**
 * uy-sources-build.ts — arma TODAS las filas de las fuentes de Uruguay a partir de
 * los archivos ya leídos (RUPE, proveedores adjudicados de ARCE, referentes de la
 * UAIP, directorio industrial del MIEM, webs comprobadas por nombre). Lo usan el
 * ETL (`run-uy-sources-etl.ts`) y la búsqueda de webs (`discover-uy-company-webs.mts`)
 * para que los dos vean exactamente las mismas organizaciones.
 *
 * SOURCES-UY-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 */

import { dropAliasKeysOwnedByOthers } from '../sunat-peru/pe-name-keys';
import {
  buildUyArceDirectoryRow,
  type UyArceDirectoryExclusion,
  type UyArceDirectoryRow,
  type UyArceDirectoryWeb,
  type UyArceSupplierSummary,
} from './uy-arce-directory-row';
import {
  buildUyPublicEntityRow,
  groupUyPublicEntities,
  mergeUyPublicEntities,
  type UyPublicEntityRow,
  type UyTransparencyReferent,
} from './uy-public-entities';
import {
  buildUyRupeNameAliasRows,
  buildUyRupeRegistryRow,
  type UyRupeNameAliasRow,
  type UyRupeRegistryRow,
} from './uy-rupe-registry-row';
import {
  endsWithUruguayLegalForm,
  plainUpperUruguay,
  uruguayNameCore,
  uruguayOwnNameKeys,
  uruguayRegistryAliasKeys,
  UY_PUBLIC_ENTITY_ACRONYMS,
} from './uy-name-keys';

/** El RUPE ya filtrado: una fila por RUT, sus alias y un índice nombre → RUT. */
export type UyRegistryBuild = {
  registryRows: UyRupeRegistryRow[];
  aliasRows: UyRupeNameAliasRow[];
  byRut: ReadonlyMap<string, UyRupeRegistryRow>;
  /** Núcleo o alias → RUTs (para el RUT de las entidades públicas). */
  rutsByKey: ReadonlyMap<string, ReadonlySet<string>>;
};

/** Registros del CSV del RUPE → filas del registro y sus alias (sin claves ajenas). */
export function buildUyRegistry(
  records: Iterable<Record<string, string>>,
  params: { sourceYear: number; importedAt: string },
): UyRegistryBuild {
  const byRut = new Map<string, UyRupeRegistryRow>();
  for (const record of records) {
    const row = buildUyRupeRegistryRow(record, params);
    if (row === null || row.record_identity_key === null) continue;
    // Si un RUT aparece dos veces, gana el ACTIVO.
    const previous = byRut.get(row.tax_id);
    if (previous === undefined || (previous.raw_data['rupe_state'] !== 'active' && row.raw_data['rupe_state'] === 'active')) {
      byRut.set(row.tax_id, row);
    }
  }
  const registryRows = [...byRut.values()].sort((a, b) => a.tax_id.localeCompare(b.tax_id));
  const owners = new Map<string, Set<string>>();
  for (const row of registryRows) {
    for (const key of uruguayOwnNameKeys(row.normalized_legal_name)) {
      owners.set(key, (owners.get(key) ?? new Set<string>()).add(row.tax_id));
    }
  }
  const aliasRows = registryRows.flatMap((row) =>
    buildUyRupeNameAliasRows({
      registryRow: row,
      keys: dropAliasKeysOwnedByOthers(uruguayRegistryAliasKeys(row.legal_name), row.tax_id, owners),
    }),
  );
  const rutsByKey = new Map<string, Set<string>>();
  for (const row of [...registryRows, ...aliasRows]) {
    rutsByKey.set(row.normalized_legal_name, (rutsByKey.get(row.normalized_legal_name) ?? new Set<string>()).add(row.tax_id));
  }
  return { registryRows, aliasRows, byRut, rutsByKey };
}

/** Un único RUT para alguno de estos nombres, o `null` (ninguno o varios). */
export function uniqueRutForNames(rutsByKey: UyRegistryBuild['rutsByKey'], names: readonly string[]): string | null {
  for (const name of names) {
    const ruts = rutsByKey.get(uruguayNameCore(name));
    if (ruts !== undefined && ruts.size === 1) return [...ruts][0];
  }
  return null;
}

/**
 * RUT de una ENTIDAD PÚBLICA: por su nombre o por su sigla OFICIAL (tabla cerrada),
 * y sólo si la fila del RUPE no es una sociedad comercial («MEF S.R.L.» no es el
 * Ministerio de Economía).
 */
export function publicEntityRut(registry: UyRegistryBuild, name: string, acronyms: readonly string[]): string | null {
  const official = acronyms.filter((a) => UY_PUBLIC_ENTITY_ACRONYMS[plainUpperUruguay(a)] !== undefined);
  const rut = uniqueRutForNames(registry.rutsByKey, [name, ...official]);
  if (rut === null) return null;
  const legalName = registry.byRut.get(rut)?.legal_name ?? '';
  return endsWithUruguayLegalForm(legalName) ? null : rut;
}

/** La capa gratuita de empresas: filas y por qué quedaron fuera las demás. */
export function buildUyArceDirectory(params: {
  suppliers: readonly UyArceSupplierSummary[];
  registry: UyRegistryBuild;
  classLabels?: Readonly<Record<string, string>>;
  /** RUT → web (comprobada por nombre, del MIEM o del MSP). */
  webs?: ReadonlyMap<string, UyArceDirectoryWeb>;
  sourceYear: number;
  importedAt: string;
}): { rows: UyArceDirectoryRow[]; excluded: Partial<Record<UyArceDirectoryExclusion, number>> } {
  const rows: UyArceDirectoryRow[] = [];
  const excluded: Partial<Record<UyArceDirectoryExclusion, number>> = {};
  const seen = new Set<string>();
  for (const summary of params.suppliers) {
    // Un RUT, una fila: si el extractor repitiera un proveedor, gana el primero.
    if (seen.has(summary.rut)) continue;
    seen.add(summary.rut);
    const registryRow = params.registry.byRut.get(summary.rut) ?? null;
    const result = buildUyArceDirectoryRow({
      summary,
      registryLegalName: registryRow?.legal_name ?? null,
      department: typeof registryRow?.raw_data['department'] === 'string' ? (registryRow.raw_data['department'] as string) : null,
      classLabels: params.classLabels,
      web: params.webs?.get(summary.rut) ?? null,
      sourceYear: params.sourceYear,
      importedAt: params.importedAt,
    });
    if ('row' in result) rows.push(result.row);
    else excluded[result.excluded] = (excluded[result.excluded] ?? 0) + 1;
  }
  rows.sort((a, b) => b.priority_score - a.priority_score || a.tax_id.localeCompare(b.tax_id));
  return { rows, excluded };
}

/** La capa de Gobierno: entidades de la UAIP + intendencias, con RUT si el RUPE lo tiene. */
export function buildUyPublicEntityRows(params: {
  referents: readonly UyTransparencyReferent[];
  registry: UyRegistryBuild;
  sourceYear: number;
  importedAt: string;
}): UyPublicEntityRow[] {
  const entities = mergeUyPublicEntities(groupUyPublicEntities(params.referents));
  const rows: UyPublicEntityRow[] = [];
  const seen = new Set<string>();
  for (const entity of entities) {
    const rut = publicEntityRut(params.registry, entity.name, entity.acronyms);
    const row = buildUyPublicEntityRow({ entity, rut, sourceYear: params.sourceYear, importedAt: params.importedAt });
    if (row === null) continue;
    // Una entidad, una fila: dos nombres con el mismo RUT o la misma web no se repiten.
    const key = row.tax_id ?? `web:${row.raw_data['website_domain']}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  return rows.sort((a, b) => b.priority_score - a.priority_score || a.legal_name.localeCompare(b.legal_name));
}
