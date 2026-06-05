export const AUTO_ENRICH_CONFIG = {
  // autoenriquecimiento post-importación habilitado
  enabled: true,

  // máximo de concurrencia de llamadas de enriquecimiento simultáneas en el cliente
  maxConcurrency: 2,

  // máximo de candidatos automáticos por importación para evitar consumir créditos en exceso
  maxCandidatesPerBatch: 100,

  // campos corporativos esenciales que activan el enriquecimiento si falta al menos uno
  essentialFields: [
    'website',
    'linkedin_url',
    'description',
    'city',
    'company_size',
    'industry',
    'source_evidence',
    'confidence',
  ] as const,

  // proveedor o estrategia actual
  strategy: 'default_ai_fallback',
};
