import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Database, ExternalLink } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard } from '@/components/shared/surface-card';
import {
  getSourceCatalogViewModel,
  getSourceConnectionRecord,
} from '@/modules/source-catalog/queries';
import { getSourceConnectionTestHistory } from '@/modules/source-catalog/history-queries';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { getPeruSourceCoverageSummary } from '@/server/services/peru-source-coverage-summary';
import { PeruCoverageCard } from '@/components/source-catalog/peru-coverage-card';
import { getRdSourceCoverageSummary } from '@/server/services/rd-source-coverage-summary';
import { RdCoverageCard } from '@/components/source-catalog/rd-coverage-card';
import { getDgcpSourceCoverageSummary } from '@/server/services/rd-dgcp-source-coverage-summary';
import { RdDgcpCoverageCard } from '@/components/source-catalog/rd-dgcp-coverage-card';
import { getSicopSourceCoverageSummary } from '@/server/services/cr-sicop-source-coverage-summary';
import { CrSicopCoverageCard } from '@/components/source-catalog/cr-sicop-coverage-card';
import { getPaPanamaCompraConvenioCoverageSummary } from '@/server/services/pa-panamacompra-convenio-source-coverage-summary';
import { PaPanamaCompraConvenioCoverageCard } from '@/components/source-catalog/pa-panamacompra-convenio-coverage-card';
import { getSvComprasalSignalsSummary } from '@/server/services/sv-comprasal-signals-summary';
import { SvComprasalSignalsCard } from '@/components/source-catalog/sv-comprasal-signals-card';
import { HnContratacionesAbiertasCard } from '@/components/source-catalog/hn-contrataciones-abiertas-card';
import { getHnContratacionesCoverageSummary } from '@/server/services/hn-contrataciones-coverage-summary';
import {
  OPERATIONAL_STATUS_LABELS,
  AUTOMATION_LEVEL_LABELS,
  TYPE_LABELS,
  PRIORITY_LABELS,
  COUNTRY_LABELS,
  operationalStatusBadgeClass,
  operationalStatusDotClass,
} from '@/modules/source-catalog/labels';
import { CopyKeyButton } from './copy-key-button';
import { TestConnectionPanel } from './test-connection-panel';
import { ConnectionTestHistory } from './connection-test-history';
import { SourceCredentialPanel } from './source-credential-panel';
import { SourceDryRunPanel } from './source-dry-run-panel';
import { DenuePreviewBatchPanel } from './denue-preview-batch-panel';
import { ChileResDryRunPanel } from './chile-res-dry-run-panel';
import { ChileCompraOcdsDryRunPanel } from './chilecompra-ocds-dry-run-panel';
// ChileCompraDryRunPanel (legacy ticket) import omitted — descartado del MVP

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ sourceKey: string }>;
};

export async function generateStaticParams() {
  const { sources } = getSourceCatalogViewModel();
  return sources.map((s) => ({ sourceKey: s.key }));
}

