import { CATALOG_SOURCES } from '@/server/agents/prospecting-toolkit/source-catalog';
import type { SourceConnectionTestResult } from './types';
import { resolveSourceConnectionStrategy } from './strategy-resolver';
import { runHttpGetConnectionTest } from './adapters/http-get-adapter';
import { runHttpHeadConnectionTest } from './adapters/http-head-adapter';
import { runPartialDownloadHeadConnectionTest } from './adapters/partial-download-head-adapter';
import { runNoOpConnectionTest } from './adapters/no-op-adapter';
import { nowIso } from './helpers';

export async function runSourceConnectionTest(
  sourceKey: string,
): Promise<SourceConnectionTestResult> {
  const source = CATALOG_SOURCES.find((s) => s.key === sourceKey);

  if (!source) {
    return {
      sourceKey,
      strategy: 'not_supported',
      status: 'not_supported',
      httpStatus: null,
      responseTimeMs: null,
      checkedAt: nowIso(),
      testedUrl: null,
      contentType: null,
      contentLength: null,
      errorCode: 'UNSUPPORTED_SOURCE_TYPE',
      errorMessage: `Fuente no encontrada en el catálogo: ${sourceKey}`,
      recommendation:
        'Verifica que la clave de la fuente sea correcta y exista en el catálogo.',
      metadata: {},
    };
  }

  const strategy = resolveSourceConnectionStrategy(source);

  switch (strategy) {
    case 'http_get':
      return runHttpGetConnectionTest(source);

    case 'http_head':
      return runHttpHeadConnectionTest(source);

    case 'partial_download_head':
      return runPartialDownloadHeadConnectionTest(source);

    case 'requires_credentials':
    case 'manual_only':
    case 'validation_input_required':
    case 'not_supported':
      return runNoOpConnectionTest(source, strategy);
  }
}
