'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { PhoneCall, RefreshCw } from '@/icons';
import { Button } from '@/components/ui/button';
import { firstCallHref } from '@/modules/speech/first-call-links';
import type { FirstCallContactOption } from '@/modules/speech/first-call-contacts';
import type { FirstContactSelection } from '@/modules/speech/first-contact-wizard';
import { FirstContactAgentPanel, type FirstContactRegenerateSeed } from './first-contact-agent-panel';

export type { FirstCallContactOption };
export type FirstCallRegenerateSeed = FirstContactRegenerateSeed;

/** Lo que necesita quien abre el panel por su cuenta (p. ej. la lista, al cerrar el panel lateral). */
export interface FirstContactLaunchRequest {
  accountId: string;
  accountName: string;
  contacts: readonly FirstCallContactOption[];
  hasFreshBrief: boolean;
  initialSelection?: Partial<FirstContactSelection>;
  regenerate?: FirstCallRegenerateSeed;
}

interface FirstCallLauncherProps {
  accountId: string;
  /** Nombre de la empresa: lo dice el agente. */
  accountName?: string;
  contacts: readonly FirstCallContactOption[];
  /** ¿Hay una investigación vigente? Entonces se reusa. */
  hasFreshBrief: boolean;
  defaultContactId?: string | null;
  /** Lo que llega marcado («preparar lo que falta», una celda vacía de la cobertura…). */
  initialSelection?: Partial<FirstContactSelection>;
  /** Otra versión de una preparación. */
  regenerate?: FirstCallRegenerateSeed;
  label?: string;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'sm' | 'default';
  /** Al terminar con éxito. Sin él, se recarga la página. */
  onDone?: () => void;
  /** «Ver el primer contacto». Sin él, va a la pestaña de la página de la empresa. */
  onViewResult?: () => void;
  /**
   * Para un botón dentro de otro panel lateral (el de la empresa): en vez de abrir el
   * agente aquí, se lo pide a quien lo monta, que cierra su panel primero. Así nunca
   * hay dos paneles a la vez (igual que «Buscar contactos»).
   */
  onRequestOpen?: (request: FirstContactLaunchRequest) => void;
  /** Modo controlado: quien lo monta decide cuándo se abre (sin botón propio con `hideTrigger`). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}

/**
 * «Preparar primer contacto»: abre el Agente 3 en el panel «Agente IA».
 */
export function FirstCallLauncher({
  accountId,
  accountName = 'la empresa',
  contacts,
  hasFreshBrief,
  defaultContactId = null,
  initialSelection,
  regenerate,
  label,
  variant = 'default',
  size = 'sm',
  onDone,
  onViewResult,
  onRequestOpen,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: FirstCallLauncherProps) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = React.useCallback(
    (next: boolean) => {
      setInternalOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
  const selection = React.useMemo<Partial<FirstContactSelection> | undefined>(
    () => initialSelection ?? (defaultContactId ? { contactIds: [defaultContactId] } : undefined),
    [initialSelection, defaultContactId],
  );

  const triggerLabel = label ?? (regenerate ? 'Otra versión' : 'Preparar primer contacto');
  const handleClick = () => {
    if (onRequestOpen) {
      onRequestOpen({ accountId, accountName, contacts, hasFreshBrief, initialSelection: selection, regenerate });
    } else {
      setOpen(true);
    }
  };

  return (
    <>
      {!hideTrigger && (
        <Button type="button" size={size} variant={variant} onClick={handleClick}>
          {regenerate ? <RefreshCw aria-hidden="true" /> : <PhoneCall aria-hidden="true" />}
          {triggerLabel}
        </Button>
      )}
      {!onRequestOpen && (
        <FirstContactAgentPanel
          open={open}
          onOpenChange={setOpen}
          accountId={accountId}
          accountName={accountName}
          contacts={contacts}
          hasFreshBrief={hasFreshBrief}
          initialSelection={selection}
          regenerate={regenerate}
          onDone={onDone ?? (() => router.refresh())}
          onViewResult={onViewResult ?? (() => router.push(firstCallHref(accountId)))}
        />
      )}
    </>
  );
}