export default async function SourceDetailPage({ params }: Props) {
  const { sourceKey } = await params;
  const { sources } = getSourceCatalogViewModel();
  const source = sources.find((s) => s.key === sourceKey);

  if (!source) notFound();

  const isSunatPeru = source.key === 'pe_sunat_bulk';
  const isDgiiRd = source.key === 'rd_dgii_bulk';
  const isDgcpRd = source.key === 'do_dgcp';
  const isCrSicop = source.key === 'cr_sicop';
  const isPaConvenio = source.key === 'pa_panamacompra_convenio';
  const isSvComprasal = source.key === 'sv_comprasal';
  const isHnContrataciones = source.key === 'hn_contrataciones_abiertas';

  const [history, connectionRecord, isAdmin, peruCoverage, rdCoverage, dgcpCoverage, sicopCoverage, paConvenioCoverage, svComprasalSignals, hnCoverage] = await Promise.all([
    getSourceConnectionTestHistory(sourceKey),
    getSourceConnectionRecord(sourceKey),
    isCurrentUserAdmin(),
    isSunatPeru
      ? getPeruSourceCoverageSummary().catch(() => null)
      : Promise.resolve(null),
    isDgiiRd
      ? getRdSourceCoverageSummary().catch(() => null)
      : Promise.resolve(null),
    isDgcpRd
      ? getDgcpSourceCoverageSummary().catch(() => null)
      : Promise.resolve(null),
    isCrSicop
      ? getSicopSourceCoverageSummary().catch(() => null)
      : Promise.resolve(null),
    isPaConvenio
      ? getPaPanamaCompraConvenioCoverageSummary().catch(() => null)
      : Promise.resolve(null),
    isSvComprasal
      ? getSvComprasalSignalsSummary().catch(() => null)
      : Promise.resolve(null),
    isHnContrataciones
      ? getHnContratacionesCoverageSummary().catch(() => null)
      : Promise.resolve(null),
  ]);

  const statusClass = operationalStatusBadgeClass(source.operationalStatus);
  const dotClass = operationalStatusDotClass(source.operationalStatus);
  const statusLabel = OPERATIONAL_STATUS_LABELS[source.operationalStatus];

  const countryLabels =
    source.countryCodes.length > 0
      ? source.countryCodes.map((c) => COUNTRY_LABELS[c] ?? c).join(', ')
      : 'Global';

  return (
    <div className="space-y-8">
      <PageHeader
        title={source.name}
        description={source.key}
        backHref="/settings/source-catalog"
        actions={
          <div className="flex items-center gap-2">
            <CopyKeyButton sourceKey={source.key} />
            {source.url && (
              <Link
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[0.8rem] font-medium text-foreground transition-colors hover:bg-muted"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Abrir URL
              </Link>
            )}
          </div>
        }
      />

      {/* Status badge */}
      <div className="flex items-center gap-3">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${statusClass}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
          {statusLabel}
        </span>
        <span className="inline-flex items-center rounded-full border border-border/40 bg-muted/30 px-3 py-1 text-xs font-medium text-muted-foreground">
          {PRIORITY_LABELS[source.priority]}
        </span>
        <span className="inline-flex items-center rounded-full border border-border/40 bg-muted/30 px-3 py-1 text-xs font-medium text-muted-foreground">
          {TYPE_LABELS[source.type]}
        </span>
        <span className="inline-flex items-center rounded-full border border-border/40 bg-muted/30 px-3 py-1 text-xs font-medium text-muted-foreground">
          Automatización: {AUTOMATION_LEVEL_LABELS[source.automationLevel]}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Info general */}
        <SurfaceCard>
          <h2 className="text-[0.8125rem] font-semibold text-foreground  mb-4">
            Información general
          </h2>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">
                Key
              </dt>
              <dd className="font-mono text-foreground">{source.key}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">
                País
              </dt>
              <dd className="text-foreground">{countryLabels}</dd>
            </div>
            {source.sectors.length > 0 && (
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">
                  Sectores
                </dt>
                <dd className="text-foreground">{source.sectors.join(', ')}</dd>
              </div>
            )}
            {source.url && (
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">
                  URL
                </dt>
                <dd>
                  <Link
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-su-brand hover:underline break-all"
                  >
                    {source.url}
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </Link>
                </dd>
              </div>
            )}
          </dl>
        </SurfaceCard>

        {/* Uso recomendado */}
        <SurfaceCard>
          <h2 className="text-[0.8125rem] font-semibold text-foreground  mb-4">
            Uso recomendado
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {source.recommendedUse}
          </p>
        </SurfaceCard>

        {/* Limitaciones */}
        {source.limitations.length > 0 && (
          <SurfaceCard>
            <h2 className="text-[0.8125rem] font-semibold text-foreground  mb-4">
              Limitaciones
            </h2>
            <ul className="space-y-2">
              {source.limitations.map((item, i) => (
                <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-border" />
                  {item}
                </li>
              ))}
            </ul>
          </SurfaceCard>
        )}

        {/* Riesgos */}
        {source.riskNotes.length > 0 && (
          <SurfaceCard>
            <h2 className="text-[0.8125rem] font-semibold text-foreground  mb-4">
              Notas de riesgo
            </h2>
            <ul className="space-y-2">
              {source.riskNotes.map((item, i) => (
                <li key={i} className="flex gap-2 text-sm text-amber-600 dark:text-amber-400">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500/60" />
                  {item}
                </li>
              ))}
            </ul>
          </SurfaceCard>
        )}
      </div>

      {/* Acceso técnico / Credencial */}
      {isHnContrataciones ? (
        <SurfaceCard>
          <h2 className="text-[0.8125rem] font-semibold text-foreground mb-2">
            Acceso técnico
          </h2>
          <dl className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <dt className="text-muted-foreground">Credenciales:</dt>
              <dd>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                  No requeridas
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">
                Publisher institucional
              </dt>
              <dd className="text-foreground">ONCAE Honduras</dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">
                Feed técnico consumido por SellUp
              </dt>
              <dd className="text-foreground">OCP Data Registry · publicación Honduras ONCAE</dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">
                Formato
              </dt>
              <dd className="text-foreground">JSONL.gz / OCDS</dd>
            </div>
          </dl>
        </SurfaceCard>
      ) : connectionRecord ? (
        <SourceCredentialPanel
          sourceKey={source.key}
          record={connectionRecord}
          isAdmin={isAdmin}
        />
      ) : source.type === 'public_dataset' || source.key === 'co_rues' || (source.operationalStatus === 'operational_verified' && !source.url?.includes('api')) ? (
        <SurfaceCard>
          <h2 className="text-[0.8125rem] font-semibold text-foreground  mb-2">
            Credencial de API
          </h2>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Requiere credencial:</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border/40 bg-muted/30 px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                No requiere credencial
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Esta fuente es de acceso público. La prueba de conexión valida que la API responde correctamente.
              No crea candidatos ni sincroniza datos.
            </p>
          </div>
        </SurfaceCard>
      ) : (
        <SurfaceCard>
          <h2 className="text-[0.8125rem] font-semibold text-foreground  mb-2">
            Credencial de API
          </h2>
          <p className="text-sm text-muted-foreground">
            Esta fuente aún no tiene configuración de credencial registrada en el sistema.
          </p>
        </SurfaceCard>
      )}

      {/* Dry-run de fuente (solo mx_denue) */}
      {source.key === 'mx_denue' && (
        <SourceDryRunPanel
          sourceKey={connectionRecord?.source_key ?? 'denue_mexico'}
          hasStoredCredential={connectionRecord?.credentials_status === 'stored'}
          isAdmin={isAdmin}
        />
      )}

      {/* Dry-run RES Chile (solo cl_res) */}
      {source.key === 'cl_res' && (
        <ChileResDryRunPanel isAdmin={isAdmin} />
      )}

      {/* ChileCompra OCDS abierto (solo cl_chilecompra_ocds) — read-only, sin credencial */}
      {source.key === 'cl_chilecompra_ocds' && (
        <ChileCompraOcdsDryRunPanel isAdmin={isAdmin} />
      )}

      {/* ChileCompra legacy (ticket/Clave Única) descartado del MVP — dry-run panel desactivado */}

      {/* Lote preview DENUE (solo mx_denue) */}
      {source.key === 'mx_denue' && (
        <DenuePreviewBatchPanel
          hasStoredCredential={connectionRecord?.credentials_status === 'stored'}
          isAdmin={isAdmin}
        />
      )}

      {/* Cobertura Perú — solo pe_sunat_bulk */}
      {isSunatPeru && (
        peruCoverage
          ? <PeruCoverageCard summary={peruCoverage} />
          : <PeruCoverageCard error />
      )}

      {/* Cobertura RD — solo rd_dgii_bulk */}
      {isDgiiRd && (
        rdCoverage
          ? <RdCoverageCard summary={rdCoverage} />
          : <RdCoverageCard error />
      )}

      {/* Cobertura DGCP — solo do_dgcp (señal procurement B2G, muestra piloto) */}
      {isDgcpRd && (
        dgcpCoverage
          ? <RdDgcpCoverageCard summary={dgcpCoverage} />
          : <RdDgcpCoverageCard error />
      )}

      {/* Cobertura SICOP — solo cr_sicop (señal procurement B2G, muestra piloto) */}
      {isCrSicop && (
        sicopCoverage
          ? <CrSicopCoverageCard summary={sicopCoverage} />
          : <CrSicopCoverageCard error />
      )}

      {/* Cobertura PanamaCompra Convenio Marco — solo pa_panamacompra_convenio (señal procurement B2G, muestra piloto) */}
      {isPaConvenio && (
        paConvenioCoverage
          ? <PaPanamaCompraConvenioCoverageCard summary={paConvenioCoverage} />
          : <PaPanamaCompraConvenioCoverageCard error />
      )}

      {/* Honduras OCDS snapshot — solo hn_contrataciones_abiertas (snapshot parcial persistido, post-approval no habilitado) */}
      {isHnContrataciones && (
        <HnContratacionesAbiertasCard coverage={hnCoverage} />
      )}

      {/* Señales COMPRASAL El Salvador — solo sv_comprasal (señal débil weak_name_only, sin post-approval, sin matching automático) */}
      {isSvComprasal && (
        svComprasalSignals
          ? <SvComprasalSignalsCard summary={svComprasalSignals} />
          : <SvComprasalSignalsCard error />
      )}

      {/* Prueba de conexión — oculta para fuentes not_persisted sin feed testeable desde UI */}
      {!isHnContrataciones && (
        <TestConnectionPanel
          sourceKey={source.key}
          sourceName={source.name}
        />
      )}

      {/* Historial de pruebas — oculto para fuentes not_persisted sin registros de conexión */}
      {!isHnContrataciones && (
        <ConnectionTestHistory history={history} />
      )}

      {/* Lotes Socrata — solo co_rues */}
      {source.key === 'co_rues' && (
        <div className="flex items-center justify-between rounded-xl border border-border/40 bg-muted/30 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <Database className="h-4 w-4 shrink-0 text-muted-foreground/60" />
            <div>
              <p className="text-sm font-medium text-foreground">Lotes Socrata</p>
              <p className="text-xs text-muted-foreground">
                Revisión interna de lotes creados desde esta fuente. Solo lectura — no aprueba ni sincroniza candidatos.
              </p>
            </div>
          </div>
          <Link
            href="/settings/source-catalog/socrata-batches"
            className="shrink-0 rounded-md border border-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-su-brand/40 hover:bg-su-brand-soft hover:text-su-brand transition-colors"
          >
            Ver lotes Socrata
          </Link>
        </div>
      )}
    </div>
  );
}
