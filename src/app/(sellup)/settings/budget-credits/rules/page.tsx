import { redirect } from 'next/navigation';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { getBudgetRulesForAdmin, getBudgetRuleFormOptions } from '@/modules/budgets/rule-queries';
import { SurfaceCard } from '@/components/shared/surface-card';
import { LegacyCompatBanner } from '../../legacy-compat-banner';
import { BudgetRulesClient } from './budget-rules-client';

export default async function BudgetRulesPage() {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) redirect('/settings');

  const [rules, options] = await Promise.all([
    getBudgetRulesForAdmin(),
    getBudgetRuleFormOptions(),
  ]);

  return (
    <div className="space-y-6 px-8 py-6">
      <LegacyCompatBanner
        message="Esta vista sigue disponible para gestión avanzada de reglas. También puedes operar reglas desde el detalle de cada proveedor."
        ctaLabel="Ir a Proveedores y consumo"
        ctaHref="/settings/providers?tab=consumo"
      />
      <SurfaceCard>
        <div className="space-y-6 p-6">
          <BudgetRulesClient rules={rules} options={options} />
        </div>
      </SurfaceCard>
    </div>
  );
}
