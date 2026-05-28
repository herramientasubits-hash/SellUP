import type { CatalogSource } from '@/server/agents/prospecting-toolkit/types';
import type {
  SourceConnectionTestResult,
  SourceConnectionTestStrategy,
} from '../types';
import { nowIso } from '../helpers';

const RECOMMENDATIONS: Record<string, string> = {
  requires_credentials:
    'Esta fuente requiere credenciales, acuerdo o token de acceso antes de poder probar la conexión. Gestiona el acceso primero.',
  validation_input_required:
    'Esta fuente requiere un identificador de entrada (RUC, CNPJ, NIT, etc.) para consultas puntuales. No soporta prueba de conexión genérica.',
  manual_only:
    'Esta fuente solo es útil como señal manual o referencia sectorial. No está disponible para conexión automática.',
  not_supported:
    'Esta fuente no soporta prueba de conexión automática. Puede ser una fuente pagada, con ToS restrictivo o sin endpoint público.',
};

export function runNoOpConnectionTest(
  source: CatalogSource,
  strategy: SourceConnectionTestStrategy,
): SourceConnectionTestResult {
  const recommendation = RECOMMENDATIONS[strategy] ?? RECOMMENDATIONS['not_supported'];

  switch (strategy) {
    case 'requires_credentials':
      return {
        sourceKey: source.key,
        strategy,
        status: 'requires_credentials',
        httpStatus: null,
        responseTimeMs: null,
        checkedAt: nowIso(),
        testedUrl: null,
        contentType: null,
        contentLength: null,
        errorCode: 'CREDENTIALS_REQUIRED',
        errorMessage: null,
        recommendation,
        metadata: {},
      };

    case 'validation_input_required':
      return {
        sourceKey: source.key,
        strategy,
        status: 'input_required',
        httpStatus: null,
        responseTimeMs: null,
        checkedAt: nowIso(),
        testedUrl: null,
        contentType: null,
        contentLength: null,
        errorCode: 'INPUT_REQUIRED',
        errorMessage: null,
        recommendation,
        metadata: {},
      };

    case 'manual_only':
      return {
        sourceKey: source.key,
        strategy,
        status: 'not_supported',
        httpStatus: null,
        responseTimeMs: null,
        checkedAt: nowIso(),
        testedUrl: null,
        contentType: null,
        contentLength: null,
        errorCode: 'UNSUPPORTED_SOURCE_TYPE',
        errorMessage: null,
        recommendation,
        metadata: {},
      };

    case 'not_supported':
    default:
      return {
        sourceKey: source.key,
        strategy: 'not_supported',
        status: 'not_supported',
        httpStatus: null,
        responseTimeMs: null,
        checkedAt: nowIso(),
        testedUrl: null,
        contentType: null,
        contentLength: null,
        errorCode: 'UNSUPPORTED_SOURCE_TYPE',
        errorMessage: null,
        recommendation,
        metadata: {},
      };
  }
}
