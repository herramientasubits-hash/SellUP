import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

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
      <Alert variant="warning">
        <AlertTitle className="text-sm">Account no operativa · rollback lógico</AlertTitle>
        <AlertDescription className="text-xs leading-relaxed text-warning/80">
          Esta account fue creada desde un candidato estructurado y luego revertida mediante
          rollback lógico. Los datos se conservan para auditoría, pero no debe usarse como
          cuenta activa.
        </AlertDescription>
        <div className="min-w-0">

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
      </Alert>

      {/* Aviso HubSpot */}
      {hubspotCompanyId && (
        <Alert variant="warning">
          <AlertTitle className="text-xs">Referencia HubSpot sin rollback</AlertTitle>
          <AlertDescription className="text-xs leading-relaxed text-warning/80">
            Esta account tiene referencia HubSpot (
            <span className="font-mono">{hubspotCompanyId}</span>
            ). No se realizó rollback en HubSpot — la entrada puede seguir activa allí.
          </AlertDescription>
        </Alert>
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
      <dt className="text-xs font-semibold text-warning/80">
        {label}
      </dt>
      <dd className="mt-0.5 text-xs text-warning">{children}</dd>
    </div>
  );
}
