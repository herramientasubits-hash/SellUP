import { redirect } from 'next/navigation';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { getAdminBudgetSummary } from '@/modules/budgets';
import { getBudgetRulesForAdmin, getBudgetRuleFormOptions } from '@/modules/budgets/rule-queries';
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard } from '@/components/shared/surface-card';
import { BudgetSummaryCards } from '../budget-credits/budget-summary-cards';
import { BudgetProvidersTable } from '../budget-credits/budget-providers-table';
import { BudgetRulesTabbedSection } from '../budget-credits/rules/budget-rules-client';

export default async function ProvidersConsumptionPage() {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) redirect('/settings');

  const [summary, rules, options] = await Promise.all([
    getAdminBudgetSummary(),
    getBudgetRulesForAdmin(),
    getBudgetRuleFormOptions(),
  ]);

  return (
    <div className="space-y-8 px-8 py-6">
      <PageHeader
        title="Proveedores y consumo"
        description="Configura proveedores de IA y herramientas externas, controla presupuestos, reglas y monitorea consumo mensual."
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
