/**
 * SIIS Colombia Connector — Client HTTP
 *
 * Descarga controlada del Excel público de SIIS.
 * Solo server-side. No usar en Client Components.
 */

const SIIS_BASE_URL = 'https://siis.ia.supersociedades.gov.co/api/getExcel/';

export function getSiisExcelUrl(year: number, n: 1000 | 10000): string {
  const params = new URLSearchParams({
    anio: year.toString(),
    n: n.toString(),
  });
  return `${SIIS_BASE_URL}?${params.toString()}`;
}

export type SiisDownloadResult = {
  ok: boolean;
  buffer?: Buffer;
  contentType?: string;
  contentLength?: number;
  error?: string;
  statusCode?: number;
};

export async function downloadSiisExcel(
  year: number,
  n: 1000 | 10000,
  signal?: AbortSignal
): Promise<SiisDownloadResult> {
  const url = getSiisExcelUrl(year, n);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel, */*',
        'User-Agent': 'SellUp-SIIS-Connector/1.0',
      },
      signal,
      // Timeout de 60 segundos para descarga de hasta 10k registros
      // En entorno server-side esto está bien
    });

    if (!response.ok) {
      return {
        ok: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        statusCode: response.status,
      };
    }

    const contentType = response.headers.get('content-type') ?? '';
    const contentLength = response.headers.get('content-length')
      ? parseInt(response.headers.get('content-length')!, 10)
      : undefined;

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    return {
      ok: true,
      buffer,
      contentType,
      contentLength,
      statusCode: response.status,
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: 'Download aborted' };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown download error',
    };
  }
}

export const SIIS_CONFIRMED_YEARS = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];
export const SIIS_SUPPORTED_N_VALUES = [1000, 10000] as const;