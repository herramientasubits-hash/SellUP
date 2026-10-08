// Enlace a la ficha de una empresa en HubSpot. Presentación pura: sin red ni estado.

/** Ficha de la empresa en HubSpot. Sin portal conocido, HubSpot lleva al portal de la sesión. */
export function hubspotCompanyUrl(companyId: string, portalId: string | null | undefined): string {
  const id = encodeURIComponent(companyId.trim());
  return portalId
    ? `https://app.hubspot.com/contacts/${encodeURIComponent(portalId)}/company/${id}`
    : `https://app.hubspot.com/contacts/companies/${id}`;
}
