import { redirect } from 'next/navigation';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { getAdminBudgetSummary } from '@/modules/budgets';
import { getBudgetRulesForAdmin, getBudgetRuleFormOptions } from '@/modules/budgets/rule-queries';
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard } from '@/components/shared/surface-card';
import { LegacyCompatBanner } from '../legacy-compat-banner';
import { BudgetSummaryCards } from './budget-summary-cards';
import { BudgetProvidersTable } from './budget-providers-table';
import { BudgetRulesTabbedSection } from './rules/budget-rules-client';

export default async function BudgetCreditsPage() {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) redirect('/settings');

  const [summary, rules, options] = await Promise.all([
    getAdminBudgetSummary(),
    getBudgetRulesForAdmin(),
    getBudgetRuleFormOptions(),
  ]);

  return (
    <div className="space-y-8 px-8 py-6">
      <LegacyCompatBanner
        message="Esta vista sigue disponible por compatibilidad. La gestión principal de cuotas, presupuesto y reglas ahora vive dentro de Proveedores y consumo."
        ctaLabel="Ir a Proveedores y consumo"
        ctaHref="/settings/providers?tab=consumo"
      />
      <PageHeader
        title="Créditos y presupuestos"
        description="Controla el consumo de herramientas con créditos, costos y reglas por proveedor."
        backHref="/settings"
      />

      <BudgetSummaryCards providers={summary.providers} />

      <SurfaceCard>
        <div className="p-1">
          <BudgetProvidersTable providers={summary.providers} resolvedAt={summary.resolvedAt} />
        </div>
      </SurfaceCard>

      <SurfaceCard>
        <div className="p-6">
          <BudgetRulesTabbedSection rules={rules} options={options} />
        </div>
      </SurfaceCard>
    </div>
  );
}
