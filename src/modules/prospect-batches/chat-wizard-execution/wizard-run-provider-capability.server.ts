/**
 * wizard-run-provider-capability.server.ts — lecturas de entorno y de rol para la
 * capacidad de elegir proveedor por corrida.
 *
 * A1-APOLLO-QA-CONTROL-SURFACE-1 · § 2 y § 7.
 *
 * Única frontera de I/O de la capacidad: aquí se leen la sesión, el rol y los
 * flags; la decisión la toma el núcleo puro
 * (`resolveWizardProviderOverrideCapability`).
 *
 * Este módulo NO es la autorización de la ejecución. Lo que produce alimenta a la
 * UI para decidir si mostrar un control. La autoridad real se vuelve a derivar en
 * `executeProspectWizardGenerationAction` en el momento de ejecutar, con las
 * mismas funciones — y ahí el kill switch manda por encima de todo.
 */

import { createClient } from '@/lib/supabase/server';
import {
  isApolloCompanySearchEnabled,
  isApolloTwoRoundDiscoveryEnabled,
  isWizardRunProviderOverrideEnabled,
} from '@/lib/feature-flags.server';
import { resolveApolloTwoRoundConfigFromEnv } from '@/server/agents/prospecting-toolkit/apollo-two-round/env.server';
import { estimateApolloTwoRoundBudget } from '@/server/agents/prospecting-toolkit/apollo-two-round/budget';
import {
  resolveWizardProviderOverrideCapability,
  type ApolloRunModeLimits,
  type WizardProviderOverrideCapability,
} from './wizard-run-provider-capability';

/** Sesión + rol resueltos en el servidor. Nunca se derivan de un payload. */
export type WizardAdminAuthority = {
  isAuthenticated: boolean;
  isAdmin: boolean;
};

const NO_AUTHORITY: WizardAdminAuthority = { isAuthenticated: false, isAdmin: false };

/**
 * A1-APOLLO-WIZARD-1 — rol admitido para discovery de empresas con Apollo,
 * resuelto contra la sesión y la base.
 *
 * Falla cerrado en todos los caminos: sin sesión, sin usuario interno activo, con
 * un rol ilegible o con un error de lectura, el resultado es «no admin». Un rol
 * que no se pudo leer no es un rol admitido.
 */
export async function resolveWizardAdminAuthority(): Promise<WizardAdminAuthority> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NO_AUTHORITY;

    const { data: internalUser } = await supabase
      .from('internal_users')
      .select('id, role_id')
      .eq('auth_user_id', user.id)
      .eq('access_status', 'active')
      .single();
    // Sesión válida pero sin usuario interno activo: autenticado, no admin.
    if (!internalUser) return { isAuthenticated: true, isAdmin: false };

    const { data: role } = await supabase
      .from('roles')
      .select('key')
      .eq('id', internalUser.role_id)
      .single();

    return { isAuthenticated: true, isAdmin: role?.key === 'admin' };
  } catch {
    return NO_AUTHORITY;
  }
}

/** Compatibilidad con el gate de disponibilidad de Apollo, que sólo pide el rol. */
export async function isWizardApolloDiscoveryRolePermitted(): Promise<boolean> {
  const authority = await resolveWizardAdminAuthority();
  return authority.isAdmin;
}

/**
 * § 2 — capacidad sanitizada del usuario actual, lista para viajar a la UI.
 *
 * El corto-circuito importa: con `ENABLE_WIZARD_RUN_PROVIDER_OVERRIDE` apagado
 * —el estado actual de Producción— no se consulta ni la sesión ni el rol, así que
 * la superficie no añade ni una lectura a la ruta que hoy ya funciona.
 */
export async function resolveWizardProviderOverrideCapabilityForCurrentUser(): Promise<WizardProviderOverrideCapability> {
  const runOverrideEnabled = isWizardRunProviderOverrideEnabled();

  const authority = runOverrideEnabled ? await resolveWizardAdminAuthority() : NO_AUTHORITY;

  return resolveWizardProviderOverrideCapability({
    isAuthenticated: authority.isAuthenticated,
    isAdmin: authority.isAdmin,
    runOverrideEnabled,
    apolloCompanySearchEnabled: isApolloCompanySearchEnabled(),
    apolloTwoRoundDiscoveryEnabled: isApolloTwoRoundDiscoveryEnabled(),
  });
}

/**
 * § 5 — topes efectivos que la superficie puede anunciar.
 *
 * `null` cuando la modalidad de dos rondas está apagada: sin ella no hay ninguna
 * cifra honesta que publicar, y repetir los defaults del código en el copy es
 * exactamente cómo una pantalla acaba prometiendo un techo que el runtime ya no
 * aplica.
 *
 * Los cinco números y el techo de créditos salen de las mismas funciones que
 * gobiernan la ejecución y la reserva, así que el copy no puede desviarse del
 * gasto realmente autorizado.
 */
export async function resolveApolloRunModeLimitsForSurface(): Promise<ApolloRunModeLimits | null> {
  if (!isApolloTwoRoundDiscoveryEnabled()) return null;

  const { config } = resolveApolloTwoRoundConfigFromEnv();
  const budget = estimateApolloTwoRoundBudget(config);

  return {
    targetEligibleCompanies: config.targetEligibleCompanies,
    maxRounds: config.maxRounds,
    maxResultsPerRound: config.maxResultsPerRound,
    maxRawResultsPerRun: config.maxRawResultsPerRun,
    maxEnrichmentsPerRun: config.maxEnrichmentsPerRun,
    maxInternalCredits: budget.maximumInternalRecordedCredits,
  };
}
