import { redirect } from 'next/navigation';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { getAdminBudgetSummary } from '@/modules/budgets';
import { getBudgetRulesForAdmin, getBudgetRuleFormOptions } from '@/modules/budgets/rule-queries';
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard } from '@/components/shared/surface-card';
import { BudgetSummaryCards } from '../budget-credits/budget-summary-cards';
import { BudgetProvidersTable } from '../budget-credits/budget-providers-table';
import { BudgetRulesTabbedSection } from '../budget-credits/rules/budget-rules-client';
import { ProvidersTabs } from './providers-tabs';
import { AiSettingsSection } from '../ai/ai-settings-section';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ProvidersConsumptionPage({ searchParams }: PageProps) {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) redirect('/settings');

  const resolved = await searchParams;
  const defaultTab = typeof resolved.tab === 'string' ? resolved.tab : null;

  const [summary, rules, options] = await Promise.all([
    getAdminBudgetSummary(),
    getBudgetRulesForAdmin(),
    getBudgetRuleFormOptions(),
  ]);

  return (
    <div className="space-y-8 px-8 py-6">
      <PageHeader
        title="Proveedores y consumo"
        description="Administra proveedores, cuotas, presupuestos, reglas, modelos de IA y trazabilidad de consumo desde un solo lugar."
        backHref="/settings"
      />

      <ProvidersTabs
        defaultTab={defaultTab}
        consumoContent={
          <div className="space-y-8">
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
        }
        iaContent={
          <div className="space-y-6">
            <p className="text-sm text-muted-foreground">
              Administra proveedores LLM, modelos activos, tarifas por millón de tokens y configuración de conexión.
            </p>
            <AiSettingsSection />
          </div>
        }
      />
    </div>
  );
}
