/**
 * GET /api/debug/agent1-apollo-config
 *
 * Diagnóstico runtime seguro de la configuración de Apollo en Agente 1.
 * Lee ÚNICAMENTE los mismos helpers que usa producción — sin llamadas externas,
 * sin gasto de créditos, sin activar ningún provider.
 *
 * Acceso: admin-only (is_admin RPC + sesión autenticada).
 * No devuelve API keys ni secretos. No escribe en provider_usage_logs.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  isApolloCompanySearchEnabled,
  isApolloOrganizationEnrichmentCascadeEnabled,
  resolveApolloMaxEnrichmentsPerRun,
} from '@/lib/feature-flags.server';
import {
  resolveApolloMaxQueriesPerRun,
  resolveApolloMaxResultsPerQuery,
} from '@/server/agents/prospecting-toolkit/apollo-cost-guardrails';
import {
  resolveWizardDiscoveryProviderVerbose,
  APOLLO_ORGANIZATION_ROLES,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-provider-resolver';
import { hasApolloApiKey } from '@/server/services/apollo-connection';

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const { data: isAdmin } = await supabase.rpc('is_admin', {
    p_auth_user_id: user.id,
  });

  if (!isAdmin) {
    return NextResponse.json({ error: 'Acceso restringido a administradores' }, { status: 403 });
  }

  const providerResolution = resolveWizardDiscoveryProviderVerbose();
  const apolloKeyPresent = await hasApolloApiKey();

  return NextResponse.json({
    config_version: 'agent1_runtime_diagnostics_v1',
    diagnosis_timestamp: new Date().toISOString(),
    agent1_provider_resolved: providerResolution.provider,
    agent1_provider_reason: providerResolution.reason,
    apollo_company_search_enabled_resolved: isApolloCompanySearchEnabled(),
    apollo_enrichment_cascade_enabled_resolved: isApolloOrganizationEnrichmentCascadeEnabled(),
    apollo_max_queries_per_run_resolved: resolveApolloMaxQueriesPerRun(),
    apollo_max_results_per_query_resolved: resolveApolloMaxResultsPerQuery(),
    apollo_max_enrichments_per_run_resolved: resolveApolloMaxEnrichmentsPerRun(),
    has_apollo_api_key: apolloKeyPresent,
    // Decisión estratégica Q3F-3: roles de Apollo Organizations en Agente 1.
    apollo_organization_search_role: APOLLO_ORGANIZATION_ROLES.search,
    apollo_organization_enrichment_role: APOLLO_ORGANIZATION_ROLES.enrichment,
    apollo_discovery_default_recommended: false,
    vercel_commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
  });
}
