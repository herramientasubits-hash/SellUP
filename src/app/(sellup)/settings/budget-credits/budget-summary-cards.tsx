'use client';

import { Cpu, ShieldCheck, TrendingUp, AlertTriangle } from 'lucide-react';
import { SurfaceCard } from '@/components/shared/surface-card';
import type { AdminProviderBudgetRow } from '@/modules/budgets';

interface Props {
  providers: AdminProviderBudgetRow[];
}

export function BudgetSummaryCards({ providers }: Props) {
  const totalProviders = providers.length;
  const withRules = providers.filter((p) => p.activeRules > 0).length;
  const withoutGlobalRule = providers.filter((p) => p.globalLimitCredits == null && p.globalLimitUsd == null).length;

  const totalCredits = providers.reduce((acc, p) => acc + p.consumedCredits, 0);
  const totalUsd = providers.reduce((acc, p) => acc + p.consumedUsd, 0);

  const consumptionLabel = [
    totalCredits > 0 ? `${totalCredits.toLocaleString()} créditos` : null,
    totalUsd > 0 ? `$${totalUsd.toFixed(2)} USD` : null,
  ]
    .filter(Boolean)
    .join(' · ') || '—';

  const cards = [
    {
      label: 'Proveedores activos',
      value: String(totalProviders),
      icon: Cpu,
      color: 'text-su-brand',
      bg: 'bg-su-brand-soft',
    },
    {
      label: 'Con reglas activas',
      value: String(withRules),
      icon: ShieldCheck,
      color: 'text-emerald-500',
      bg: 'bg-emerald-500/10',
    },
    {
      label: 'Consumo estimado del mes',
      value: consumptionLabel,
      icon: TrendingUp,
      color: 'text-amber-500',
      bg: 'bg-amber-500/10',
    },
    {
      label: 'Sin regla global',
      value: String(withoutGlobalRule),
      icon: AlertTriangle,
      color: withoutGlobalRule > 0 ? 'text-amber-500' : 'text-muted-foreground',
      bg: withoutGlobalRule > 0 ? 'bg-amber-500/10' : 'bg-muted/30',
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
            <p className="truncate text-lg font-semibold text-foreground">{card.value}</p>
          </div>
        </SurfaceCard>
      ))}
    </div>
  );
}
