/**
 * Prospect Generation Benchmark — Solicitud canónica (Hito 16AB.23)
 *
 * Primera prueba oficial. Todos los modos reciben exactamente este request.
 */

import type { BenchmarkRequest } from './types';

export const CANONICAL_REQUEST: BenchmarkRequest = {
  country: 'Colombia',
  country_code: 'CO',
  industry: 'Tecnología',
  requested_count: 10,
  commercial_context:
    'Empresas B2B con escala y potencial para soluciones de formación corporativa de UBITS',
};

// Límites operativos de la primera prueba
export const BENCHMARK_LIMITS = {
  requested_count: 10,
  max_candidates_to_discover: 30,
  max_searches_per_provider: 12,
  max_structural_repairs: 1,
} as const;
