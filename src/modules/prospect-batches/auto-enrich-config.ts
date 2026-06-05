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

  // Configuración del worker asíncrono backend
  workerBatchSize: 3,          // tamaño del batch del worker
  workerConcurrency: 2,        // concurrencia del procesamiento interno
  lockDurationMinutes: 5,      // duración del lock en minutos
  maxAttempts: 3,              // máximo de intentos por trabajo
  backoffSeconds: 30,          // backoff en segundos para reintentos progresivos
  cronInterval: '*/2 * * * *', // intervalo sugerido para el cron (cada 2 minutos)
};
