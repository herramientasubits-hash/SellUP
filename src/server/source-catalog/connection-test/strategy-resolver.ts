import type { CatalogSource } from '@/server/agents/prospecting-toolkit/types';
import type { SourceConnectionTestStrategy } from './types';

// Sources that use partial_download_head due to bulk/large file nature
const PARTIAL_DOWNLOAD_HEAD_KEYS = new Set<string>([
  'pe_sunat_bulk',
  'br_receita_dados_abertos',
]);

// Sources that require credentials regardless of operationalStatus
const REQUIRES_CREDENTIALS_KEYS = new Set<string>([
  'co_rues',
  'mx_compranet',
  'global_opencorporates',
  'br_cnpj_ws',
  'pe_migo_api',
]);

// Sources that are not supported (commercial APIs without direct URL)
const NOT_SUPPORTED_KEYS = new Set<string>([
  'global_apollo',
  'global_lusha',
]);

// Sources that need validation input regardless of operationalStatus
const VALIDATION_INPUT_REQUIRED_KEYS = new Set<string>([
  'br_receita_cnpj',
]);

const FILE_EXTENSION_PATTERN = /\.(zip|csv|xlsx|xls|gz|tar)(\?.*)?$/i;

export function resolveSourceConnectionStrategy(
  source: CatalogSource,
): SourceConnectionTestStrategy {
  // Explicit not_supported overrides
  if (NOT_SUPPORTED_KEYS.has(source.key)) return 'not_supported';

  // Explicit requires_credentials overrides
  if (REQUIRES_CREDENTIALS_KEYS.has(source.key)) return 'requires_credentials';

  // Explicit validation_input_required overrides
  if (VALIDATION_INPUT_REQUIRED_KEYS.has(source.key)) return 'validation_input_required';

  // Explicit partial_download_head overrides (bulk sources)
  if (PARTIAL_DOWNLOAD_HEAD_KEYS.has(source.key)) return 'partial_download_head';

  // operationalStatus-based rules
  const { operationalStatus } = source;

  if (
    operationalStatus === 'discarded_paid_or_tos' ||
    operationalStatus === 'discarded_low_value'
  ) {
    return 'not_supported';
  }

  if (operationalStatus === 'connection_required') {
    return 'requires_credentials';
  }

  if (operationalStatus === 'manual_signal_only') {
    return 'manual_only';
  }

  if (operationalStatus === 'validation_only') {
    return 'validation_input_required';
  }

  // Sources without a URL cannot be tested
  if (!source.url || source.url.trim() === '') {
    return 'not_supported';
  }

  // operational_verified or pending_validation with a URL
  if (
    operationalStatus === 'operational_verified' ||
    operationalStatus === 'pending_validation'
  ) {
    const url = source.url.toLowerCase();

    // File download URLs → prefer head to avoid large downloads
    if (FILE_EXTENSION_PATTERN.test(url)) {
      return 'http_head';
    }

    return 'http_get';
  }

  // Fallback — should not be reached with current statuses
  return 'not_supported';
}
