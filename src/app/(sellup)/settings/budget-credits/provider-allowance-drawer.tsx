'use client';

import { useState, useTransition } from 'react';
import { Wallet } from 'lucide-react';
import { DrawerShell } from '@/components/shared/drawer-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updateProviderAllowance } from '@/modules/budgets';
import type { AdminProviderBudgetRow } from '@/modules/budgets';

interface Props {
  provider: AdminProviderBudgetRow | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

function parseOptionalNumeric(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === '-') return null;
  const n = Number(trimmed);
  return isNaN(n) ? null : n;
}

export function ProviderAllowanceDrawer({ provider, open, onClose, onSaved }: Props) {
  const [credits, setCredits] = useState('');
  const [usd, setUsd] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Sync form state when provider changes
  const prevProviderKey = useState<string | null>(null);
  if (provider && provider.providerKey !== prevProviderKey[0]) {
    prevProviderKey[1](provider.providerKey);
    setCredits(provider.providerMonthlyCreditsAllowance?.toString() ?? '');
    setUsd(provider.providerMonthlyUsdAllowance?.toString() ?? '');
    setError(null);
  }

  const isNotApplicable = provider?.measurementStatus === 'not_measured';

  function handleSave() {
    if (!provider) return;
    setError(null);

    const creditsVal = parseOptionalNumeric(credits);
    const usdVal = parseOptionalNumeric(usd);

    if (creditsVal !== null && creditsVal < 0) {
      setError('Los créditos no pueden ser negativos.');
      return;
    }
    if (usdVal !== null && usdVal < 0) {
      setError('El presupuesto USD no puede ser negativo.');
      return;
    }

    startTransition(async () => {
      const result = await updateProviderAllowance(provider.providerKey, creditsVal, usdVal);
      if (!result.success) {
        setError(result.error ?? 'Error desconocido.');
        return;
      }
      onSaved();
      onClose();
    });
  }

  return (
    <DrawerShell
      open={open}
      onOpenChange={(v) => { if (!v) onClose(); }}
      size="md"
      title={`Editar cuota — ${provider?.displayName ?? provider?.providerKey ?? ''}`}
      description="Configura la bolsa mensual contratada con el proveedor."
      icon={<Wallet className="h-4 w-4 text-su-brand" />}
      footer={
        <div className="shrink-0 flex items-center justify-end gap-3 border-t border-border/50 bg-muted/20 px-7 py-4">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isPending || isNotApplicable}
          >
            {isPending ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      }
    >
      {provider && (
        <div className="space-y-5">
          {/* Info box */}
          <div className="rounded-lg border border-border/40 bg-muted/10 px-4 py-3 space-y-1">
            <p className="text-xs font-medium text-foreground">
              Bolsa externa contratada
            </p>
            <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
              Estos valores representan la cuota mensual del proveedor (créditos o USD
              contratados). No son reglas de bloqueo de SellUp — solo sirven para
              visualizar el disponible real frente al consumo.
            </p>
          </div>

          {isNotApplicable ? (
            <div className="rounded-lg border border-border/30 bg-muted/10 px-4 py-6 text-center">
              <p className="text-sm text-muted-foreground">
                Este proveedor no aplica configuración de cuota por ahora.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="credits-allowance" className="text-xs">
                  Créditos mensuales del proveedor
                </Label>
                <Input
                  id="credits-allowance"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="Ej: 500"
                  value={credits}
                  onChange={(e) => setCredits(e.target.value)}
                  className="text-sm"
                />
                <p className="text-[10px] text-muted-foreground/60">
                  Dejar vacío para &quot;No configurado&quot;.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="usd-allowance" className="text-xs">
                  Presupuesto mensual USD
                </Label>
                <Input
                  id="usd-allowance"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Ej: 50.00"
                  value={usd}
                  onChange={(e) => setUsd(e.target.value)}
                  className="text-sm"
                />
                <p className="text-[10px] text-muted-foreground/60">
                  Útil para modelos LLM. Dejar vacío para &quot;No configurado&quot;.
                </p>
              </div>

              {error && (
                <div className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2">
                  <p className="text-xs text-destructive">{error}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </DrawerShell>
  );
}
