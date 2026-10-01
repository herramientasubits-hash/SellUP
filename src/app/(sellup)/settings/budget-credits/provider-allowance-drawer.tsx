'use client';

import { useState, useTransition } from 'react';
import { Wallet, Coins, Landmark } from 'lucide-react';
import { DrawerShell } from '@/components/shared/drawer-shell';
import { DrawerSection } from '@/components/shared/drawer-section';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updateProviderAllowance, useApiQuotaAsPrimary } from '@/modules/budgets';
import type { AdminProviderBudgetRow } from '@/modules/budgets';
import { toast } from 'sonner';

// Anthropic is intentionally excluded: it has no documented endpoint for
// monthly credits/allowance, only historical USD cost via a separate Admin
// API key that SellUp does not yet integrate. See the Claude USD note below
// for the manual-budget explanation shown instead.
const SYNCABLE_PROVIDERS = new Set(['tavily', 'lusha']);
/** Proveedores que se miden principalmente en USD, no en créditos */
const USD_PRIMARY_PROVIDERS = new Set(['anthropic']);

interface Props {
  provider: AdminProviderBudgetRow | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

// ── Quota source section ──────────────────────────────────────────────────────

interface QuotaSourceSectionProps {
  provider: AdminProviderBudgetRow;
  isPendingApiSwitch: boolean;
  apiSwitchError: string | null;
  onUseApi: () => void;
}

function QuotaSourceSection({
  provider,
  isPendingApiSwitch,
  apiSwitchError,
  onUseApi,
}: QuotaSourceSectionProps) {
  const isSyncable = SYNCABLE_PROVIDERS.has(provider.providerKey);
  const source = provider.quotaSource;
  const hasExternalData =
    provider.creditsRemainingExternal != null && provider.quotaSyncedAt != null;

  let sourceLabel = 'No configurado';
  let sourceDescription = 'La cuota de este proveedor no ha sido configurada.';
  if (source === 'manual') {
    sourceLabel = 'Manual';
    sourceDescription = 'La cuota principal fue configurada por un admin.';
  } else if (source === 'api_synced') {
    sourceLabel = 'API synced';
    sourceDescription = 'La cuota principal viene de la API del proveedor.';
  } else if (source === 'sync_error') {
    sourceLabel = 'Error de sync';
    sourceDescription = 'El último intento de sincronización falló.';
  }

  return (
    <DrawerSection title="Fuente de cuota" icon={Coins} contentClassName="space-y-2.5">
      <div className="space-y-0.5">
        <p className="text-xs font-medium text-foreground">Fuente actual: {sourceLabel}</p>
        <p className="text-xs text-muted-foreground">{sourceDescription}</p>
      </div>

      {/* Manual con dato externo disponible → ofrecer usar API */}
      {source === 'manual' && hasExternalData && isSyncable && (
        <div className="pt-1 space-y-1">
          <p className="text-xs text-muted-foreground">
            Dato API disponible como referencia ({provider.creditsRemainingExternal?.toLocaleString()} cr restantes).
          </p>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={onUseApi}
            disabled={isPendingApiSwitch}
          >
            {isPendingApiSwitch ? 'Cambiando…' : 'Usar cuota API como principal'}
          </Button>
        </div>
      )}

      {/* No configurado + syncable → ofrecer sincronizar y usar API */}
      {source === null && isSyncable && (
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={onUseApi}
          disabled={isPendingApiSwitch}
        >
          {isPendingApiSwitch ? 'Sincronizando…' : 'Sincronizar y usar API'}
        </Button>
      )}

      {/* API synced → instrucción para volver a manual */}
      {source === 'api_synced' && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          Para usar valor manual, ingresa créditos o USD en el formulario y guarda.
        </p>
      )}

      {apiSwitchError && (
        <Alert variant="destructive">
          <AlertDescription>{apiSwitchError}</AlertDescription>
        </Alert>
      )}
    </DrawerSection>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

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
  const [isApiSwitchPending, startApiSwitchTransition] = useTransition();
  const [apiSwitchError, setApiSwitchError] = useState<string | null>(null);

  // Sync form state when provider changes
  const prevProviderKey = useState<string | null>(null);
  if (provider && provider.providerKey !== prevProviderKey[0]) {
    prevProviderKey[1](provider.providerKey);
    setCredits(provider.providerMonthlyCreditsAllowance?.toString() ?? '');
    setUsd(provider.providerMonthlyUsdAllowance?.toString() ?? '');
    setError(null);
    setApiSwitchError(null);
  }

  function handleUseApi() {
    if (!provider) return;
    setApiSwitchError(null);
    startApiSwitchTransition(async () => {
      try {
        const result = await useApiQuotaAsPrimary(provider.providerKey);
        if (!result.success) {
          setApiSwitchError(result.error ?? 'No se pudo cambiar a cuota API.');
          return;
        }
        toast.success('Cuota API establecida como fuente principal');
        onSaved();
        onClose();
      } catch {
        setApiSwitchError('Error inesperado al cambiar la fuente de cuota.');
      }
    });
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
      icon={<Wallet className="h-4 w-4 text-primary" />}
      actions={
        <>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            disabled={isPending || isNotApplicable}
          >
            {isPending ? 'Guardando…' : 'Guardar'}
          </Button>
        </>
      }
    >
      {provider && (
        <div className="space-y-4">
          {/* Quota source section */}
          {provider.measurementStatus !== 'not_measured' && (
            <QuotaSourceSection
              provider={provider}
              isPendingApiSwitch={isApiSwitchPending}
              apiSwitchError={apiSwitchError}
              onUseApi={handleUseApi}
            />
          )}

          {/* Info box */}
          <DrawerSection title="Bolsa externa contratada" icon={Landmark} tone="neutral">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Estos valores representan la cuota mensual del proveedor (créditos o USD
              contratados). No son reglas de bloqueo de SellUp — solo sirven para
              visualizar el disponible real frente al consumo.
            </p>
          </DrawerSection>

          {/* Claude USD note — Anthropic se mide en USD, no en créditos */}
          {provider && USD_PRIMARY_PROVIDERS.has(provider.providerKey) && !isNotApplicable && (
            <Alert variant="info">
              <AlertTitle>
                Claude se mide principalmente en USD/tokens, no en créditos.
              </AlertTitle>
              <AlertDescription>
                <p>
                  Configura el presupuesto mensual USD. El campo de créditos no aplica para este proveedor.
                </p>
                <p>
                  Anthropic requiere una Admin API key para sincronizar costo USD. Mientras
                  tanto, configura el presupuesto mensual de forma manual.
                </p>
              </AlertDescription>
            </Alert>
          )}

          {isNotApplicable ? (
            <EmptyState title="Este proveedor no aplica configuración de cuota por ahora." />
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="credits-allowance">
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
                />
                <p className="text-xs text-muted-foreground">
                  Dejar vacío para &quot;No configurado&quot;.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="usd-allowance">
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
                />
                <p className="text-xs text-muted-foreground">
                  Útil para modelos LLM. Dejar vacío para &quot;No configurado&quot;.
                </p>
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </div>
      )}
    </DrawerShell>
  );
}
