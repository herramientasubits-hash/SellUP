/**
 * Socrata Colombia Connector — Controlled Sample Runner
 *
 * Ejecuta muestras pequeñas de validación por dataset.
 * Sin writes. Sin candidatos. Sin IA. Sin Supabase.
 */

import { fetchSocrataDatasetSample } from './socrata-client';
import {
  normalizeRuesRecord,
  normalizeSecopRecord,
  normalizeRepsRecord,
  normalizeSuperfinancieraRecord,
} from './normalizers';
import { SOCRATA_COLOMBIA_DATASET_KEYS } from './datasets';
import type {
  ColombiaCompanySource,
  NormalizedColombiaCompanySample,
  SocrataColombiaSampleReport,
  SocrataSampleDatasetResult,
} from './types';

const SAMPLE_DEFAULT_LIMIT = 3;
const SAMPLE_HARD_MAX = 10;

/**
 * Filtros WHERE por dataset para evitar personas naturales y registros inactivos.
 * Basados en campos conocidos de la auditoría 16AB.1.
 */
const DATASET_WHERE_FILTERS: Record<ColombiaCompanySource, string> = {
  rues: "organizacion_juridica IS NOT NULL AND organizacion_juridica != 'PERSONA NATURAL'",
  secop2: "tipo_documento_proveedor='NIT'",
  reps: "tipoid='NI'",
  superfinanciera: '',
};

type RawRecord = Record<string, unknown>;

function normalizeRecord(
  source: ColombiaCompanySource,
  record: RawRecord,
): NormalizedColombiaCompanySample {
  switch (source) {
    case 'rues': return normalizeRuesRecord(record);
    case 'secop2': return normalizeSecopRecord(record);
    case 'reps': return normalizeRepsRecord(record);
    case 'superfinanciera': return normalizeSuperfinancieraRecord(record);
  }
}

async function sampleDataset(
  source: ColombiaCompanySource,
  limit: number,
): Promise<SocrataSampleDatasetResult> {
  const where = DATASET_WHERE_FILTERS[source] || undefined;

  const result = await fetchSocrataDatasetSample({ dataset: source, limit, where });

  if (!result.ok) {
    return { ok: false, recordsRead: 0, normalizedCount: 0, sample: [], error: result.error };
  }

  const records = result.records as RawRecord[];
  const normalized = records.map((r) => normalizeRecord(source, r));

  return {
    ok: true,
    recordsRead: records.length,
    normalizedCount: normalized.length,
    sample: normalized,
    error: null,
  };
}

export async function runSocrataColombiaSample(params?: {
  limitPerDataset?: number;
  datasets?: ColombiaCompanySource[];
}): Promise<SocrataColombiaSampleReport> {
  const limitPerDataset = Math.min(
    params?.limitPerDataset ?? SAMPLE_DEFAULT_LIMIT,
    SAMPLE_HARD_MAX,
  );
  const datasets = params?.datasets ?? SOCRATA_COLOMBIA_DATASET_KEYS;

  const resultEntries = await Promise.all(
    datasets.map(async (source) => {
      const result = await sampleDataset(source, limitPerDataset);
      return [source, result] as const;
    }),
  );

  const results = Object.fromEntries(resultEntries) as Record<
    ColombiaCompanySource,
    SocrataSampleDatasetResult
  >;

  return {
    executedAt: new Date().toISOString(),
    limitPerDataset,
    results,
  };
}
