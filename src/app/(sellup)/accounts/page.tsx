import { Building2, Globe, TrendingUp, Search } from 'lucide-react';
import { DataTablePage } from '@/components/shared/data-table-page';
import { MetricCard } from '@/components/shared/metric-card';
import { CreateAccountDrawer } from '@/components/accounts/create-account-drawer';
import { AccountsDataTableClient } from '@/components/accounts/accounts-data-table-client';
import {
  getAccountsSummary,
  getAccountsList,
  getActiveUsers,
} from '@/modules/accounts/actions';

export default async function AccountsPage() {
  const [summary, accounts, users] = await Promise.all([
    getAccountsSummary(),
    getAccountsList(),
    getActiveUsers(),
  ]);

  return (
    <DataTablePage
      title="Empresas"
      description="Centraliza empresas, prospectos y cuentas comerciales con su expediente vivo."
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
      <AccountsDataTableClient accounts={accounts} users={users} />
    </DataTablePage>
  );
}
