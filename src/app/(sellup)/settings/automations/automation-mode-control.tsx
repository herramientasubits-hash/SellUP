'use client';

import { useState, useTransition } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { updateAutomationMode } from '@/modules/automations/actions';
import type { AutomationExecutionMode } from '@/modules/automations/types';
import { EXECUTION_MODE_LABELS } from '@/modules/automations/types';
import { AlertTriangle } from "@/icons";

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
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [isPending, startTransition] = useTransition();

  function showToast(message: string, type: 'success' | 'error') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }

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
        showToast(`Modo actualizado a "${EXECUTION_MODE_LABELS[next]}"`, 'success');
      } else {
        showToast(result.error ?? 'Error al actualizar el modo', 'error');
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
    <div className="relative">
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
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
              Activar modo automático
            </DialogTitle>
            <DialogDescription className="leading-relaxed">
              Al activar el modo <strong>Automático</strong> en{' '}
              <strong>&ldquo;{automationName}&rdquo;</strong>, SellUp ejecutará esta
              acción automáticamente cuando se cumpla el evento correspondiente,
              siempre que las dependencias requeridas estén disponibles.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-xl border border-warning/25 bg-warning/15 px-4 py-3 text-xs leading-relaxed text-warning">
            Asegúrate de que los proveedores requeridos por esta automatización
            estén correctamente configurados y conectados antes de activar el modo
            automático.
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" size="sm" onClick={cancelAutomatic}>
              Cancelar
            </Button>
            <Button type="button" size="sm" onClick={confirmAutomatic}>
              Activar automático
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-8 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-border/60 bg-popover px-4 py-3 text-sm font-medium shadow-drawer ${
            toast.type === 'success' ? 'text-success' : 'text-destructive'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
