'use client';

import { useState } from 'react';
import { Loader2, ShieldCheck, AlertTriangle, CheckCircle2, XCircle, Info, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SurfaceCard } from '@/components/shared/surface-card';
import { testSourceConnectionAction } from '@/modules/source-catalog/actions';
import {
  CONNECTION_TEST_STATUS_LABELS,
  CONNECTION_TEST_STRATEGY_LABELS,
  connectionTestStatusBadgeClass,
} from '@/modules/source-catalog/labels';
import type { SourceConnectionTestResult, SourceConnectionTestStatus } from '@/server/source-catalog/connection-test/types';

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: SourceConnectionTestStatus }) {
  switch (status) {
    case 'success':
      return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    case 'failed':
    case 'blocked':
      return <XCircle className="h-4 w-4 text-destructive" />;
    case 'requires_credentials':
    case 'input_required':
    case 'not_supported':
      return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  }
}

function StatusBadge({ status }: { status: SourceConnectionTestStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${connectionTestStatusBadgeClass(status)}`}>
      <StatusIcon status={status} />
      {CONNECTION_TEST_STATUS_LABELS[status]}
    </span>
  );
}

function MetaRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">
        {label}
      </dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  );
}

// ─── Result display ───────────────────────────────────────────────────────────

function SpecialStateBlock({ result }: { result: SourceConnectionTestResult }) {
  const { status, recommendation } = result;

  if (status === 'requires_credentials') {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Esta fuente requiere credenciales o conexión antes de poder probarse automáticamente.
        </p>
      </div>
    );
  }

  if (status === 'input_required') {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Esta fuente requiere un dato de entrada para validación individual. Esta acción vendrá en una fase posterior.
        </p>
      </div>
    );
  }

  if (status === 'not_supported') {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-border/40 bg-muted/30 p-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>Esta fuente no soporta prueba automática de conexión.</p>
      </div>
    );
  }

  if (recommendation) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-border/50 bg-muted/20 p-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>{recommendation}</p>
      </div>
    );
  }

  return null;
}

function ResultPanel({ result }: { result: SourceConnectionTestResult }) {
  const isRateLimited = result.metadata?.rateLimited === true ||
    (result.recommendation?.toLowerCase().includes('espera') ?? false);

  const checkedAtDate = new Date(result.checkedAt).toLocaleString('es-CO', {
    dateStyle: 'short',
    timeStyle: 'medium',
  });

  return (
    <div className="space-y-4">
      {/* Rate limit warning */}
      {isRateLimited && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
          <Clock className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Espera unos segundos antes de volver a probar esta fuente.</p>
        </div>
      )}

      {/* Status */}
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Resultado
        </span>
        <StatusBadge status={result.status} />
      </div>

      {/* Special state blocks */}
      <SpecialStateBlock result={result} />

      {/* Metadata grid */}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <MetaRow label="Estrategia" value={CONNECTION_TEST_STRATEGY_LABELS[result.strategy]} />
        {result.httpStatus !== null && (
          <MetaRow label="HTTP status" value={result.httpStatus} />
        )}
        {result.responseTimeMs !== null && (
          <MetaRow label="Tiempo de respuesta" value={`${result.responseTimeMs} ms`} />
        )}
        {result.contentType && (
          <MetaRow label="Content-Type" value={result.contentType} />
        )}
        {result.contentLength !== null && (
          <MetaRow label="Content-Length" value={`${result.contentLength} bytes`} />
        )}
        {result.errorCode && result.errorCode !== 'OK' && (
          <MetaRow label="Código de error" value={result.errorCode} />
        )}
        {result.testedUrl && (
          <div className="col-span-2 sm:col-span-3">
            <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">
              URL probada
            </dt>
            <dd className="text-sm font-mono text-muted-foreground break-all">{result.testedUrl}</dd>
          </div>
        )}
        <div className="col-span-2 sm:col-span-3">
          <MetaRow label="Fecha/hora" value={checkedAtDate} />
        </div>
      </dl>
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
    <SurfaceCard>
      <div className="space-y-4">
        {/* Header */}
        <div>
          <h2 className="text-[0.8125rem] font-semibold text-foreground  mb-1">
            Prueba de conexión
          </h2>
          <p className="text-sm text-muted-foreground">
            Esta prueba verifica si <span className="font-medium text-foreground">{sourceName}</span> responde.
            No extrae empresas ni crea candidatos.
          </p>
        </div>

        {/* Action button */}
        <Button
          variant="outline"
          size="sm"
          onClick={handleTest}
          disabled={testState === 'loading'}
        >
          {testState === 'loading' ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Probando conexión…
            </>
          ) : (
            'Probar conexión'
          )}
        </Button>

        {/* Error fallback */}
        {callError && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{callError}</p>
          </div>
        )}

        {/* Result */}
        {result && <ResultPanel result={result} />}

        {/* Security disclaimer */}
        <div className="flex items-center gap-1.5 border-t border-border/40 pt-3 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
          Esta prueba es read-only. No crea candidatos ni ejecuta agentes.
        </div>
      </div>
    </SurfaceCard>
  );
}
