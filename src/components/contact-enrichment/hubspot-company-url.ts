// Enlaces a fichas de HubSpot (empresa y contacto). Presentación pura: sin red ni estado.

/** Ficha de la empresa en HubSpot. Sin portal conocido, HubSpot lleva al portal de la sesión. */
export function hubspotCompanyUrl(companyId: string, portalId: string | null | undefined): string {
  const id = encodeURIComponent(companyId.trim());
  return portalId
    ? `https://app.hubspot.com/contacts/${encodeURIComponent(portalId)}/company/${id}`
    : `https://app.hubspot.com/contacts/companies/${id}`;
}

/**
 * AGENT2-CONTACTS-TABLE-COLUMNS — ficha del contacto en HubSpot, con la misma forma que la de
 * la empresa. Sin portal conocido, HubSpot lleva al portal de la sesión.
 */
export function hubspotContactUrl(contactId: string, portalId: string | null | undefined): string {
  const id = encodeURIComponent(contactId.trim());
  return portalId
    ? `https://app.hubspot.com/contacts/${encodeURIComponent(portalId)}/contact/${id}`
    : `https://app.hubspot.com/contacts/contacts/${id}`;
}
