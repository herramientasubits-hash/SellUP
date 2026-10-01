'use client';

// Agente 2A — Aviso de coincidencia dudosa de empresa en HubSpot, en la ficha de la cuenta
// (AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC, Task C1)
//
// Presentacional + una única acción de servidor (Task B5). Mismo estilo visual que
// `rollback-banner.tsx` de este mismo directorio: banner amber con icono, sin modal.

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { resolveHubSpotCompanyMatchAction } from '@/modules/accounts/hubspot-company-review-actions';

export interface PendingHubSpotCompanyMatchView {
  hubspotCompanyId: string;
  name: string | null;
  domain: string | null;
  matchMethod: string;
  confidence: number;
  reason: string;
}

interface HubSpotCompanyMatchReviewBannerProps {
  accountId: string;
  pendingMatch: PendingHubSpotCompanyMatchView | null;
}

export function HubSpotCompanyMatchReviewBanner({
  accountId,
  pendingMatch,
}: HubSpotCompanyMatchReviewBannerProps) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<'same' | 'different' | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  if (!pendingMatch) return null;

  async function resolve(decision: 'same' | 'different') {
    setBusy(decision);
    setError(null);
    try {
      const result = await resolveHubSpotCompanyMatchAction({ accountId, decision });
      if (!result.ok) {
        setError('No se pudo guardar. Intenta de nuevo.');
        return;
      }
      router.refresh();
    } catch {
      setError('No se pudo guardar. Intenta de nuevo.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Alert variant="warning">
      <AlertTitle className="text-sm">
        Podría ya existir en HubSpot como &laquo;{pendingMatch.name ?? 'empresa sin nombre'}
        &raquo;
        {pendingMatch.domain ? ` (${pendingMatch.domain})` : ''}
      </AlertTitle>
      <AlertDescription className="text-xs leading-relaxed text-warning/80">
        Coincidencia por {pendingMatch.matchMethod}, confianza {pendingMatch.confidence}%.
        &iquest;Es la misma empresa?
      </AlertDescription>
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            disabled={busy !== null}
            onClick={() => void resolve('same')}
          >
            {busy === 'same' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            Sí, es la misma
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => void resolve('different')}
          >
            {busy === 'different' && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            )}
            No, es una empresa nueva
          </Button>
        </div>
        {error && <p className="text-xs font-medium text-destructive">{error}</p>}
      </div>
    </Alert>
  );
}
