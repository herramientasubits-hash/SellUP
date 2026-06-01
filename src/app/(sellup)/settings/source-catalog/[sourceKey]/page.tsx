import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ExternalLink, Info } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard } from '@/components/shared/surface-card';
import {
  getSourceCatalogViewModel,
  getSourceConnectionRecord,
} from '@/modules/source-catalog/queries';
import { getSourceConnectionTestHistory } from '@/modules/source-catalog/history-queries';
import { isCurrentUserAdmin } from '@/modules/access/actions';
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

  const [history, connectionRecord, isAdmin] = await Promise.all([
    getSourceConnectionTestHistory(sourceKey),
    getSourceConnectionRecord(sourceKey),
    isCurrentUserAdmin(),
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
          <h2 className="text-[0.8125rem] font-semibold text-foreground font-heading mb-4">
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
          <h2 className="text-[0.8125rem] font-semibold text-foreground font-heading mb-4">
            Uso recomendado
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {source.recommendedUse}
          </p>
        </SurfaceCard>

        {/* Limitaciones */}
        {source.limitations.length > 0 && (
          <SurfaceCard>
            <h2 className="text-[0.8125rem] font-semibold text-foreground font-heading mb-4">
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
            <h2 className="text-[0.8125rem] font-semibold text-foreground font-heading mb-4">
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

      {/* Credencial de API */}
      {connectionRecord && (
        <SourceCredentialPanel
          sourceKey={source.key}
          record={connectionRecord}
          isAdmin={isAdmin}
        />
      )}

      {/* Prueba de conexión */}
      <TestConnectionPanel
        sourceKey={source.key}
        sourceName={source.name}
      />

      {/* Historial de pruebas */}
      <ConnectionTestHistory history={history} />

      {/* Bloque próximamente */}
      <SurfaceCard className="flex items-start gap-3 border-su-brand/20 bg-su-brand-soft/40">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-su-brand" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Próximamente</p>
          <p className="text-sm text-muted-foreground">
            Las pruebas de extracción mínima estarán disponibles en una fase posterior.
          </p>
        </div>
      </SurfaceCard>
    </div>
  );
}
