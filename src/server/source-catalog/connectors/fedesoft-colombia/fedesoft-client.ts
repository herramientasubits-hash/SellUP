import type { FedesoftDirectoryListing, FedesoftMember, FedesoftTaxonomyEntry } from './types';

const API_BASE = 'https://fedesoft.org/wp-json/wp/v2';
const MEMBERS_PAGE_URL = 'https://fedesoft.org/lista-de-miembros-asamblea-2025/';
const DEFAULT_PER_PAGE = 100;
const MAX_PAGES = 10;
const REQUEST_TIMEOUT_MS = 15_000;

const USER_AGENT = 'SellUp/0.1 source-catalog-audit';

function buildHeaders(): Record<string, string> {
  return { 'User-Agent': USER_AGENT };
}

function sanitizeFetchError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('abort') || msg.includes('timeout')) return 'Timeout al conectar con API Fedesoft';
    if (msg.includes('enotfound') || msg.includes('getaddrinfo')) return 'Error DNS al resolver API Fedesoft';
    if (msg.includes('ssl') || msg.includes('certificate')) return 'Error SSL al conectar con API Fedesoft';
    return `Error de red Fedesoft: ${error.message.slice(0, 200)}`;
  }
  return 'Error desconocido al consultar API Fedesoft';
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const combinedSignal = signal
    ? combineAbortSignals(signal, controller.signal)
    : controller.signal;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: buildHeaders(),
      signal: combinedSignal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} desde Fedesoft API: ${response.statusText}`);
    }

    const text = await response.text();

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('Respuesta Fedesoft no es JSON válido');
    }

    return parsed as T;
  } finally {
    clearTimeout(timeout);
  }
}

function combineAbortSignals(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

export async function fetchFedesoftDirectoryListings(options?: {
  perPage?: number;
  maxPages?: number;
  signal?: AbortSignal;
}): Promise<FedesoftDirectoryListing[]> {
  const perPage = options?.perPage ?? DEFAULT_PER_PAGE;
  const maxPages = options?.maxPages ?? MAX_PAGES;
  const allListings: FedesoftDirectoryListing[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const url = `${API_BASE}/at_biz_dir?per_page=${perPage}&page=${page}&_fields=id,slug,title,date,modified,type,link,at_biz_dir_category,at_biz_dir_location,tags,meta`;
    const listings = await fetchJson<FedesoftDirectoryListing[]>(url, options?.signal);

    if (!Array.isArray(listings) || listings.length === 0) break;

    allListings.push(...listings);

    if (listings.length < perPage) break;
  }

  return allListings;
}

export async function fetchFedesoftCategories(options?: {
  signal?: AbortSignal;
}): Promise<Map<number, string>> {
  return fetchFedesoftTaxonomy(`${API_BASE}/at_biz_dir-category`, options?.signal);
}

export async function fetchFedesoftLocations(options?: {
  signal?: AbortSignal;
}): Promise<Map<number, string>> {
  return fetchFedesoftTaxonomy(`${API_BASE}/at_biz_dir-location`, options?.signal);
}

async function fetchFedesoftTaxonomy(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<Map<number, string>> {
  const allEntries: FedesoftTaxonomyEntry[] = [];
  const perPage = 100;

  for (let page = 1; ; page++) {
    const url = `${baseUrl}?per_page=${perPage}&page=${page}&_fields=id,name,slug`;
    const entries = await fetchJson<FedesoftTaxonomyEntry[]>(url, signal);

    if (!Array.isArray(entries) || entries.length === 0) break;

    allEntries.push(...entries);

    if (entries.length < perPage) break;
  }

  const map = new Map<number, string>();
  for (const entry of allEntries) {
    map.set(entry.id, entry.name);
  }
  return map;
}

export async function fetchFedesoftMembersTable(options?: {
  signal?: AbortSignal;
}): Promise<FedesoftMember[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const combinedSignal = options?.signal
    ? combineAbortSignals(options.signal, controller.signal)
    : controller.signal;

  try {
    const response = await fetch(MEMBERS_PAGE_URL, {
      method: 'GET',
      headers: buildHeaders(),
      signal: combinedSignal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} al obtener página de miembros Fedesoft`);
    }

    const html = await response.text();
    return parseFedesoftMembersTable(html);
  } catch (error: unknown) {
    if (error instanceof Error && (error.message.includes('HTTP') || error.message.includes('Fedesoft'))) {
      throw error;
    }
    throw new Error(sanitizeFetchError(error));
  } finally {
    clearTimeout(timeout);
  }
}

export function parseFedesoftMembersTable(html: string): FedesoftMember[] {
  const tableMatch = html.match(/<table[^>]*class="[^"]*tablepress[^"]*"[^>]*>[\s\S]*?<\/table>/i);

  if (!tableMatch) {
    throw new Error(
      'No se encontró tabla TablePress en la página de miembros Fedesoft. ' +
        'Verificar que la URL y estructura HTML sigan siendo válidas.',
    );
  }

  const tableHtml = tableMatch[0];

  const rows: string[] = [];
  const rowRegex = /<tr[\s\S]*?<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
    rows.push(rowMatch[0]);
  }

  const members: FedesoftMember[] = [];
  let headerPassed = false;

  for (const rowHtml of rows) {
    const cells: string[] = [];
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      const cellContent = cellMatch[1]
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .trim();
      cells.push(cellContent);
    }

    if (!headerPassed) {
      const headerText = cells.join(' ').toLowerCase();
      if (
        headerText.includes('miembro') ||
        headerText.includes('nit') ||
        headerText.includes('empresa') ||
        headerText.includes('afiliada')
      ) {
        headerPassed = true;
      }
      continue;
    }

    const memberType = cells[0]?.trim() || '';
    const taxIdRaw = cells[1]?.trim() || '';
    const companyName = cells[2]?.trim() || '';

    if (!companyName) continue;

    const taxId = taxIdRaw || null;

    members.push({
      memberType,
      taxId,
      companyName,
    });
  }

  if (members.length === 0) {
    throw new Error(
      'No se pudieron extraer registros de la tabla de miembros Fedesoft. ' +
        'Verificar que la estructura HTML de TablePress siga siendo compatible.',
    );
  }

  return members;
}
