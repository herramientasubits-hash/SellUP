/**
 * Agente 3 · Primer contacto — a dónde lleva cada entrada (puro).
 *
 * La pestaña «Primer contacto» de la empresa es el lugar donde vive todo (la
 * investigación y las preparaciones). Desde un contacto se llega con ese decisor
 * ya elegido (`contacto=`).
 */

export const FIRST_CALL_TAB_ID = 'primer-contacto';

/** Pestañas de antes («Inteligencia», «Primera llamada»): los enlaces viejos siguen sirviendo. */
const LEGACY_TAB_IDS: ReadonlySet<string> = new Set(['inteligencia', 'primera-llamada']);

export function normalizeAccountTab(tab: string | null | undefined): string | undefined {
  if (!tab) return undefined;
  return LEGACY_TAB_IDS.has(tab) ? FIRST_CALL_TAB_ID : tab;
}

export function firstCallHref(accountId: string, contactId?: string | null): string {
  const base = `/accounts/${accountId}?tab=${FIRST_CALL_TAB_ID}`;
  return contactId ? `${base}&contacto=${contactId}` : base;
}
