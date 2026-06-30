import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Settings2 } from 'lucide-react';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { getAdminBudgetSummary } from '@/modules/budgets';
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard } from '@/components/shared/surface-card';
import { Button } from '@/components/ui/button';
import { BudgetSummaryCards } from './budget-summary-cards';
import { BudgetProvidersTable } from './budget-providers-table';

export default async function BudgetCreditsPage() {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) redirect('/settings');

  const summary = await getAdminBudgetSummary();

  return (
    <div className="space-y-8 px-8 py-6">
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          title="Créditos y presupuestos"
          description="Controla el consumo de herramientas con créditos, costos y reglas por proveedor."
          backHref="/settings"
        />
        <Link href="/settings/budget-credits/rules" className="shrink-0 mt-1">
          <Button size="sm" variant="outline" className="gap-2">
            <Settings2 className="h-3.5 w-3.5" />
            Gestionar reglas
          </Button>
        </Link>
      </div>

      <BudgetSummaryCards providers={summary.providers} />

      <SurfaceCard>
        <div className="p-1">
          <BudgetProvidersTable providers={summary.providers} resolvedAt={summary.resolvedAt} />
        </div>
      </SurfaceCard>
    </div>
  );
}
