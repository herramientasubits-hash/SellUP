'use client';

/**
 * wizard-auto-provider-notice.tsx — «Cómo va a buscar» en modo automático.
 *
 * AGENT1-AUTO-PROVIDER-CASCADE-1. Con `ENABLE_AGENT1_AUTO_PROVIDER_CASCADE` la
 * usuaria ya no elige proveedor: el Agente 1 busca con Apollo y, si no completa
 * el objetivo, sigue con Lusha. Esta nota dice ESO antes del clic, y dice también
 * cuándo Lusha no va a poder entrar porque no hay créditos internos: prometer un
 * respaldo que no puede correr sería mentir sobre lo que va a pasar.
 *
 * Sólo informa: no ejecuta, no reserva y no retira ninguna oferta.
 */

import { Layers } from 'lucide-react';
import {
  resolveLushaPreExecutionBudgetBlock,
  type WizardBudgetPreflight,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-budget-preflight';

export const AUTO_PROVIDER_NOTICE_TITLE = 'Búsqueda automática';
export const AUTO_PROVIDER_NOTICE_BODY =
  'Busca primero con Apollo. Si no alcanza el objetivo, completa automáticamente con Lusha.';
export const AUTO_PROVIDER_NOTICE_LUSHA_UNAVAILABLE =
  'Este mes no quedan créditos internos para Lusha: si Apollo no alcanza el objetivo, la búsqueda terminará sólo con lo que encuentre Apollo.';

export function WizardAutoProviderNotice({
  budgetPreflight,
  lushaMacroIndustryKey,
}: {
  budgetPreflight: WizardBudgetPreflight | null;
  /** Macro de la búsqueda si Lusha la cubre; `null` ⇒ Lusha no entraría igual. */
  lushaMacroIndustryKey: string | null;
}) {
  // ¿El respaldo podrá correr? El MISMO resolutor plan-aware que el panel de
  // Lusha. Sin instantánea del período no se afirma que no.
  const lushaBackupBlocked =
    lushaMacroIndustryKey !== null &&
    resolveLushaPreExecutionBudgetBlock(budgetPreflight, lushaMacroIndustryKey) !== null;

  return (
    <div
      className="flex items-start gap-3 rounded-xl border border-border bg-su-brand-soft px-4 py-3"
      data-testid="wizard-auto-provider-notice"
    >
      <Layers className="mt-0.5 h-4 w-4 shrink-0 text-su-brand" aria-hidden />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-foreground">{AUTO_PROVIDER_NOTICE_TITLE}</p>
        <p className="text-xs text-muted-foreground">{AUTO_PROVIDER_NOTICE_BODY}</p>
        {lushaBackupBlocked && (
          <p className="text-xs text-amber-500" data-testid="wizard-auto-provider-lusha-blocked">
            {AUTO_PROVIDER_NOTICE_LUSHA_UNAVAILABLE}
          </p>
        )}
      </div>
    </div>
  );
}
