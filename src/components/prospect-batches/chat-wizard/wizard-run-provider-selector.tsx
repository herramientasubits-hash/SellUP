'use client';

/**
 * wizard-run-provider-selector.tsx — «Proveedor de esta corrida».
 *
 * A1-APOLLO-QA-CONTROL-SURFACE-1 · § 2, § 3, § 4 y § 5.
 *
 * Superficie administrativa mínima para fijar el proveedor de UNA ejecución sin
 * mover el proveedor global de Producción.
 *
 * Componente tonto: no lee flags, no consulta roles, no conoce env. Recibe la
 * capacidad YA SANITIZADA por el servidor y la pinta. Que este control se
 * renderice NO autoriza nada: la ejecución vuelve a derivar sesión, rol, flags y
 * kill switch server-side (§ 7).
 *
 * Se monta sólo con `canSelectDiscoveryProvider: true`. Para cualquier otro
 * usuario —commercial_manager, seller_bd, no autenticado— el control no existe en
 * el árbol, no está simplemente oculto por CSS.
 */

import * as React from 'react';
import { Info } from 'lucide-react';
import {
  WIZARD_RUN_SELECTABLE_PROVIDERS,
  isProviderOptionEnabled,
  type WizardProviderOverrideCapability,
  type WizardRunSelectableProvider,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-run-provider-capability';
import {
  APOLLO_RUN_OPTION_UNAVAILABLE_NOTICE,
  RUN_PROVIDER_OPTION_LABELS,
  RUN_PROVIDER_SECTION_TITLE,
  buildApolloRunModeCopy,
  type ApolloRunModeLimits,
} from './wizard-run-provider-copy';

type WizardRunProviderSelectorProps = {
  capability: WizardProviderOverrideCapability;
  /** Selección actual. El default del wizard es siempre Tavily (§ 3). */
  value: WizardRunSelectableProvider;
  onChange: (provider: WizardRunSelectableProvider) => void;
  /**
   * Topes efectivos de la modalidad de dos rondas, resueltos server-side.
   * `null` = no llegaron; entonces no se anuncia ninguna cifra en vez de
   * inventar los defaults del código.
   */
  apolloLimits: ApolloRunModeLimits | null;
  /** Bloquea el control mientras una ejecución está en vuelo. */
  disabled?: boolean;
};

export function WizardRunProviderSelector({
  capability,
  value,
  onChange,
  apolloLimits,
  disabled = false,
}: WizardRunProviderSelectorProps) {
  // Sin capacidad no hay control. El return temprano es la garantía estructural:
  // no hay rama de render en la que un no-admin vea estas opciones.
  if (!capability.canSelectDiscoveryProvider) return null;

  const apolloSelected = value === 'apollo_organizations';
  const apolloCopy =
    apolloSelected && apolloLimits !== null ? buildApolloRunModeCopy(apolloLimits) : null;

  return (
    <fieldset
      className="space-y-2 rounded-xl border border-border bg-card px-4 py-3"
      data-testid="wizard-run-provider-selector"
    >
      <legend className="px-1 text-xs font-semibold text-foreground">
        {RUN_PROVIDER_SECTION_TITLE}
      </legend>

      <div className="space-y-1.5">
        {WIZARD_RUN_SELECTABLE_PROVIDERS.map((provider) => {
          const optionEnabled = isProviderOptionEnabled(capability, provider);
          const inputDisabled = disabled || !optionEnabled;
          return (
            <label
              key={provider}
              className={
                inputDisabled
                  ? 'flex cursor-not-allowed items-center gap-2 rounded-md px-1 py-1 text-xs text-muted-foreground opacity-70'
                  : 'flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-xs text-foreground transition-colors hover:bg-muted/50'
              }
            >
              <input
                type="radio"
                name="wizard-run-discovery-provider"
                value={provider}
                checked={value === provider}
                disabled={inputDisabled}
                // El `disabled` del input es la primera defensa, pero no la
                // única: este control decide si una corrida puede gastar créditos
                // de Apollo, y un candado que depende de que el entorno respete
                // `disabled` no es un candado. La guarda se repite aquí.
                onChange={() => {
                  if (inputDisabled) return;
                  onChange(provider);
                }}
                className="size-3.5 accent-su-brand"
              />
              <span className="font-medium">{RUN_PROVIDER_OPTION_LABELS[provider]}</span>
            </label>
          );
        })}
      </div>

      {/* § 4 — explicación sanitizada. No nombra la variable apagada ni su valor:
          un administrador necesita saber que no puede usar Apollo ahora, no cuál
          de los tres candados lo impide. */}
      {!isProviderOptionEnabled(capability, 'apollo_organizations') && (
        <p
          className="flex items-start gap-1.5 text-xs text-muted-foreground"
          data-testid="wizard-run-provider-apollo-unavailable"
        >
          <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          {APOLLO_RUN_OPTION_UNAVAILABLE_NOTICE}
        </p>
      )}

      {/* § 5 — qué significa elegir Apollo, con los topes reales de la corrida. */}
      {apolloCopy && (
        <div
          className="space-y-1.5 rounded-md bg-su-brand-soft px-3 py-2"
          data-testid="wizard-run-provider-apollo-mode"
        >
          <p className="text-xs text-foreground">{apolloCopy.headline}</p>
          <p className="text-xs font-medium text-foreground">{apolloCopy.limitsTitle}</p>
          <ul className="space-y-0.5">
            {apolloCopy.limits.map((limit) => (
              <li key={limit} className="text-xs text-muted-foreground">
                • {limit}
              </li>
            ))}
          </ul>
          {apolloCopy.caveats.map((caveat) => (
            <p key={caveat} className="text-xs text-muted-foreground">
              {caveat}
            </p>
          ))}
        </div>
      )}
    </fieldset>
  );
}
