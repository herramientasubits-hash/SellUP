import { Building2, Globe, TrendingUp, Search } from 'lucide-react';
import { DataTablePage } from '@/components/shared/data-table-page';
import { MetricCard } from '@/components/shared/metric-card';
import { CreateAccountDrawer } from '@/components/accounts/create-account-drawer';
import { AccountsDataTableClient } from '@/components/accounts/accounts-data-table-client';
import { ModuleTabsNav } from '@/components/navigation/module-tabs-nav';
import {
  ProspectsModulePanel,
  type ProspectsPanelSearchParams,
} from '@/components/prospects/prospects-module-panel';
import {
  getAccountsSummary,
  getAccountsList,
  getActiveUsers,
} from '@/modules/accounts/actions';
import { getCommercialScopeFilterOptions } from '@/modules/access/commercial-scope-filter-options';

interface PageProps {
  searchParams: Promise<{ tab?: string } & ProspectsPanelSearchParams>;
}

export default async function AccountsPage({ searchParams }: PageProps) {
  // "Empresas" is the single module entry point and hosts the pill switcher
  // (Empresas / Prospectos). Prospectos lives here as an internal tab — when
  // `?tab=prospectos` is present we render its server panel in place, keeping
  // the user inside the module instead of navigating to a separate route.
  const { tab, ...prospectsParams } = await searchParams;
  if (tab === 'prospectos') {
    return <ProspectsModulePanel params={prospectsParams} />;
  }

  const [summary, accounts, users, scopeFilterOptions] = await Promise.all([
    getAccountsSummary(),
    getAccountsList(),
    getActiveUsers(),
    getCommercialScopeFilterOptions(),
  ]);

  return (
    <DataTablePage
      title="Empresas"
      description="Centraliza empresas, prospectos y cuentas comerciales con su expediente vivo."
      tabs={<ModuleTabsNav active="empresas" />}
      actions={<CreateAccountDrawer users={users} />}
      metrics={
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Total empresas"
            description="Empresas en el sistema"
            value={summary.total}
            icon={
              <div className="rounded-lg p-1.5 bg-su-brand-soft">
                <Building2 className="h-4 w-4 text-su-brand" />
              </div>
            }
          />
          <MetricCard
            title="Nuevas"
            description="Recientes"
            value={summary.new}
            icon={
              <div className="rounded-lg p-1.5 bg-muted/60">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </div>
            }
          />
          <MetricCard
            title="Listas para investigar"
            description="Pendientes de research"
            value={summary.ready_for_research}
            icon={
              <div className="rounded-lg p-1.5 bg-su-brand-soft">
                <Search className="h-4 w-4 text-su-brand" />
              </div>
            }
          />
          <MetricCard
            title="Listas para contacto"
            description="Aptas para outreach"
            value={summary.ready_for_outreach}
            icon={
              <div className="rounded-lg p-1.5 bg-emerald-500/10">
                <Globe className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </div>
            }
          />
        </div>
      }
    >
      <AccountsDataTableClient accounts={accounts} users={users} scopeFilterOptions={scopeFilterOptions} />
    </DataTablePage>
  );
}
