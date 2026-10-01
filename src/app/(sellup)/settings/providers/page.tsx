import { redirect } from 'next/navigation';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { getAdminBudgetSummary } from '@/modules/budgets/budget-resolution';
import { getBudgetRulesForAdmin } from '@/modules/budgets/rule-queries';
import { SettingsPage } from '@/components/settings/settings-page';
import { BudgetSummaryCards } from '../budget-credits/budget-summary-cards';
import { BudgetProvidersTable } from '../budget-credits/budget-providers-table';
import {
  getApolloConnection,
  getLushaConnection,
} from '@/modules/prospecting-config/actions';
import { getAllAIProviders } from '@/modules/ai-config/actions';
import type { ProspectingConnectionPanelState, AiConnectionPanelState } from './provider-detail-actions';

export default async function ProvidersConsumptionPage() {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) redirect('/settings');

  const [summary, rules, apolloConn, lushaConn, aiProviders] = await Promise.all([
    getAdminBudgetSummary(),
    getBudgetRulesForAdmin(),
    getApolloConnection().catch(() => null),
    getLushaConnection().catch(() => null),
    getAllAIProviders().catch(() => [] as Awaited<ReturnType<typeof getAllAIProviders>>),
  ]);

  const notConfigured: ProspectingConnectionPanelState = {
    supported: true,
    credentialsStatus: 'missing',
    connectionStatus: 'not_configured',
    lastTestedAt: null,
    lastConnectedAt: null,
    lastConnectionError: null,
  };

  const providerConnectionStates: Record<string, ProspectingConnectionPanelState> = {
    apollo: apolloConn
      ? {
          supported: true,
          credentialsStatus: apolloConn.credentials_status,
          connectionStatus: apolloConn.connection_status,
          lastTestedAt: apolloConn.last_tested_at ?? null,
          lastConnectedAt: apolloConn.last_connected_at ?? null,
          lastConnectionError: apolloConn.last_connection_error ?? null,
        }
      : notConfigured,
    lusha: lushaConn
      ? {
          supported: true,
          credentialsStatus: lushaConn.credentials_status,
          connectionStatus: lushaConn.connection_status,
          lastTestedAt: lushaConn.last_tested_at ?? null,
          lastConnectedAt: lushaConn.last_connected_at ?? null,
          lastConnectionError: lushaConn.last_connection_error ?? null,
        }
      : notConfigured,
  };

  const aiProviderConnectionStates: Record<string, AiConnectionPanelState> = {};
  for (const p of aiProviders) {
    const hasCredential = p.credentials_status === 'configured';
    const connectionStatus = p.connection_status ?? 'not_configured';
    aiProviderConnectionStates[p.key] = {
      hasCredential,
      connectionStatus,
      lastTestedAt: p.last_tested_at ?? null,
      lastConnectionError: p.last_connection_error ?? null,
      canActivate: hasCredential && connectionStatus === 'connected',
    };
  }

  return (
    <SettingsPage
      title="Proveedores y consumo"
      description="Conecta los proveedores de datos e IA, fija sus cuotas y revisa cuánto se ha gastado este mes."
    >
      <BudgetSummaryCards providers={summary.providers} />
      <BudgetProvidersTable
        providers={summary.providers}
        resolvedAt={summary.resolvedAt}
        allRules={rules}
        providerConnectionStates={providerConnectionStates}
        aiProviderConnectionStates={aiProviderConnectionStates}
      />
    </SettingsPage>
  );
}
