'use client';

import { Cpu, Activity, TrendingUp, PackageOpen } from "@/icons";
import { MetricCard } from '@/components/shared/metric-card';
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
  }[] = [
    {
      label: 'Proveedores en catálogo',
      value: String(totalProviders),
      icon: Cpu,
      color: 'text-primary',
    },
    {
      label: 'Conectados',
      value: String(connectedProviders.length),
      icon: Activity,
      color: 'text-success',
    },
    {
      label: 'Consumo del mes',
      value: consumptionLabel,
      titleAttr: consumptionDescription,
      icon: TrendingUp,
      color: 'text-warning',
    },
    {
      label: 'Sin cuota configurada',
      value: String(withoutAllowance),
      icon: PackageOpen,
      color: withoutAllowance > 0 ? 'text-warning' : 'text-muted-foreground',
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <MetricCard
          key={card.label}
          title={card.label}
          value={card.value}
          hint={card.titleAttr}
          icon={<card.icon className={card.color} aria-hidden="true" />}
        />
      ))}
    </div>
  );
}
