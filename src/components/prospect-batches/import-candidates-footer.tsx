'use client';

// ── Importar candidatos — pie del drawer, según el paso ───────────────────────
// Solo pantalla: qué botones hay y cuándo se apagan lo decide el drawer.

import { ArrowLeft, ArrowRight, Loader2 } from '@/icons';
import { Button } from '@/components/ui/button';

function FooterBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="shrink-0 border-t border-border/60 bg-card px-6 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">{children}</div>
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onBack}>
      <ArrowLeft className="h-3.5 w-3.5" />
      Volver
    </Button>
  );
}

export function ImportInputFooter({
  onCancel,
  onBuildPreview,
  disabled,
  loading,
}: {
  onCancel: () => void;
  onBuildPreview: () => void;
  disabled: boolean;
  loading: boolean;
}) {
  return (
    <FooterBar>
      <Button type="button" variant="outline" size="sm" onClick={onCancel}>
        Cancelar
      </Button>
      <Button type="button" onClick={onBuildPreview} disabled={disabled} size="sm">
        {loading ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Procesando…
          </>
        ) : (
          'Previsualizar y clasificar'
        )}
      </Button>
    </FooterBar>
  );
}

export function ImportMappingFooter({
  onBack,
  onReclassify,
  disabled,
  loading,
}: {
  onBack: () => void;
  onReclassify: () => void;
  disabled: boolean;
  loading: boolean;
}) {
  return (
    <FooterBar>
      <BackButton onBack={onBack} />
      <p className="min-w-0 flex-1 text-xs text-muted-foreground">
        Corrige el mapeo de columnas y luego reclasifica.
      </p>
      <Button type="button" onClick={onReclassify} disabled={disabled} size="sm">
        {loading ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Clasificando…
          </>
        ) : (
          <>
            Reclasificar
            <ArrowRight className="h-3.5 w-3.5" />
          </>
        )}
      </Button>
    </FooterBar>
  );
}

export function ImportClassificationFooter({
  onBack,
  onConfirm,
  selectedCount,
  totalCount,
  blockingCount,
  canImport,
  confirming,
}: {
  onBack: () => void;
  onConfirm: () => void;
  selectedCount: number;
  totalCount: number;
  blockingCount: number;
  canImport: boolean;
  confirming: boolean;
}) {
  return (
    <FooterBar>
      <BackButton onBack={onBack} />
      <div className="min-w-0 flex-1 space-y-1 text-left">
        {selectedCount === 0 && (
          <p className="text-xs font-medium text-muted-foreground">
            Selecciona al menos una fila para importar.
          </p>
        )}
        {selectedCount > 0 && blockingCount > 0 && (
          <p className="text-xs font-medium text-destructive">
            Corrige o deselecciona {blockingCount} fila{blockingCount !== 1 ? 's' : ''} para continuar.
          </p>
        )}
        {selectedCount > 0 && blockingCount === 0 && (
          <p className="text-xs font-medium text-success">
            {selectedCount} fila{selectedCount !== 1 ? 's' : ''} seleccionada{selectedCount !== 1 ? 's' : ''} listas para importar.
          </p>
        )}
        <p className="text-xs tabular-nums text-muted-foreground">
          Seleccionadas: {selectedCount} de {totalCount}
        </p>
      </div>
      <Button type="button" onClick={onConfirm} disabled={confirming || !canImport} size="sm">
        {confirming ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Importando y validando…
          </>
        ) : (
          `Importar ${selectedCount} candidato${selectedCount !== 1 ? 's' : ''}`
        )}
      </Button>
    </FooterBar>
  );
}

export function ImportPreviewFooter({
  onBack,
  onConfirm,
  selectedCount,
  importableCount,
  errorCount,
  confirming,
}: {
  onBack: () => void;
  onConfirm: () => void;
  selectedCount: number;
  importableCount: number;
  errorCount: number;
  confirming: boolean;
}) {
  return (
    <FooterBar>
      <BackButton onBack={onBack} />
      <div className="min-w-0 flex-1 space-y-1 text-left">
        {selectedCount > 0 && (
          <p className="text-xs font-medium text-primary">
            {selectedCount} fila{selectedCount !== 1 ? 's' : ''} seleccionada{selectedCount !== 1 ? 's' : ''} para importar.
          </p>
        )}
        {errorCount > 0 && (
          <p className="text-xs font-medium text-destructive">
            {errorCount} {errorCount === 1 ? 'fila' : 'filas'} con errores no {errorCount === 1 ? 'será importada' : 'serán importadas'}.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          SellUp validará duplicidad y calidad básica. No creará cuentas ni sincronizará con HubSpot hasta que apruebes candidatos.
        </p>
      </div>
      <Button type="button" onClick={onConfirm} disabled={confirming || importableCount === 0} size="sm">
        {confirming ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Importando y validando…
          </>
        ) : (
          `Importar y validar ${importableCount} candidatos`
        )}
      </Button>
    </FooterBar>
  );
}
