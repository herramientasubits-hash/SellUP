/**
 * Agente 3 · Primera llamada — a dónde lleva cada entrada (puro).
 *
 * La pestaña «Primera llamada» de la empresa es el lugar donde vive todo. Desde un
 * contacto se llega con ese decisor ya elegido (`contacto=`).
 */

export const FIRST_CALL_TAB_ID = 'primera-llamada';

export function firstCallHref(accountId: string, contactId?: string | null): string {
  const base = `/accounts/${accountId}?tab=${FIRST_CALL_TAB_ID}`;
  return contactId ? `${base}&contacto=${contactId}` : base;
}
