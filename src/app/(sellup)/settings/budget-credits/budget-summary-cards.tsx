'use client';

import { Cpu, Activity, TrendingUp, PackageOpen } from 'lucide-react';
import { SurfaceCard } from '@/components/shared/surface-card';
import type { AdminProviderBudgetRow } from '@/modules/budgets';
import { resolveCostDisplay, toCostTruth } from '@/modules/usage-tracking/cost-display';

interface Props {
  providers: AdminProviderBudgetRow[];
}

export function BudgetSummaryCards({ providers }: Props) {
  const totalProviders = providers.length;

  // Connected = connected + active (any state that means the provider is wired up)
  const connectedProviders = providers.filter(
    (p) => p.measurementStatus === 'connected' || p.measurementStatus === 'active',
  );

  // Active (have tracked consumption)
  const activeProviders = providers.filter((p) => p.measurementStatus === 'active');

  const totalCredits = activeProviders.reduce((acc, p) => acc + p.consumedCredits, 0);
  const totalUsd = activeProviders.reduce((acc, p) => acc + p.consumedUsd, 0);
  const consumptionHasUnknownCost = activeProviders.some((p) => p.hasUnknownCost);

  const usdDisplay =
    totalUsd > 0 || consumptionHasUnknownCost
      ? resolveCostDisplay({
          valueUsd: totalUsd,
          costTruth: toCostTruth(consumptionHasUnknownCost),
          formatUsd: (v) => `$${v.toFixed(2)} USD`,
        })
      : null;

  const consumptionLabel = [
    totalCredits > 0 ? `${totalCredits.toLocaleString()} cr` : null,
    usdDisplay?.label ?? null,
  ]
    .filter(Boolean)
    .join(' · ') || '—';
  const consumptionDescription = usdDisplay?.description ?? undefined;

  // Sin cuota: connected/active providers that should have allowance but don't
  // Exclude not_measured (samu_ia, etc.) and prepared (not connected)
  const withoutAllowance = connectedProviders.filter(
    (p) =>
      p.providerMonthlyCreditsAllowance == null &&
      p.providerMonthlyUsdAllowance == null,
  ).length;

  const cards: {
    label: string;
    value: string;
    titleAttr?: string;
    icon: typeof Cpu;
    color: string;
    bg: string;
  }[] = [
    {
      label: 'Proveedores en catálogo',
      value: String(totalProviders),
      icon: Cpu,
      color: 'text-su-brand',
      bg: 'bg-su-brand-soft',
    },
    {
      label: 'Conectados',
      value: String(connectedProviders.length),
      icon: Activity,
      color: 'text-emerald-500',
      bg: 'bg-emerald-500/10',
    },
    {
      label: 'Consumo del mes',
      value: consumptionLabel,
      titleAttr: consumptionDescription,
      icon: TrendingUp,
      color: 'text-amber-500',
      bg: 'bg-amber-500/10',
    },
    {
      label: 'Sin cuota configurada',
      value: String(withoutAllowance),
      icon: PackageOpen,
      color: withoutAllowance > 0 ? 'text-amber-500' : 'text-muted-foreground',
      bg: withoutAllowance > 0 ? 'bg-amber-500/10' : 'bg-muted/30',
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <SurfaceCard key={card.label} className="flex items-center gap-4 p-4">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${card.bg} ${card.color}`}>
            <card.icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{card.label}</p>
            <p className="truncate text-lg font-semibold text-foreground" title={card.titleAttr}>
              {card.value}
            </p>
          </div>
        </SurfaceCard>
      ))}
    </div>
  );
}
