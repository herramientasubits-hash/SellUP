// ============================================================
// Asistente de Slack — enlaces directos a la pantalla correcta (puro).
// En vez de mandar al login, cada respuesta lleva a la vista exacta de
// SellUp con los mismos filtros (la URL es la de la propia pantalla).
// ============================================================

export interface ProspectLinkFilters {
  pais?: string;
  industria?: string;
  texto?: string;
}

function base(appUrl: string): string {
  return appUrl.replace(/\/+$/, '');
}

/** Empresas › Por revisar, con país/industria/texto ya filtrados. */
export function pendingProspectsLink(appUrl: string, filters: ProspectLinkFilters = {}): string {
  return prospectsLink(appUrl, 'por_revisar', filters);
}

/** Por revisar o Descartadas (las demás vistas no tienen pantalla propia: van a Por revisar). */
export function prospectsLink(appUrl: string, state: string, filters: ProspectLinkFilters = {}): string {
  const params = new URLSearchParams({ tab: 'prospectos' });
  if (state === 'descartados') params.set('view', 'descartadas');
  if (filters.pais) params.set('country', filters.pais.trim().length === 2 ? filters.pais.trim().toUpperCase() : filters.pais.trim());
  if (filters.industria) params.set('industry', filters.industria.trim());
  if (filters.texto) params.set('search', filters.texto.trim());
  return `${base(appUrl)}/accounts?${params.toString()}`;
}

export function accountsLink(appUrl: string): string {
  return `${base(appUrl)}/accounts`;
}

export function accountLink(appUrl: string, accountId: string): string {
  return `${base(appUrl)}/accounts/${encodeURIComponent(accountId)}`;
}

/** Empresas › Búsquedas, con una búsqueda resaltada si viene. */
export function searchesLink(appUrl: string, searchId?: string | null): string {
  const params = new URLSearchParams({ tab: 'busquedas' });
  if (searchId) params.set('focus', searchId);
  return `${base(appUrl)}/accounts?${params.toString()}`;
}

export function usersLink(appUrl: string): string {
  return `${base(appUrl)}/settings/users`;
}

export function aiUsageLink(appUrl: string): string {
  return `${base(appUrl)}/ai-usage`;
}

export function sourceCatalogLink(appUrl: string): string {
  return `${base(appUrl)}/source-catalog`;
}

export function budgetLink(appUrl: string): string {
  return `${base(appUrl)}/settings/budget-credits`;
}
