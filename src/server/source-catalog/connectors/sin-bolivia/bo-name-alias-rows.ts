/**
 * bo-name-alias-rows.ts — siglas y nombres de uso OFICIALES de los grandes
 * contribuyentes de Bolivia, por NIT (`source_key = bo_name_alias`).
 *
 * SOURCES-BO-CLOSE-1 (corrida BO×Tecnología bdc00381, 07-10). La capa gratuita
 * propuso Entel, Telecel, DMC y Dismatec con su NIT, pero el rescate buscó su web
 * con la razón social larga («EMPRESA NACIONAL DE TELECOMUNICACIONES SOCIEDAD
 * ANONIMA») y no la encontró. Las siglas oficiales de ese mismo NIT son la llave:
 *
 *   - la que la propia razón social trae entre paréntesis, entre comillas o detrás
 *     de la forma societaria: «TELEFÓNICA CELULAR DE BOLIVIA (TELECEL) S.A.» →
 *     TELECEL; «… S.A. "DISMATEC S.A."» → DISMATEC; «… S.A. DMC S.A.» → DMC;
 *   - la sigla con la que el portal del Estado (gob.bo) publica a una empresa pública
 *     cuyo nombre es el mismo: «Empresa Nacional de Telecomunicaciones», sigla
 *     «ENTEL S.A.» → ENTEL.
 *
 * El rescate las usa como los nombres oficiales de Ecuador (SOURCES-EC-CLOSE-2):
 * una web cuya etiqueta es exactamente esa sigla («entel.bo», «dmc.com.bo») es la
 * de ese NIT. Varias filas por NIT: identidad `bo-alias:<NIT>:<sigla>`.
 *
 * Puro: sin env, sin I/O, sin DB, sin reloj.
 */

import { normalizeBoliviaCompanyCore } from '../seprec-bolivia/bo-company-name-core';
import type { BoLargeTaxpayerSnapshotRow } from './bo-large-taxpayer-rows';

export const BO_NAME_ALIAS_SOURCE_KEY = 'bo_name_alias' as const;

/** Entidad pública de gob.bo reducida a lo que hace falta aquí. */
export type BoPublicEntityAcronym = { normalizedLegalName: string; acronym: string | null };

export type BoNameAliasSnapshotRow = {
  source_key: typeof BO_NAME_ALIAS_SOURCE_KEY;
  country_code: 'BO';
  source_year: number;
  source_period: null;
  record_identity_key: string;
  tax_id: string;
  normalized_tax_id: string;
  legal_name: string;
  normalized_legal_name: string;
  priority_score: number;
  raw_data: { alias_source: 'legal_name' | 'gobbo_acronym'; legal_name: string };
};

/** Una sigla útil: 3+ letras o cifras, no puramente numérica, distinta del núcleo. */
function usableAlias(alias: string, core: string): boolean {
  const compact = alias.replace(/[^A-Z0-9]/g, '');
  return compact.length >= 3 && !/^\d+$/.test(compact) && alias !== core;
}

/**
 * Filas de la lista de grandes contribuyentes (+ siglas de gob.bo) → siglas por NIT.
 * Una sigla repetida en el mismo NIT entra una vez.
 */
export function buildBoNameAliasRows(
  taxpayers: readonly Pick<BoLargeTaxpayerSnapshotRow, 'tax_id' | 'legal_name' | 'normalized_legal_name' | 'source_year' | 'raw_data'>[],
  publicEntities: readonly BoPublicEntityAcronym[] = [],
): BoNameAliasSnapshotRow[] {
  const acronymByCore = new Map<string, string>();
  for (const entity of publicEntities) {
    const acronym = normalizeBoliviaCompanyCore(entity.acronym);
    if (acronym.length > 0) acronymByCore.set(entity.normalizedLegalName, acronym);
  }
  const rows: BoNameAliasSnapshotRow[] = [];
  const seen = new Set<string>();
  for (const taxpayer of taxpayers) {
    const candidates: { alias: string; source: 'legal_name' | 'gobbo_acronym' }[] = [
      ...(taxpayer.raw_data.name_aliases ?? []).map((alias) => ({ alias, source: 'legal_name' as const })),
    ];
    const acronym = acronymByCore.get(taxpayer.normalized_legal_name);
    if (acronym) candidates.push({ alias: acronym, source: 'gobbo_acronym' });
    for (const { alias, source } of candidates) {
      if (!usableAlias(alias, taxpayer.normalized_legal_name)) continue;
      const key = `bo-alias:${taxpayer.tax_id}:${alias}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        source_key: BO_NAME_ALIAS_SOURCE_KEY,
        country_code: 'BO',
        source_year: taxpayer.source_year,
        source_period: null,
        record_identity_key: key,
        tax_id: taxpayer.tax_id,
        normalized_tax_id: taxpayer.tax_id,
        legal_name: taxpayer.legal_name,
        normalized_legal_name: alias,
        priority_score: 0,
        raw_data: { alias_source: source, legal_name: taxpayer.legal_name },
      });
    }
  }
  return rows;
}
