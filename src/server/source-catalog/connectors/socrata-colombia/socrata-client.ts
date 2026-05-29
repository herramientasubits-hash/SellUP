/**
 * Socrata Colombia Connector — Read-only HTTP Client
 *
 * Solo requests GET a datos.gov.co.
 * Sin token. Sin writes. Sin logging de payloads completos.
 * Timeout máximo: 10s. Hard limit: 20 registros.
 */

import { SOCRATA_COLOMBIA_DATASETS } from './datasets';
import type { ColombiaCompanySource } from './types';

const SOCRATA_TIMEOUT_MS = 10_000;
const SOCRATA_DEFAULT_LIMIT = 5;
const SOCRATA_HARD_MAX_LIMIT = 20;

const SOCRATA_HEADERS = {
  'User-Agent': 'SellUp/0.1 data-source-audit',
  Accept: 'application/json',
};

type FetchSocrataParams = {
  dataset: ColombiaCompanySource;
  limit?: number;
  where?: string;
  select?: string;
  order?: string;
};

type FetchSocrataResult =
  | { ok: true; records: unknown[] }
  | { ok: false; error: string };

export async function fetchSocrataDatasetSample(
  params: FetchSocrataParams,
): Promise<FetchSocrataResult> {
  const datasetMeta = SOCRATA_COLOMBIA_DATASETS[params.dataset];
  const limit = Math.min(
    params.limit ?? SOCRATA_DEFAULT_LIMIT,
    SOCRATA_HARD_MAX_LIMIT,
  );

  const url = buildSocrataUrl(datasetMeta.baseUrl, {
    $limit: limit,
    $where: params.where,
    $select: params.select,
    $order: params.order,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SOCRATA_TIMEOUT_MS);

  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: SOCRATA_HEADERS,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      return {
        ok: false,
        error: `HTTP ${response.status} desde ${datasetMeta.datasetId}`,
      };
    }

    const records: unknown = await response.json();

    if (!Array.isArray(records)) {
      return { ok: false, error: 'Respuesta inesperada: no es un array JSON' };
    }

    return { ok: true, records };
  } catch (error: unknown) {
    return { ok: false, error: sanitizeFetchError(error) };
  }
}

function buildSocrataUrl(
  base: string,
  params: Record<string, string | number | undefined>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  }
  const qs = query.toString();
  return qs ? `${base}?${qs}` : base;
}

function sanitizeFetchError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('abort') || msg.includes('timeout')) return 'Timeout al conectar con datos.gov.co';
    if (msg.includes('enotfound') || msg.includes('getaddrinfo')) return 'Error DNS al resolver datos.gov.co';
    if (msg.includes('ssl') || msg.includes('certificate')) return 'Error SSL al conectar con datos.gov.co';
    // No exponer stack trace ni mensaje completo con paths/secrets
    return `Error de red: ${error.message.slice(0, 120)}`;
  }
  return 'Error desconocido al consultar datos.gov.co';
}
