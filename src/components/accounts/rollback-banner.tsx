import { AlertTriangle, RotateCcw, ExternalLink } from 'lucide-react';

interface RollbackBannerProps {
  metadata: Record<string, unknown>;
  hubspotCompanyId: string | null;
}

function safeStr(val: unknown): string | null {
  return typeof val === 'string' && val.length > 0 ? val : null;
}

function formatRollbackDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function RollbackBanner({ metadata, hubspotCompanyId }: RollbackBannerProps) {
  if (metadata.rollback_logical !== true) return null;

  const rollbackReason = safeStr(metadata.rollback_reason);
  const rollbackAt = safeStr(metadata.rollback_at);
  const candidateId = safeStr(metadata.converted_candidate_id);
  const rollbackScope = safeStr(metadata.rollback_scope);
  const rollbackBy = safeStr(metadata.rollback_by);

  return (
    <div className="space-y-2">
      {/* Banner principal */}
      <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3.5">
        <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
            Account no operativa · rollback lógico
          </p>
          <p className="text-xs text-amber-700/80 dark:text-amber-300/80 leading-relaxed">
            Esta account fue creada desde un candidato estructurado y luego revertida mediante
            rollback lógico. Los datos se conservan para auditoría, pero no debe usarse como
            cuenta activa.
          </p>

          {/* Detalles del rollback */}
          <dl className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {rollbackReason && (
              <RollbackDetail label="Motivo">{rollbackReason}</RollbackDetail>
            )}
            {rollbackAt && (
              <RollbackDetail label="Fecha">{formatRollbackDate(rollbackAt)}</RollbackDetail>
            )}
            {rollbackBy && (
              <RollbackDetail label="Revertido por">{rollbackBy}</RollbackDetail>
            )}
            {rollbackScope && (
              <RollbackDetail label="Scope">
                <span className="font-mono">{rollbackScope}</span>
              </RollbackDetail>
            )}
            {candidateId && (
              <RollbackDetail label="Candidato origen" className="sm:col-span-2">
                <span className="font-mono break-all">{candidateId}</span>
              </RollbackDetail>
            )}
          </dl>
        </div>
      </div>

      {/* Aviso HubSpot */}
      {hubspotCompanyId && (
        <div className="flex gap-3 rounded-xl border border-orange-500/30 bg-orange-500/10 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-600 dark:text-orange-400" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-orange-700 dark:text-orange-300">
              Referencia HubSpot sin rollback
            </p>
            <p className="mt-0.5 text-xs text-orange-700/80 dark:text-orange-300/80 leading-relaxed">
              Esta account tiene referencia HubSpot (
              <span className="font-mono">{hubspotCompanyId}</span>
              ). No se realizó rollback en HubSpot — la entrada puede seguir activa allí.
            </p>
          </div>
          <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-500/50" />
        </div>
      )}
    </div>
  );
}

function RollbackDetail({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-[10px] font-semibold uppercase tracking-widest text-amber-700/60 dark:text-amber-400/60">
        {label}
      </dt>
      <dd className="mt-0.5 text-xs text-amber-700 dark:text-amber-300">{children}</dd>
    </div>
  );
}
