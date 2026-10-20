/**
 * Identificar la empresa desde el navegador, por ruta y con tiempo límite
 * (AGENT2-RESOLVE-COMPANY-ROUTE-1). Nunca lanza y nunca se queda esperando para siempre: si
 * no hay respuesta en `timeoutMs`, devuelve un error que el asistente muestra con «Intentar
 * de nuevo».
 */

import type { CompanyResolutionResult } from './types';

export const RESOLVE_COMPANY_PATH = '/api/contact-enrichment/resolve-company';
/** HubSpot tiene un techo de ~20 s (dominio y nombre en serie); esto deja margen. */
export const RESOLVE_COMPANY_TIMEOUT_MS = 45_000;

export const RESOLVE_COMPANY_TIMEOUT_COPY = 'La búsqueda de la empresa tardó demasiado. Intenta nuevamente.';
export const RESOLVE_COMPANY_NETWORK_COPY = 'No pudimos conectar con el servidor. Intenta nuevamente.';
export const RESOLVE_COMPANY_SESSION_COPY = 'Tu sesión se cerró. Vuelve a iniciar sesión e inténtalo de nuevo.';

export interface ResolveCompanyClientResult {
  success: boolean;
  data?: CompanyResolutionResult;
  error?: string;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function resolveCompanyViaRoute(
  input: Record<string, unknown>,
  options: { timeoutMs?: number; fetchImpl?: FetchLike } = {},
): Promise<ResolveCompanyClientResult> {
  const fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? RESOLVE_COMPANY_TIMEOUT_MS);
  try {
    const response = await fetchImpl(RESOLVE_COMPANY_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      cache: 'no-store',
      signal: controller.signal,
    });
    // Sin sesión, el proxy redirige a /login y la respuesta es la página, no JSON.
    if (response.redirected && new URL(response.url, 'http://local').pathname.startsWith('/login')) {
      return { success: false, error: RESOLVE_COMPANY_SESSION_COPY };
    }
    const parsed = (await response.json().catch(() => null)) as ResolveCompanyClientResult | null;
    if (!parsed || typeof parsed.success !== 'boolean') return { success: false, error: RESOLVE_COMPANY_NETWORK_COPY };
    return parsed;
  } catch (err) {
    const aborted = controller.signal.aborted || (err instanceof Error && err.name === 'AbortError');
    return { success: false, error: aborted ? RESOLVE_COMPANY_TIMEOUT_COPY : RESOLVE_COMPANY_NETWORK_COPY };
  } finally {
    clearTimeout(timer);
  }
}
