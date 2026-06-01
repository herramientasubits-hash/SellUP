import { createClient as createAdminClient } from '@supabase/supabase-js';
import { CATALOG_SOURCES } from '@/server/agents/prospecting-toolkit/source-catalog';
import type {
  CatalogSource,
  CatalogSourceOperationalStatus,
  SourcePriority,
} from '@/server/agents/prospecting-toolkit/types';

// ─── Admin client (service role — server-only) ─────────────────────────────

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://lrdruowtadwbdulndlph.supabase.co';
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxyZHJ1b3d0YWR3YmR1bG5kbHBoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODgzODY2NCwiZXhwIjoyMDk0NDE0NjY0fQ.0fnp65rmdJxklJvVkaWuA3J9dtBpf0Jg2zB2kSyyg0E';

function getAdminSupabase() {
  return createAdminClient(supabaseUrl, supabaseServiceKey);
}

// ─── Source connection record (safe — no secrets) ──────────────────────────

export type SourceConnectionRecord = {
  source_key: string;
  source_name_snapshot: string | null;
  country_code: string | null;
  auth_type: string;
  requires_credentials: boolean;
  credentials_status: string;
  connection_status: string;
  has_vault_secret_id: boolean;
  vault_secret_name: string | null;
  last_tested_at: string | null;
  last_test_status: string | null;
  last_test_http_status: number | null;
  last_test_response_time_ms: number | null;
  last_connection_error: string | null;
  connected_at: string | null;
};

export async function getSourceConnectionRecord(
  sourceKey: string,
): Promise<SourceConnectionRecord | null> {
  const admin = getAdminSupabase();

  // First try: exact source_key match
  let { data, error } = await admin
    .from('source_catalog_connections')
    .select(
      'source_key, source_name_snapshot, country_code, auth_type, requires_credentials, credentials_status, connection_status, vault_secret_id, vault_secret_name, last_tested_at, last_test_status, last_test_http_status, last_test_response_time_ms, last_connection_error, connected_at',
    )
    .eq('source_key', sourceKey)
    .single();

  // Second try: match by catalog_key in metadata (for when sourceKey is a catalog key)
  if ((error || !data) && sourceKey) {
    const { data: dataByMetadata, error: errorByMetadata } = await admin
      .from('source_catalog_connections')
      .select(
        'source_key, source_name_snapshot, country_code, auth_type, requires_credentials, credentials_status, connection_status, vault_secret_id, vault_secret_name, last_tested_at, last_test_status, last_test_http_status, last_test_response_time_ms, last_connection_error, connected_at',
      )
      .eq('metadata->>catalog_key', sourceKey)
      .single();

    if (!errorByMetadata && dataByMetadata) {
      data = dataByMetadata;
      error = null;
    }
  }

  if (error || !data) return null;

  return {
    source_key: data.source_key,
    source_name_snapshot: data.source_name_snapshot ?? null,
    country_code: data.country_code ?? null,
    auth_type: data.auth_type,
    requires_credentials: data.requires_credentials,
    credentials_status: data.credentials_status,
    connection_status: data.connection_status,
    has_vault_secret_id: data.vault_secret_id != null,
    vault_secret_name: null,
    last_tested_at: data.last_tested_at ?? null,
    last_test_status: data.last_test_status ?? null,
    last_test_http_status: data.last_test_http_status ?? null,
    last_test_response_time_ms: data.last_test_response_time_ms ?? null,
    last_connection_error: data.last_connection_error ?? null,
    connected_at: data.connected_at ?? null,
  };
}

export type SourceViewModel = {
  key: string;
  name: string;
  countryCodes: string[];
  sectors: string[];
  type: CatalogSource['type'];
  priority: SourcePriority;
  automationLevel: CatalogSource['automationLevel'];
  operationalStatus: CatalogSourceOperationalStatus;
  url: string | null;
  recommendedUse: string;
  limitations: string[];
  riskNotes: string[];
};

export type SourceCatalogMetrics = {
  total: number;
  byOperationalStatus: Record<string, number>;
  byPriority: Record<string, number>;
  byCountry: Record<string, number>;
  byType: Record<string, number>;
  byAutomationLevel: Record<string, number>;
};

export type SourceCatalogFilters = {
  countries: string[];
  operationalStatuses: CatalogSourceOperationalStatus[];
  priorities: SourcePriority[];
  types: CatalogSource['type'][];
  automationLevels: CatalogSource['automationLevel'][];
  sectors: string[];
};

export type SourceCatalogViewModel = {
  sources: SourceViewModel[];
  metrics: SourceCatalogMetrics;
  filters: SourceCatalogFilters;
};

export function getSourceCatalogViewModel(): SourceCatalogViewModel {
  const sources: SourceViewModel[] = CATALOG_SOURCES.map((s) => ({
    key: s.key,
    name: s.name,
    countryCodes: s.countryCodes,
    sectors: s.sectors,
    type: s.type,
    priority: s.priority,
    automationLevel: s.automationLevel,
    operationalStatus: s.operationalStatus,
    url: s.url ?? null,
    recommendedUse: s.recommendedUse,
    limitations: s.limitations ?? [],
    riskNotes: s.riskNotes ?? [],
  }));

  const byOperationalStatus: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  const byCountry: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const byAutomationLevel: Record<string, number> = {};

  for (const s of sources) {
    byOperationalStatus[s.operationalStatus] =
      (byOperationalStatus[s.operationalStatus] ?? 0) + 1;
    byPriority[s.priority] = (byPriority[s.priority] ?? 0) + 1;
    byType[s.type] = (byType[s.type] ?? 0) + 1;
    byAutomationLevel[s.automationLevel] =
      (byAutomationLevel[s.automationLevel] ?? 0) + 1;
    for (const c of s.countryCodes) {
      byCountry[c] = (byCountry[c] ?? 0) + 1;
    }
  }

  const uniqueSorted = <T extends string>(arr: T[]): T[] =>
    [...new Set(arr)].sort() as T[];

  const allCountries = sources.flatMap((s) => s.countryCodes);
  const allSectors = sources.flatMap((s) => s.sectors);

  const filters: SourceCatalogFilters = {
    countries: uniqueSorted(allCountries),
    operationalStatuses: uniqueSorted(
      sources.map((s) => s.operationalStatus),
    ) as CatalogSourceOperationalStatus[],
    priorities: uniqueSorted(sources.map((s) => s.priority)) as SourcePriority[],
    types: uniqueSorted(sources.map((s) => s.type)) as CatalogSource['type'][],
    automationLevels: uniqueSorted(
      sources.map((s) => s.automationLevel),
    ) as CatalogSource['automationLevel'][],
    sectors: uniqueSorted(allSectors),
  };

  return {
    sources,
    metrics: {
      total: sources.length,
      byOperationalStatus,
      byPriority,
      byCountry,
      byType,
      byAutomationLevel,
    },
    filters,
  };
}
