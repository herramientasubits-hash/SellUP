'use client';

import { useState, useTransition } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { updateAutomationMode } from '@/modules/automations/actions';
import type { AutomationExecutionMode } from '@/modules/automations/types';
import { EXECUTION_MODE_LABELS } from '@/modules/automations/types';

interface AutomationModeControlProps {
  automationId: string;
  automationName: string;
  currentMode: AutomationExecutionMode;
  onModeChange?: (mode: AutomationExecutionMode) => void;
}

export function AutomationModeControl({
  automationId,
  automationName,
  currentMode,
  onModeChange,
}: AutomationModeControlProps) {
  const [mode, setMode] = useState<AutomationExecutionMode>(currentMode);
  const [pendingMode, setPendingMode] = useState<AutomationExecutionMode | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleModeChange(value: string | null) {
    if (!value) return;
    const next = value as AutomationExecutionMode;
    if (next === mode) return;

    if (next === 'automatic') {
      setPendingMode(next);
      setShowConfirm(true);
    } else {
      applyMode(next);
    }
  }

  function applyMode(next: AutomationExecutionMode) {
    startTransition(async () => {
      const result = await updateAutomationMode(automationId, next);
      if (result.success) {
        setMode(next);
        onModeChange?.(next);
        toast.success(`«${automationName}» ahora está en modo ${EXECUTION_MODE_LABELS[next]}.`);
      } else {
        toast.error(result.error ?? 'No se pudo cambiar el modo. Inténtalo de nuevo.');
      }
    });
  }

  function confirmAutomatic() {
    if (!pendingMode) return;
    setShowConfirm(false);
    applyMode(pendingMode);
    setPendingMode(null);
  }

  function cancelAutomatic() {
    setPendingMode(null);
    setShowConfirm(false);
  }

  return (
    <div>
      <Select
        value={mode}
        onValueChange={handleModeChange}
        disabled={isPending}
      >
        <SelectTrigger
          size="sm"
          className="w-36"
          aria-label={`Modo de ejecución para ${automationName}`}>
          <SelectValue>{EXECUTION_MODE_LABELS[mode]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="manual">
            Manual
          </SelectItem>
          <SelectItem value="suggested">
            Sugerido
          </SelectItem>
          <SelectItem value="automatic">
            Automático
          </SelectItem>
        </SelectContent>
      </Select>

      {/* Confirmación para modo automático */}
      <ConfirmDialog
        open={showConfirm}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) cancelAutomatic();
        }}
        variant="warning"
        title="¿Activar el modo automático?"
        description={
          <>
            Con <strong>&ldquo;{automationName}&rdquo;</strong> en <strong>Automático</strong>,
            SellUp hará esta acción por su cuenta cada vez que ocurra el evento que la dispara.
            Antes de activarlo, comprueba que los proveedores que necesita estén conectados.
          </>
        }
        confirmLabel="Activar automático"
        onConfirm={confirmAutomatic}
      />
    </div>
  );
}
