/**
 * SICOP Costa Rica — Cliente CKAN / datos.go.cr
 *
 * Consulta el portal de datos abiertos de Costa Rica (datos.go.cr) usando
 * la CKAN API v3. No requiere credenciales. No es fuente legal ni tributaria.
 *
 * Guardrail semántico: SICOP es señal procurement B2G únicamente.
 * No valida cédula jurídica. No reemplaza Hacienda CR.
 *
 * Hito: Centroamérica.4A
 */

// ─── Configuración ─────────────────────────────────────────────────────────────

const CKAN_BASE = 'https://www.datos.go.cr/api/3/action';
const CKAN_TIMEOUT_MS = 20_000;

export const CKAN_HEADERS = {
  'Accept': 'application/json',
  'User-Agent': 'SellUp/1.0 (procurement-signal-research)',
};

/**
 * IDs de datasets SICOP confirmados en Centroamérica.4A via CKAN package_search.
 * Guardados como fixtures estables para evitar depender de búsquedas frágiles.
 *
 * Verificados: 2026-07 (Centroamérica.4A) — slugs reales con prefijo 'hacienda-'.
 * Fuente: https://www.datos.go.cr/api/3/action/package_search?q=sicop
 */
export const SICOP_KNOWN_DATASETS: Record<string, string> = {
  recursos:             'hacienda-recursos2-2022-2024',
  aclaraciones:         'hacienda-aclaraciones2-2022-2024',
  ofertas_2024:         'hacienda-ofertas-anuales-2024',
  ofertas_2023:         'hacienda-ofertas-anuales-2023',
  ofertas_2022:         'hacienda-ofertas-anuales-2022',
  solicitudes:          'hacienda-solicitudes-contratacion-2022-2024',
  pliego_condiciones:   'hacienda-pliego-condiciones-2022-2024',
};

// ─── Tipos ─────────────────────────────────────────────────────────────────────

export type CkanResource = {
  id: string;
  name: string;
  url: string;
  format: string;
  description?: string;
  created?: string;
  last_modified?: string;
};

export type CkanPackage = {
  id: string;
  name: string;
  title: string;
  resources: CkanResource[];
};

export type CkanPackageResult =
  | { ok: true; pkg: CkanPackage }
  | { ok: false; error: string };

export type CkanSearchResult =
  | { ok: true; packages: CkanPackage[] }
  | { ok: false; error: string };

export type XlsxDownloadResult =
  | { ok: true; buffer: Buffer }
  | { ok: false; error: string };

// ─── Helpers ───────────────────────────────────────────────────────────────────

function buildAbortController(): { controller: AbortController; timer: ReturnType<typeof setTimeout> } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CKAN_TIMEOUT_MS);
  return { controller, timer };
}

async function safeFetchJson(url: string): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const { controller, timer } = buildAbortController();
  try {
    const res = await fetch(url, { headers: CKAN_HEADERS, signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) return { ok: false, error: `HTTP ${res.status} desde CKAN datos.go.cr` };

    const text = await res.text();
    if (text.trimStart().startsWith('<')) {
      return { ok: false, error: 'CKAN retornó HTML — endpoint incorrecto o servicio no disponible' };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, error: 'Respuesta CKAN no es JSON válido' };
    }

    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, error: 'Respuesta CKAN malformada: no es un objeto' };
    }

    const resp = parsed as Record<string, unknown>;
    if (resp['success'] === false) {
      const errMsg =
        (resp['error'] as Record<string, string> | null)?.message ??
        (resp['error'] as Record<string, string> | null)?.__type ??
        'Error desconocido CKAN';
      return { ok: false, error: `CKAN success=false: ${errMsg}` };
    }

    return { ok: true, data: resp['result'] };
  } catch (err: unknown) {
    clearTimeout(timer);
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      if (msg.includes('abort') || msg.includes('timeout')) {
        return { ok: false, error: 'Timeout al conectar con CKAN datos.go.cr' };
      }
      return { ok: false, error: `Error de red CKAN: ${err.message.slice(0, 120)}` };
    }
    return { ok: false, error: 'Error desconocido al consultar CKAN datos.go.cr' };
  }
}

// ─── API pública ───────────────────────────────────────────────────────────────

/**
 * Busca paquetes en el CKAN de datos.go.cr por query de texto.
 * Útil para descubrir datasets relacionados con SICOP.
 */
export async function searchCkanPackages(query: string): Promise<CkanSearchResult> {
  const url = `${CKAN_BASE}/package_search?q=${encodeURIComponent(query)}&rows=20`;
  const result = await safeFetchJson(url);
  if (!result.ok) return { ok: false, error: result.error };

  const data = result.data as Record<string, unknown> | null;
  const results = data?.['results'];
  if (!Array.isArray(results)) {
    return { ok: false, error: 'package_search no devolvió results array' };
  }

  return { ok: true, packages: results as CkanPackage[] };
}

/**
 * Obtiene metadatos y recursos de un paquete/dataset por ID o nombre slug.
 */
export async function fetchCkanPackage(packageIdOrName: string): Promise<CkanPackageResult> {
  const url = `${CKAN_BASE}/package_show?id=${encodeURIComponent(packageIdOrName)}`;
  const result = await safeFetchJson(url);
  if (!result.ok) return { ok: false, error: result.error };

  const pkg = result.data as CkanPackage | null;
  if (!pkg || !Array.isArray(pkg.resources)) {
    return { ok: false, error: 'package_show no devolvió resources array' };
  }

  return { ok: true, pkg };
}

/**
 * Lista los recursos SICOP conocidos a partir de los datasets guardados como fixtures.
 * Devuelve solo los recursos en formato XLSX/XLS disponibles para descarga.
 */
export async function listSicopResources(datasetKey: keyof typeof SICOP_KNOWN_DATASETS): Promise<
  { ok: true; resources: CkanResource[] } | { ok: false; error: string }
> {
  const datasetName = SICOP_KNOWN_DATASETS[datasetKey];
  if (!datasetName) {
    return { ok: false, error: `Dataset key desconocido: ${datasetKey}` };
  }

  const pkgResult = await fetchCkanPackage(datasetName);
  if (!pkgResult.ok) return { ok: false, error: pkgResult.error };

  const xlsxResources = pkgResult.pkg.resources.filter((r) => {
    const fmt = (r.format ?? '').toUpperCase();
    return fmt === 'XLSX' || fmt === 'XLS' || fmt === 'CSV';
  });

  return { ok: true, resources: xlsxResources };
}

/**
 * Descarga el contenido binario de un recurso XLSX.
 * Usa timeout separado para descargas (más lentas que API queries).
 */
export async function downloadSicopResource(resourceUrl: string): Promise<XlsxDownloadResult> {
  const DOWNLOAD_TIMEOUT_MS = 120_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  try {
    const res = await fetch(resourceUrl, {
      headers: { 'User-Agent': CKAN_HEADERS['User-Agent'] },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status} al descargar recurso SICOP` };
    }

    const arrayBuffer = await res.arrayBuffer();
    return { ok: true, buffer: Buffer.from(arrayBuffer) };
  } catch (err: unknown) {
    clearTimeout(timer);
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      if (msg.includes('abort') || msg.includes('timeout')) {
        return { ok: false, error: 'Timeout al descargar recurso SICOP (>120s)' };
      }
      return { ok: false, error: `Error de red al descargar recurso: ${err.message.slice(0, 120)}` };
    }
    return { ok: false, error: 'Error desconocido al descargar recurso SICOP' };
  }
}
