import { Building2, Globe, TrendingUp, Search, Archive } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard } from '@/components/shared/surface-card';
import { CreateAccountDrawer } from '@/components/accounts/create-account-drawer';
import { AccountsTable } from '@/components/accounts/accounts-table';
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

  const summaryCards = [
    {
      label: 'Total empresas',
      value: summary.total,
      icon: Building2,
      color: 'text-su-brand',
      bg: 'bg-su-brand-soft',
    },
    {
      label: 'Nuevas',
      value: summary.new,
      icon: TrendingUp,
      color: 'text-muted-foreground',
      bg: 'bg-muted/60',
    },
    {
      label: 'Listas para investigar',
      value: summary.ready_for_research,
      icon: Search,
      color: 'text-su-brand',
      bg: 'bg-su-brand-soft',
    },
    {
      label: 'Listas para contacto',
      value: summary.ready_for_outreach,
      icon: Globe,
      color: 'text-emerald-600 dark:text-emerald-400',
      bg: 'bg-emerald-500/10',
    },
    {
      label: 'Archivadas',
      value: summary.archived,
      icon: Archive,
      color: 'text-muted-foreground/60',
      bg: 'bg-muted/40',
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Empresas"
        description="Centraliza empresas, prospectos y cuentas comerciales con su expediente vivo."
        actions={<CreateAccountDrawer users={users} />}
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {summaryCards.map((card) => (
          <SurfaceCard key={card.label} className="py-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                  {card.label}
                </p>
                <p className="mt-1.5 text-2xl font-semibold tabular-nums text-foreground">
                  {card.value}
                </p>
              </div>
              <div className={`rounded-lg p-1.5 ${card.bg}`}>
                <card.icon className={`h-4 w-4 ${card.color}`} />
              </div>
            </div>
          </SurfaceCard>
        ))}
      </div>

      {/* Accounts table — client component with row actions */}
      <SurfaceCard noPadding>
        <div className="border-b border-border/40 px-5 py-3.5">
          <p className="text-sm font-semibold text-foreground">
            {accounts.length === 0
              ? 'Sin empresas registradas'
              : `${accounts.length} empresa${accounts.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <AccountsTable accounts={accounts} users={users} />
      </SurfaceCard>
    </div>
  );
}
