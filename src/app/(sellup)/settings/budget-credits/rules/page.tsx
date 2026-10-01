import { redirect } from 'next/navigation';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { getBudgetRulesForAdmin, getBudgetRuleFormOptions } from '@/modules/budgets/rule-queries';
import { BudgetRulesClient } from './budget-rules-client';

export default async function BudgetRulesPage() {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) redirect('/settings');

  const [rules, options] = await Promise.all([
    getBudgetRulesForAdmin(),
    getBudgetRuleFormOptions(),
  ]);

  return <BudgetRulesClient rules={rules} options={options} />;
}
