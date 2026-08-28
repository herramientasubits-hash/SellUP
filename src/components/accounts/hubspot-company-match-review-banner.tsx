'use client';

// Agente 2A — Aviso de coincidencia dudosa de empresa en HubSpot, en la ficha de la cuenta
// (AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC, Task C1)
//
// Presentacional + una única acción de servidor (Task B5). Mismo estilo visual que
// `rollback-banner.tsx` de este mismo directorio: banner amber con icono, sin modal.

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2 } from 'lucide-react';
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

  if (!pendingMatch) return null;

  async function resolve(decision: 'same' | 'different') {
    setBusy(decision);
    try {
      await resolveHubSpotCompanyMatchAction({ accountId, decision });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3.5">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
          Podría ya existir en HubSpot como &laquo;{pendingMatch.name ?? 'empresa sin nombre'}
          &raquo;
          {pendingMatch.domain ? ` (${pendingMatch.domain})` : ''}
        </p>
        <p className="text-xs text-amber-700/80 dark:text-amber-300/80 leading-relaxed">
          Coincidencia por {pendingMatch.matchMethod}, confianza {pendingMatch.confidence}%.
          &iquest;Es la misma empresa?
        </p>
        <div className="flex gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            disabled={busy !== null}
            onClick={() => void resolve('same')}
          >
            {busy === 'same' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Sí, es la misma
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => void resolve('different')}
          >
            {busy === 'different' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            No, es una empresa nueva
          </Button>
        </div>
      </div>
    </div>
  );
}
