'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import type { BudgetRuleRow } from '@/modules/budgets/rule-queries';

export interface DeleteBudgetRuleDialogProps {
  /** La regla por la que se pregunta. `null` mantiene el diálogo cerrado. */
  rule: BudgetRuleRow | null;
  /** El borrado está en curso: bloquea los dos botones. */
  deleting: boolean;
  /** Por qué falló el último intento, si falló. */
  error: string | null;
  /** Se llama SOLO al pulsar «Eliminar regla». Abrir o cancelar no borra. */
  onConfirm: (rule: BudgetRuleRow) => void;
  onCancel: () => void;
}

/**
 * La pregunta antes de borrar una regla de presupuesto. No borra nada por sí
 * sola ni se cierra sola: quien la usa ejecuta el borrado en `onConfirm` y la
 * cierra (pasando `rule={null}`) cuando termina bien.
 */
export function DeleteBudgetRuleDialog({
  rule,
  deleting,
  error,
  onConfirm,
  onCancel,
}: DeleteBudgetRuleDialogProps) {
  return (
    <ConfirmDialog
      open={rule !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      variant="destructive"
      title="¿Eliminar esta regla?"
      description={
        rule && (
          <>
            La regla de <span className="font-medium text-foreground">{rule.providerDisplayName}</span>{' '}
            ({rule.scopeLabel}) dejará de aplicarse. El consumo y los avisos ya registrados se conservan.
            {error && (
              <Alert variant="destructive" className="mt-3 text-left">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </>
        )
      }
      confirmLabel="Eliminar regla"
      loading={deleting}
      onConfirm={() => {
        if (rule) onConfirm(rule);
      }}
    />
  );
}
