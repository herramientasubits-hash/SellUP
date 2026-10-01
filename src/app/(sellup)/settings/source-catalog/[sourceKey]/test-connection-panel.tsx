'use client';

import { withAppTimeZone } from '@/lib/format-date';
import { useState } from 'react';
import { Loader2, PlugZap } from "@/icons";
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { testSourceConnectionAction } from '@/modules/source-catalog/actions';
import { CONNECTION_TEST_STRATEGY_LABELS } from '@/modules/source-catalog/labels';
import type { SourceConnectionTestResult } from '@/server/source-catalog/connection-test/types';
import { ConnectionTestStatusBadge } from './connection-test-status';
import { PanelDisclaimer, PanelSummary, PanelSummaryItem, SourcePanel } from './source-panel-parts';

// ─── Result display ───────────────────────────────────────────────────────────

function SpecialStateBlock({ result }: { result: SourceConnectionTestResult }) {
  const { status, recommendation } = result;

  if (status === 'requires_credentials') {
    return (
      <Alert variant="warning">
        Esta fuente requiere credenciales o conexión antes de poder probarse automáticamente.
      </Alert>
    );
  }

  if (status === 'input_required') {
    return (
      <Alert variant="warning">
        Esta fuente requiere un dato de entrada para validación individual. Esta acción vendrá en una fase posterior.
      </Alert>
    );
  }

  if (status === 'not_supported') {
    return <Alert variant="info">Esta fuente no soporta prueba automática de conexión.</Alert>;
  }

  if (recommendation) {
    return <Alert variant="info">{recommendation}</Alert>;
  }

  return null;
}

function ResultPanel({ result }: { result: SourceConnectionTestResult }) {
  const isRateLimited = result.metadata?.rateLimited === true ||
    (result.recommendation?.toLowerCase().includes('espera') ?? false);

  const checkedAtDate = new Date(result.checkedAt).toLocaleString('es-CO', withAppTimeZone({
    dateStyle: 'short',
    timeStyle: 'medium',
  }));

  return (
    <div className="space-y-4">
      {isRateLimited && (
        <Alert variant="warning">Espera unos segundos antes de volver a probar esta fuente.</Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Resultado</span>
        <ConnectionTestStatusBadge status={result.status} />
      </div>

      <SpecialStateBlock result={result} />

      <PanelSummary columns={3}>
        <PanelSummaryItem label="Estrategia" value={CONNECTION_TEST_STRATEGY_LABELS[result.strategy]} />
        {result.httpStatus !== null && <PanelSummaryItem label="HTTP status" value={result.httpStatus} />}
        {result.responseTimeMs !== null && (
          <PanelSummaryItem label="Tiempo de respuesta" value={`${result.responseTimeMs} ms`} />
        )}
        {result.contentType && <PanelSummaryItem label="Content-Type" value={result.contentType} />}
        {result.contentLength !== null && (
          <PanelSummaryItem label="Content-Length" value={`${result.contentLength} bytes`} />
        )}
        {result.errorCode && result.errorCode !== 'OK' && (
          <PanelSummaryItem label="Código de error" value={result.errorCode} />
        )}
        {result.testedUrl && <PanelSummaryItem wide mono label="URL probada" value={result.testedUrl} />}
        <PanelSummaryItem wide label="Fecha/hora" value={checkedAtDate} />
      </PanelSummary>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type TestState = 'idle' | 'loading' | 'done';

interface Props {
  sourceKey: string;
  sourceName: string;
}

export function TestConnectionPanel({ sourceKey, sourceName }: Props) {
  const [testState, setTestState] = useState<TestState>('idle');
  const [result, setResult] = useState<SourceConnectionTestResult | null>(null);
  const [callError, setCallError] = useState<string | null>(null);

  async function handleTest() {
    setTestState('loading');
    setCallError(null);
    setResult(null);

    try {
      const res = await testSourceConnectionAction(sourceKey);
      setResult(res);
      setTestState('done');
    } catch {
      setCallError('Error inesperado al ejecutar la prueba. Intenta de nuevo.');
      setTestState('idle');
    }
  }

  return (
    <SourcePanel
      icon={PlugZap}
      title="Prueba de conexión"
      description={`Verifica si ${sourceName} responde. No extrae empresas ni crea candidatos.`}
    >
      <Button variant="outline" size="sm" onClick={handleTest} disabled={testState === 'loading'}>
        {testState === 'loading' ? (
          <>
            <Loader2 aria-hidden="true" className="animate-spin" />
            Probando conexión…
          </>
        ) : (
          'Probar conexión'
        )}
      </Button>

      {callError && <Alert variant="destructive">{callError}</Alert>}

      {result && <ResultPanel result={result} />}

      <PanelDisclaimer>Esta prueba es read-only. No crea candidatos ni ejecuta agentes.</PanelDisclaimer>
    </SourcePanel>
  );
}
