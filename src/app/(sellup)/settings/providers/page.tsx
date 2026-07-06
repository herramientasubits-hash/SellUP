import { redirect } from 'next/navigation';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { getAdminBudgetSummary } from '@/modules/budgets';
import { getBudgetRulesForAdmin } from '@/modules/budgets/rule-queries';
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard } from '@/components/shared/surface-card';
import { BudgetSummaryCards } from '../budget-credits/budget-summary-cards';
import { BudgetProvidersTable } from '../budget-credits/budget-providers-table';
import { ProvidersTabs } from './providers-tabs';
import { AiSettingsSection } from '../ai/ai-settings-section';
import {
  getApolloConnection,
  getLushaConnection,
} from '@/modules/prospecting-config/actions';
import { getAllAIProviders } from '@/modules/ai-config/actions';
import type { ProspectingConnectionPanelState, AiConnectionPanelState } from './provider-detail-actions';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ProvidersConsumptionPage({ searchParams }: PageProps) {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) redirect('/settings');

  const resolved = await searchParams;
  const defaultTab = typeof resolved.tab === 'string' ? resolved.tab : null;

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
    <div className="space-y-8 px-8 py-6">
      <PageHeader
        title="Proveedores y consumo"
        description="Administra proveedores, cuotas, presupuestos, reglas, modelos de IA y trazabilidad de consumo desde un solo lugar."
        backHref="/settings"
      />

      <ProvidersTabs
        defaultTab={defaultTab}
        consumoContent={
          <div className="space-y-8">
            <BudgetSummaryCards providers={summary.providers} />
            <SurfaceCard>
              <div className="p-1">
                <BudgetProvidersTable
                  providers={summary.providers}
                  resolvedAt={summary.resolvedAt}
                  allRules={rules}
                  providerConnectionStates={providerConnectionStates}
                  aiProviderConnectionStates={aiProviderConnectionStates}
                />
              </div>
            </SurfaceCard>
          </div>
        }
        iaContent={
          <div className="space-y-6">
            <p className="text-sm text-muted-foreground">
              Administra proveedores LLM, modelos activos, tarifas por millón de tokens y configuración de conexión.
            </p>
            <AiSettingsSection />
          </div>
        }
      />
    </div>
  );
}
