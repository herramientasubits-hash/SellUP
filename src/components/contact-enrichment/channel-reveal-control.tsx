'use client';

/**
 * Botón «Revelar LinkedIn» / «Revelar correo» con su costo y su desenlace
 * (AGENT2A-HUBSPOT-CANDIDATE-IDENTITY-COMPLETION). Presentacional: el gasto lo decide el
 * servidor. Lo usan la ficha del candidato y la del contacto que nació de él
 * (AGENT2A-HUBSPOT-IMPORT-APPROVED-CANDIDATE).
 */

import * as React from 'react';
import { Loader2 } from '@/icons';
import { Button } from '@/components/ui/button';

export function ChannelRevealControl({
  offer,
  label,
  helper,
  icon: Icon,
  running,
  disabled,
  message,
  onReveal,
}: {
  offer: boolean;
  label: string;
  helper: string;
  icon: React.ComponentType<{ className?: string }>;
  running: boolean;
  disabled: boolean;
  message: { tone: 'success' | 'info' | 'error'; text: string } | null;
  onReveal: () => void;
}) {
  return (
    <span className="flex flex-col items-start gap-1.5">
      {offer && (
        <>
          <Button type="button" variant="outline" size="xs" className="gap-1.5" disabled={disabled} onClick={onReveal}>
            {running ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Buscando…
              </>
            ) : (
              <>
                <Icon className="h-3.5 w-3.5" />
                {label}
              </>
            )}
          </Button>
          <span className="text-xs text-muted-foreground">{helper}</span>
        </>
      )}
      {message && (
        <span className={message.tone === 'error' ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
          {message.text}
        </span>
      )}
    </span>
  );
}
