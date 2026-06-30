import { redirect } from 'next/navigation';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { getBudgetRulesForAdmin, getBudgetRuleFormOptions } from '@/modules/budgets/rule-queries';
import { SurfaceCard } from '@/components/shared/surface-card';
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
      <SurfaceCard>
        <div className="space-y-6 p-6">
          <BudgetRulesClient rules={rules} options={options} />
        </div>
      </SurfaceCard>
    </div>
  );
}
