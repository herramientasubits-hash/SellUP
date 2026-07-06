const PROVIDER_OPERATION_LABELS: Record<string, Record<string, string>> = {
  apollo: {
    organization_enrichment: 'Enriquecimiento de empresa',
    organizations_search: 'Búsqueda de empresas',
    person_match: 'Validación de contacto',
    people_search: 'Búsqueda de personas',
    person_enrichment: 'Enriquecimiento de contacto',
    bulk_people_search: 'Búsqueda masiva de personas',
  },
  lusha: {
    person_enrichment: 'Enriquecimiento de contacto',
    phone_enrichment: 'Enriquecimiento de teléfono',
    email_enrichment: 'Enriquecimiento de email',
  },
  tavily: {
    web_search: 'Búsqueda web',
    linkedin_search: 'Búsqueda en LinkedIn',
  },
};

function toHumanLabel(key: string): string {
  if (!key) return 'Operación general';
  return key
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase());
}

export function getProviderOperationLabel(
  providerKey: string,
  operationKey: string,
): string {
  if (!operationKey) return 'Operación general';
  const providerOverrides = PROVIDER_OPERATION_LABELS[providerKey.toLowerCase()];
  return providerOverrides?.[operationKey] ?? toHumanLabel(operationKey);
}
