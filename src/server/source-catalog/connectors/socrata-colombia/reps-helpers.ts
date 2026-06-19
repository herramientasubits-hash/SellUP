/**
 * Socrata Colombia — REPS Helpers
 *
 * Helpers puros para el dataset REPS (c36g-9fc2).
 * El dataset está estructurado por sede: un prestador puede tener N filas.
 * Estos helpers agrupan esas filas en una entidad principal por prestador.
 *
 * IMPORTANTE: No conectar al puente de enrichment ni al wizard todavía.
 * Pendiente: activar en fase siguiente una vez se valide deduplicación.
 */

import type { NormalizedColombiaCompanySample } from './types';

export type RepsProviderSite = {
  site_code: string | null;
  site_name: string | null;
  site_address: string | null;
  department: string | null;
  municipality: string | null;
  site_email: string | null;
  site_phone: string | null;
};

export type RepsGroupedProvider = NormalizedColombiaCompanySample & {
  total_sites: number;
  departments: string[];
  municipalities: string[];
  sites: RepsProviderSite[];
};

function metaStr(val: string | number | boolean | null | undefined): string | null {
  return typeof val === 'string' ? val : null;
}

/**
 * Agrupa registros REPS por prestador (uno por NIT / numeroidentificacion).
 *
 * Regla: una entidad principal por NIT normalizado; si no hay NIT disponible,
 * se usa rawRecordId como fallback. Las sedes se consolidan en sites[].
 *
 * No crea entidades por codigohabilitacionsede.
 *
 * Uso: llamar después de normalizar con normalizeRepsRecord(). No conectar al
 * pipeline de account creation todavía — ver restricciones en CLAUDE.md/AGENTS.md.
 */
export function dedupeRepsRecordsByProvider(
  records: NormalizedColombiaCompanySample[],
): RepsGroupedProvider[] {
  type Bucket = {
    primary: NormalizedColombiaCompanySample;
    sites: RepsProviderSite[];
    departments: Set<string>;
    municipalities: Set<string>;
  };

  const buckets = new Map<string, Bucket>();
  let fallbackIdx = 0;

  for (const record of records) {
    const taxKey = record.taxId?.replace(/\s/g, '') ?? null;
    const key = taxKey ?? record.rawRecordId ?? `__no_key_${fallbackIdx++}`;

    const site: RepsProviderSite = {
      site_code: metaStr(record.sourceMetadata.reps_site_code),
      site_name: metaStr(record.sourceMetadata.site_name),
      site_address: metaStr(record.sourceMetadata.site_address),
      department: record.department,
      municipality: record.city,
      site_email: metaStr(record.sourceMetadata.site_email),
      site_phone: metaStr(record.sourceMetadata.site_phone),
    };

    const existing = buckets.get(key);
    if (existing) {
      existing.sites.push(site);
      if (record.department) existing.departments.add(record.department);
      if (record.city) existing.municipalities.add(record.city);
    } else {
      buckets.set(key, {
        primary: record,
        sites: [site],
        departments: new Set(record.department ? [record.department] : []),
        municipalities: new Set(record.city ? [record.city] : []),
      });
    }
  }

  return Array.from(buckets.values()).map(
    ({ primary, sites, departments, municipalities }) => ({
      ...primary,
      total_sites: sites.length,
      departments: Array.from(departments),
      municipalities: Array.from(municipalities),
      sites,
    }),
  );
}
