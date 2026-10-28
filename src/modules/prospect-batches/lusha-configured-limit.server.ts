import { checkConfiguredProviderLimit } from '@/modules/budgets/budget-resolution';
import { configuredLimitMessage } from '@/modules/budgets/configured-limit-gate';
import type { WizardBudgetPeriodSnapshot } from '@/modules/prospect-batches/chat-wizard-execution/wizard-budget-reservations';

/**
 * Antes de reservar Lusha (dueña 28-10): ¿lo permiten sus créditos y los límites
 * de Configuración › Proveedores? `null` = sí, sigue a la reserva. Si no se pudo
 * leer, no se gasta (falla cerrado). La reserva ya no pone topes propios: sólo
 * lleva la cuenta de lo reservado y lo gastado.
 */
export async function lushaConfiguredLimitBlock(
  userId: string,
  requiredCredits: number,
): Promise<{
  status: 'blocked';
  code: 'BUDGET_EXCEEDED' | 'BUDGET_RESERVATION_FAILED';
  message: string;
  budgetSnapshot: WizardBudgetPeriodSnapshot | null;
} | null> {
  let decision;
  try {
    decision = await checkConfiguredProviderLimit('lusha', userId, requiredCredits);
  } catch {
    return {
      status: 'blocked',
      code: 'BUDGET_RESERVATION_FAILED',
      message: 'No pudimos revisar los límites de créditos de Lusha.',
      budgetSnapshot: null,
    };
  }
  if (decision.status === 'available') return null;
  const available = decision.availableCredits;
  return {
    status: 'blocked',
    code: 'BUDGET_EXCEEDED',
    message: configuredLimitMessage('lusha', decision),
    budgetSnapshot: { budgetCredits: available, creditsConsumed: 0, creditsReserved: 0, availableCredits: available },
  };
}
