'use client';

/**
 * AGENT1-TAVILY-TRIAL-1 — casilla «Probar esta corrida con Tavily».
 *
 * Sólo la ve un administrador con `ENABLE_AGENT1_ADMIN_TAVILY_TRIAL` encendida y
 * el modo automático activo (lo resuelve el servidor: `available`). Marcada, la
 * corrida pide `tavily`; desmarcada, no se envía nada y manda el modo
 * automático. El servidor vuelve a exigir el rol admin: esta casilla es sólo la
 * superficie, no la autorización.
 */

import { FlaskConical } from "@/icons";

import { Checkbox } from '@/components/ui/checkbox';

export const ADMIN_TAVILY_TRIAL_LABEL = 'Probar esta corrida con Tavily';
export const ADMIN_TAVILY_TRIAL_HINT =
  'Sólo para administradores. Esta corrida usa Tavily en vez de Apollo y no activa Lusha. Los vendedores siguen con el modo automático.';

export type WizardAdminTavilyTrialToggleProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

export function WizardAdminTavilyTrialToggle({ checked, onCheckedChange }: WizardAdminTavilyTrialToggleProps) {
  return (
    <div className="rounded-xl border border-su-brand/30 bg-su-brand-soft/40 p-3">
      <div className="flex items-start gap-2.5">
        <Checkbox
          id="admin-tavily-trial"
          checked={checked}
          onCheckedChange={(value) => onCheckedChange(value === true)}
          className="mt-0.5 shrink-0"
        />
        <label htmlFor="admin-tavily-trial" className="cursor-pointer space-y-0.5">
          <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <FlaskConical className="h-3.5 w-3.5 text-su-brand" aria-hidden />
            {ADMIN_TAVILY_TRIAL_LABEL}
          </span>
          <span className="block text-xs text-muted-foreground">{ADMIN_TAVILY_TRIAL_HINT}</span>
        </label>
      </div>
    </div>
  );
}
