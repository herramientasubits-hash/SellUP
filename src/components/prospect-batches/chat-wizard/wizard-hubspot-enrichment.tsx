'use client';

// HUBSPOT-ENRICHMENT-REQUEST-1 — la sexta opción del Agente 1: «Enriquecer empresa de HubSpot».
// Reemplaza el «Enrichment status» que se cambiaba en HubSpot. Se pega el enlace (o el ID) de
// la empresa; si no está en SellUp se trae, se completa y queda a nombre de quien la pidió
// salvo que ya tenga responsable. Nada se escribe en HubSpot.

import * as React from 'react';
import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ChatQuestionPanel, ChatThinking } from '@/components/chat';
import {
  enrichHubSpotCompanyFromReference,
  type EnrichHubSpotCompanyFromReferenceResult,
} from '@/modules/accounts/hubspot-enrichment-request-actions';

export const HUBSPOT_ENRICHMENT_OPTION = {
  value: 'hubspot_enrichment',
  label: 'Enriquecer empresa de HubSpot',
  description: 'Pega el enlace de HubSpot: la traigo, completo sus datos y te la asigno si no tiene responsable.',
} as const;

type TitleRef = React.Ref<HTMLHeadingElement>;

type PanelState =
  | { status: 'asking'; error: string | null }
  | { status: 'running'; since: number }
  | { status: 'done'; result: Extract<EnrichHubSpotCompanyFromReferenceResult, { success: true }> };

const SUMMARY_VARIANT = { completed: 'success', partial: 'info', nothing_found: 'warning' } as const;

export function HubSpotEnrichmentPanel({ onBack, titleRef }: { onBack: () => void; titleRef: TitleRef }) {
  const [state, setState] = React.useState<PanelState>({ status: 'asking', error: null });

  const run = React.useCallback(async (text: string) => {
    setState({ status: 'running', since: Date.now() });
    try {
      const result = await enrichHubSpotCompanyFromReference(text);
      setState(result.success ? { status: 'done', result } : { status: 'asking', error: result.error });
    } catch {
      setState({ status: 'asking', error: 'No pude enriquecer la empresa. Intenta de nuevo en unos minutos.' });
    }
  }, []);

  if (state.status === 'running') {
    return <ChatThinking label="Trayendo la empresa de HubSpot y completando sus datos…" since={state.since} />;
  }

  if (state.status === 'done') {
    const { result } = state;
    return (
      <section aria-label="Resultado de enriquecer empresa" className="flex flex-col gap-3">
        <Alert variant={SUMMARY_VARIANT[result.summary.status]} role="status">
          <AlertTitle>
            {result.accountName}
            {result.broughtToSellUp ? ' · traída de HubSpot' : ''}
          </AlertTitle>
          <AlertDescription className="text-sm">{result.summary.message}</AlertDescription>
        </Alert>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm">
            <Link href={`/accounts/${result.accountId}`}>Ver la empresa</Link>
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setState({ status: 'asking', error: null })}>
            Enriquecer otra
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onBack}>
            Volver a las opciones
          </Button>
        </div>
      </section>
    );
  }

  return (
    <ChatQuestionPanel
      aria-label="Enriquecer empresa de HubSpot"
      title="¿Qué empresa de HubSpot enriquezco?"
      description="Pega el enlace de su ficha en HubSpot o su ID. Completo número fiscal, razón social, país, industria y tamaño en SellUp; en HubSpot no se cambia nada."
      titleRef={titleRef}
      options={[]}
      otherLabel="Enlace o ID de HubSpot"
      otherPlaceholder="https://app.hubspot.com/…/record/0-2/123456"
      otherMaxLength={500}
      onOther={(text) => void run(text)}
      submitLabel="Enriquecer"
      onBack={onBack}
      backLabel="Volver"
      footerNotice={
        state.error ? (
          <Alert variant="warning" role="alert">
            <AlertDescription className="text-xs">{state.error}</AlertDescription>
          </Alert>
        ) : undefined
      }
    />
  );
}
