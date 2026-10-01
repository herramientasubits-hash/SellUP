'use client';

import { useState } from 'react';
import { Loader2, ShieldCheck, AlertTriangle, CheckCircle2, XCircle, Info, Clock, PlugZap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SurfaceCard } from '@/components/shared/surface-card';
import { testSourceConnectionAction } from '@/modules/source-catalog/actions';
import {
  CONNECTION_TEST_STATUS_LABELS,
  CONNECTION_TEST_STRATEGY_LABELS,
} from '@/modules/source-catalog/labels';
import type { SourceConnectionTestResult, SourceConnectionTestStatus } from '@/server/source-catalog/connection-test/types';

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: SourceConnectionTestStatus }) {
  switch (status) {
    case 'success':
      return <CheckCircle2 className="h-4 w-4 text-success" />;
    case 'failed':
    case 'blocked':
      return <XCircle className="h-4 w-4 text-destructive" />;
    case 'requires_credentials':
    case 'input_required':
    case 'not_supported':
      return <AlertTriangle className="h-4 w-4 text-warning" />;
  }
}

const STATUS_BADGE_VARIANT: Record<
  SourceConnectionTestStatus,
  'positive' | 'negative' | 'warning' | 'neutral'
> = {
  success: 'positive',
  failed: 'negative',
  blocked: 'negative',
  requires_credentials: 'warning',
  input_required: 'warning',
  not_supported: 'neutral',
};

function StatusBadge({ status }: { status: SourceConnectionTestStatus }) {
  return (
    <Badge variant={STATUS_BADGE_VARIANT[status]}>
      <StatusIcon status={status} />
      {CONNECTION_TEST_STATUS_LABELS[status]}
    </Badge>
  );
}

function MetaRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0">
      <dt className="mb-0.5 text-xs font-medium text-muted-foreground">
        {label}
      </dt>
      <dd className="break-words text-sm tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

// ─── Result display ───────────────────────────────────────────────────────────

function SpecialStateBlock({ result }: { result: SourceConnectionTestResult }) {
  const { status, recommendation } = result;

  if (status === 'requires_credentials') {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/15 px-4 py-3 text-sm text-warning">
        <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Esta fuente requiere credenciales o conexión antes de poder probarse automáticamente.
        </p>
      </div>
    );
  }

  if (status === 'input_required') {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/15 px-4 py-3 text-sm text-warning">
        <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Esta fuente requiere un dato de entrada para validación individual. Esta acción vendrá en una fase posterior.
        </p>
      </div>
    );
  }

  if (status === 'not_supported') {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-border/60 bg-surface-subtle px-4 py-3 text-sm text-muted-foreground">
        <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
        <p>Esta fuente no soporta prueba automática de conexión.</p>
      </div>
    );
  }

  if (recommendation) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-border/60 bg-surface-subtle px-4 py-3 text-sm text-muted-foreground">
        <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
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
        <div className="flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/15 px-4 py-3 text-sm text-warning">
          <Clock aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Espera unos segundos antes de volver a probar esta fuente.</p>
        </div>
      )}

      {/* Status */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Resultado
        </span>
        <StatusBadge status={result.status} />
      </div>

      {/* Special state blocks */}
      <SpecialStateBlock result={result} />

      {/* Metadata grid */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-border/60 bg-surface-subtle px-4 py-3 sm:grid-cols-3">
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
            <dt className="mb-0.5 text-xs font-medium text-muted-foreground">
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
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-border/40">
            <PlugZap className="h-4 w-4" />
          </span>
          <div className="min-w-0 space-y-1">
            <h2 className="text-base font-semibold leading-tight tracking-tight text-foreground">
              Prueba de conexión
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Esta prueba verifica si <span className="font-medium text-foreground">{sourceName}</span> responde.
              No extrae empresas ni crea candidatos.
            </p>
          </div>
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
              <Loader2 aria-hidden="true" className="animate-spin" />
              Probando conexión…
            </>
          ) : (
            'Probar conexión'
          )}
        </Button>

        {/* Error fallback */}
        {callError && (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <XCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{callError}</p>
          </div>
        )}

        {/* Result */}
        {result && <ResultPanel result={result} />}

        {/* Security disclaimer */}
        <div className="flex items-start gap-1.5 border-t border-border/50 pt-3 text-xs text-muted-foreground">
          <ShieldCheck aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Esta prueba es read-only. No crea candidatos ni ejecuta agentes.
        </div>
      </div>
    </SurfaceCard>
  );
}
