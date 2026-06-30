import { redirect } from 'next/navigation';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { getAdminBudgetSummary } from '@/modules/budgets';
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard } from '@/components/shared/surface-card';
import { BudgetSummaryCards } from './budget-summary-cards';
import { BudgetProvidersTable } from './budget-providers-table';

export default async function BudgetCreditsPage() {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) redirect('/settings');

  const summary = await getAdminBudgetSummary();

  return (
    <div className="space-y-8 px-8 py-6">
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
    </div>
  );
}
