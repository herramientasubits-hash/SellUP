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
  isApolloTwoRoundDiscoveryEnabled,
  isLushaPreviewEnabled,
  isWizardRunProviderOverrideEnabled,
  resolveApolloMaxEnrichmentsPerRun,
} from '@/lib/feature-flags.server';
import {
  resolveApolloMaxQueriesPerRun,
  resolveApolloMaxResultsPerQuery,
} from '@/server/agents/prospecting-toolkit/apollo-cost-guardrails';
import { resolveApolloTwoRoundConfigFromEnv } from '@/server/agents/prospecting-toolkit/apollo-two-round/env.server';
import { toApolloTwoRoundConfigDiagnostics } from '@/server/agents/prospecting-toolkit/apollo-two-round/config';
import {
  resolveWizardDiscoveryProviderVerbose,
  APOLLO_ORGANIZATION_ROLES,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-provider-resolver';
import { isRunProviderOverrideSurfaceAvailable } from '@/modules/prospect-batches/chat-wizard-execution/wizard-run-provider-capability';
import { PROVIDER_APPLICABLE_SEARCH_MODES } from '@/modules/prospect-batches/chat-wizard-execution/wizard-discovery-availability';
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

  // A1-APOLLO-TWO-ROUND-QA-READINESS-1 § 2 — los cinco números efectivos de la
  // modalidad de dos rondas y el origen de cada uno. `toApolloTwoRoundConfigDiagnostics`
  // emite SÓLO enteros resueltos y etiquetas de origen: nunca el valor crudo de
  // una variable de entorno, y por tanto nunca un secreto.
  const twoRoundDiagnostics = toApolloTwoRoundConfigDiagnostics(
    resolveApolloTwoRoundConfigFromEnv(),
  );

  return NextResponse.json({
    config_version: 'agent1_runtime_diagnostics_v2',
    diagnosis_timestamp: new Date().toISOString(),
    agent1_provider_resolved: providerResolution.provider,
    agent1_provider_reason: providerResolution.reason,
    apollo_company_search_enabled_resolved: isApolloCompanySearchEnabled(),
    apollo_enrichment_cascade_enabled_resolved: isApolloOrganizationEnrichmentCascadeEnabled(),
    // Forma de ejecución de Apollo. NO autoriza Apollo por sí sola: el kill
    // switch sigue siendo apollo_company_search_enabled_resolved.
    apollo_two_round_discovery_enabled_resolved: isApolloTwoRoundDiscoveryEnabled(),
    // Capacidad de fijar el proveedor de UNA corrida. Apagada ⇒ toda corrida
    // usa el predeterminado global.
    wizard_run_provider_override_enabled_resolved: isWizardRunProviderOverrideEnabled(),
    // A1-APOLLO-QA-CONTROL-SURFACE-1 § 12 — ¿la superficie «Proveedor de esta
    // corrida» puede ofrecer Apollo en este runtime? Es la conjunción resuelta de
    // los tres candados (override ∧ kill switch ∧ dos rondas). NO dice nada de los
    // permisos de ningún usuario concreto —no revela quién es admin— y por eso
    // puede publicarse aquí sin exponer identidades.
    run_provider_override_surface_available: isRunProviderOverrideSurfaceAvailable({
      runOverrideEnabled: isWizardRunProviderOverrideEnabled(),
      apolloCompanySearchEnabled: isApolloCompanySearchEnabled(),
      apolloTwoRoundDiscoveryEnabled: isApolloTwoRoundDiscoveryEnabled(),
    }),
    apollo_max_queries_per_run_resolved: resolveApolloMaxQueriesPerRun(),
    apollo_max_results_per_query_resolved: resolveApolloMaxResultsPerQuery(),
    // Tope de la ruta LEGACY (una sola ronda), cap 3. No confundir con
    // apollo_max_enrichments_per_run_resolved de la modalidad de dos rondas
    // (cap 2), que llega abajo dentro de twoRoundDiagnostics.
    apollo_legacy_max_enrichments_per_run_resolved: resolveApolloMaxEnrichmentsPerRun(),
    ...twoRoundDiagnostics,
    has_apollo_api_key: apolloKeyPresent,
    // Decisión estratégica Q3F-3: roles de Apollo Organizations en Agente 1.
    apollo_organization_search_role: APOLLO_ORGANIZATION_ROLES.search,
    apollo_organization_enrichment_role: APOLLO_ORGANIZATION_ROLES.enrichment,
    apollo_discovery_default_recommended: false,
    // AGENT1-PROVIDER-AVAILABILITY-UNIVERSAL-1 § 14 — los dos campos que faltaban
    // para poder EXPLICAR la disponibilidad sin abrir el wizard.
    //
    // El flag del proveedor OCULTO Lusha se publica porque su estado fue durante
    // meses la causa invisible de que «Empresas por criterios» apareciera sin
    // proveedor: con él apagado y unos criterios Lusha-elegibles, la pantalla final
    // retiraba el control de generación. Ya no lo hace, y verlo aquí junto a los
    // modos aplicables es lo que permite comprobarlo desde fuera.
    lusha_preview_enabled_resolved: isLushaPreviewEnabled(),
    // Modos de búsqueda a los que aplica un proveedor externo de discovery. La
    // disponibilidad se decide SÓLO con esto y con el país/industria elegidos:
    // nunca con la industria concreta, las subindustrias, el criterio adicional ni
    // la ruta de Lusha.
    agent1_provider_applicable_search_modes: [...PROVIDER_APPLICABLE_SEARCH_MODES],
    vercel_commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
  });
}
