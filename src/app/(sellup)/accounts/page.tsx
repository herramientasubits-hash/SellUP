import Link from 'next/link';
import { Building2, Globe, TrendingUp, Search, Archive } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard } from '@/components/shared/surface-card';
import { Badge } from '@/components/ui/badge';
import { CreateAccountDrawer } from '@/components/accounts/create-account-drawer';
import {
  getAccountsSummary,
  getAccountsList,
  getActiveUsers,
} from '@/modules/accounts/actions';
import {
  PIPELINE_STATUS_LABELS,
  SOURCE_LABELS,
  type PipelineStatus,
  type AccountSource,
} from '@/modules/accounts/types';

// ── Status badge mapping ──────────────────────────────────────

const STATUS_STYLES: Record<PipelineStatus, string> = {
  new: 'bg-muted text-muted-foreground',
  ready_for_research: 'bg-su-brand-soft text-su-brand',
  research_in_progress: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  ready_for_outreach: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  archived: 'bg-muted/60 text-muted-foreground/60',
};

const SOURCE_STYLES: Record<AccountSource, string> = {
  manual: 'border-border text-muted-foreground',
  agent_1: 'bg-su-brand-soft text-su-brand border-transparent',
  hubspot: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-transparent',
  apollo: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-transparent',
  imported: 'border-border text-muted-foreground',
  other: 'border-border text-muted-foreground',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export default async function AccountsPage() {
  const [summary, accounts, users] = await Promise.all([
    getAccountsSummary(),
    getAccountsList(),
    getActiveUsers(),
  ]);

  const summaryCards = [
    {
      label: 'Total cuentas',
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
        title="Cuentas"
        description="Centraliza empresas, prospectos y cuentas preparadas para investigación comercial."
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

      {/* Accounts table */}
      <SurfaceCard noPadding>
        <div className="border-b border-border/40 px-5 py-3.5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">
              {accounts.length === 0
                ? 'Sin cuentas registradas'
                : `${accounts.length} cuenta${accounts.length !== 1 ? 's' : ''}`}
            </p>
          </div>
        </div>

        {accounts.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/60">
              <Building2 className="h-5 w-5 text-muted-foreground/40" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">Sin cuentas todavía</p>
              <p className="max-w-xs text-xs text-muted-foreground">
                Todavía no hay cuentas registradas. Crea una cuenta manualmente o, más adelante,
                genera prospectos con IA.
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead>
                <tr className="border-b border-border/30">
                  {['Empresa', 'País', 'Industria', 'Dominio', 'Estado', 'Owner', 'Fuente', 'Creación'].map(
                    (col) => (
                      <th
                        key={col}
                        className="px-5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50"
                      >
                        {col}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {accounts.map((account, i) => (
                  <tr
                    key={account.id}
                    className="group border-b border-border/20 transition-colors hover:bg-accent/30 last:border-0 animate-su-slide-in"
                    style={{ animationDelay: `${i * 30}ms` }}
                  >
                    <td className="px-5 py-3.5">
                      <Link
                        href={`/accounts/${account.id}`}
                        className="font-medium text-foreground hover:text-su-brand transition-colors"
                      >
                        {account.name}
                      </Link>
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground">
                      {account.country_code ? (
                        <span className="flex items-center gap-1.5">
                          <span className="text-base leading-none">{getFlagEmoji(account.country_code)}</span>
                          <span className="text-xs">{account.country_code}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-muted-foreground">
                      {account.industry ?? <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-muted-foreground">
                      {account.domain ? (
                        <span className="font-mono">{account.domain}</span>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          STATUS_STYLES[account.pipeline_status]
                        }`}
                      >
                        {PIPELINE_STATUS_LABELS[account.pipeline_status]}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-xs text-muted-foreground">
                      {account.owner_name ?? <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className="px-5 py-3.5">
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${SOURCE_STYLES[account.source as AccountSource]}`}
                      >
                        {SOURCE_LABELS[account.source as AccountSource]}
                      </Badge>
                    </td>
                    <td className="px-5 py-3.5 text-xs text-muted-foreground">
                      {formatDate(account.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SurfaceCard>
    </div>
  );
}

function getFlagEmoji(countryCode: string): string {
  const offset = 0x1f1e6 - 'A'.charCodeAt(0);
  return [...countryCode.toUpperCase()]
    .map((c) => String.fromCodePoint(c.charCodeAt(0) + offset))
    .join('');
}
