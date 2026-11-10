import { SettingsPage, TechnicalDetails } from '@/components/settings/settings-page';
import {
  IntegrationCapabilities,
  IntegrationStatusCard,
  TechnicalRow,
} from '@/components/settings/integration-overview';
import { MetricStrip } from '@/components/shared/metric-strip';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { Alert } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import type { SupabaseOverview } from '@/modules/storage-usage/storage-usage.server';
import {
  evaluateStorageCapacity,
  formatBytes,
  formatPercent,
  formatRows,
  groupStorageByCategory,
  type StorageCapacity,
  type StorageCategoryUsage,
} from '@/modules/storage-usage/storage-categories';
import { SupabaseTestConnectionButton } from './supabase-test-button';

/** Cuántas tablas se nombran debajo de cada categoría. */
const TABLES_PER_CATEGORY = 3;

/**
 * Lo que se ve en Integraciones › Supabase. Sin carga de datos: la página lee
 * y le pasa `overview`, así la vista se puede montar con datos de ejemplo.
 */
export function SupabaseOverviewView({ overview }: { overview: SupabaseOverview }) {
  const { connection, report } = overview;
  const capacity = report ? evaluateStorageCapacity(report.databaseBytes, overview.includedGb) : null;
  const categories = report ? groupStorageByCategory(report) : [];

  return (
    <SettingsPage
      title="Supabase"
      description="La base de datos donde SellUp guarda empresas, contactos y búsquedas. Mira si responde, cuánto espacio usa y qué pesa cada cosa."
      trail={[{ label: 'Integraciones comerciales', href: '/settings/integrations' }]}
    >
      {capacity && report && <CapacitySection capacity={capacity} databaseBytes={report.databaseBytes} overview={overview} categories={categories} />}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <IntegrationStatusCard
          name="Supabase"
          hasCredential={connection.failure !== 'not_configured'}
          connectionStatus={connection.ok ? 'connected' : 'error'}
          lastTestedAt={overview.checkedAt}
          lastError={connection.message}
          facts={[
            { label: 'Proyecto', value: overview.projectRef ?? overview.host ?? 'Sin configurar' },
            ...(connection.latencyMs != null ? [{ label: 'Tiempo de respuesta', value: `${connection.latencyMs} ms` }] : []),
          ]}
          credentialNote="Las llaves de Supabase viven en las variables de entorno de Vercel: nunca se muestran en el navegador ni se pegan aquí."
        >
          <SupabaseTestConnectionButton />
        </IntegrationStatusCard>

        <IntegrationCapabilities
          name="Supabase"
          description="Las credenciales viven en las variables de entorno del servidor (Vercel): no se pegan aquí."
          capabilities={[
            { label: 'Comprobar que la base responde', state: connection.ok ? 'ready' : 'pending' },
            {
              label: 'Ver cuánto espacio usa la base',
              state: report ? 'ready' : 'pending',
            },
            { label: 'Ver qué pesa cada cosa (empresas, contactos, búsquedas…)', state: report ? 'ready' : 'pending' },
            { label: 'Avisar y frenar búsquedas cuando el espacio se acabe', state: 'soon' },
          ]}
        />
      </div>

      {overview.reportFailure === 'missing_function' && (
        <Alert variant="info">
          Para medir el espacio falta aplicar la migración 162 (<code>sellup_storage_usage</code>) en esta base.
          Sólo lee tamaños: no cambia datos.
        </Alert>
      )}

      {overview.reportFailure === 'error' && (
        <Alert variant="destructive">No se pudo medir el espacio de la base. Vuelve a probar en unos minutos.</Alert>
      )}

      {categories.length > 0 && <CategoryBreakdown categories={categories} />}

      <TechnicalDetails summary="Cada tabla con su peso y sus filas. Útil para soporte.">
        <div>
          <TechnicalRow label="Servidor">{overview.host ?? 'Sin configurar'}</TechnicalRow>
          <TechnicalRow label="Disco incluido de referencia">{`${overview.includedGb} GB (SUPABASE_DISK_INCLUDED_GB)`}</TechnicalRow>
          {categories.flatMap((category) =>
            category.tables.map((table) => (
              <TechnicalRow key={`${table.schema}.${table.name}`} label={`${table.schema}.${table.name}`}>
                {`${formatBytes(table.totalBytes)} · ${formatRows(table.rows, !table.rowsExact)} filas`}
              </TechnicalRow>
            )),
          )}
        </div>
      </TechnicalDetails>
    </SettingsPage>
  );
}

// ─── Espacio usado ───────────────────────────────────────────────────────────

/**
 * En el plan Pro los GB incluidos no son un tope: Supabase amplía el disco solo
 * (al 90 % lo agranda un 50 %) y cobra lo que pase de lo incluido. Por eso los
 * avisos hablan de costo, no de bloqueo; el bloqueo («sólo lectura») sólo llega
 * si el disco se llena más rápido de lo que Supabase alcanza a ampliarlo.
 */
const CAPACITY_COPY: Record<
  StorageCapacity['level'],
  { variant: 'info' | 'warning'; title: string; body: string } | null
> = {
  ok: null,
  warning: {
    variant: 'info',
    title: 'La base se acerca al espacio incluido en el plan.',
    body: 'No pasa nada al llegar: Supabase amplía el disco solo y SellUp sigue guardando búsquedas. Lo que pase de lo incluido se cobra aparte (unos US$0,125 por GB al mes).',
  },
  over: {
    variant: 'warning',
    title: 'La base usa más de lo incluido en el plan: se cobra el extra.',
    body: 'SellUp sigue funcionando y guardando búsquedas: Supabase amplía el disco solo y cobra lo que pase de lo incluido (unos US$0,125 por GB al mes). Si la organización tiene el tope de gasto activado, Supabase avisa por correo a facturación en vez de cobrar.',
  },
};

function CapacitySection({
  capacity,
  databaseBytes,
  overview,
  categories,
}: {
  capacity: StorageCapacity;
  databaseBytes: number;
  overview: SupabaseOverview;
  categories: StorageCategoryUsage[];
}) {
  const heaviest = categories[0];
  const copy = CAPACITY_COPY[capacity.level];
  const dashboardHref = overview.projectRef
    ? `https://supabase.com/dashboard/project/${overview.projectRef}/settings/compute-and-disk`
    : 'https://supabase.com/dashboard';

  return (
    <div className="space-y-3">
      <MetricStrip
        title="Espacio de la base"
        items={[
          {
            label: 'Espacio usado',
            value: formatBytes(databaseBytes),
            description: `${formatPercent(capacity.percent)} de lo incluido`,
          },
          {
            label: 'Incluido en el plan',
            value: `${overview.includedGb} GB`,
            hint: 'Lo que trae el precio del plan Pro, no un tope: por encima, Supabase amplía el disco solo y cobra el extra. Se cambia con SUPABASE_DISK_INCLUDED_GB.',
            description: 'Plan Pro de Supabase',
          },
          {
            label: 'Lo que más pesa',
            value: heaviest?.label ?? '—',
            description: heaviest ? `${formatBytes(heaviest.totalBytes)} · ${formatPercent(heaviest.share)} del total` : undefined,
          },
        ]}
      />
      {copy && (
        <Alert variant={copy.variant}>
          <p className="text-sm font-semibold">{copy.title}</p>
          <p className="text-xs leading-relaxed">
            {copy.body} El tamaño del disco y el cobro se ven en el{' '}
            <a href={dashboardHref} target="_blank" rel="noreferrer" className="font-medium text-primary underline-offset-2 hover:underline">
              panel de Supabase
            </a>
            .
          </p>
        </Alert>
      )}
    </div>
  );
}

// ─── Qué pesa cada cosa ──────────────────────────────────────────────────────

function CategoryBreakdown({ categories }: { categories: StorageCategoryUsage[] }) {
  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Qué pesa cada cosa"
        description="Cuánto ocupa cada parte de SellUp en la base, de la más pesada a la más liviana."
      />
      <ul className="divide-y divide-border/60">
        {categories.map((category) => (
          <li key={category.key} className="space-y-2 py-3.5 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{category.label}</p>
                <p className="text-xs text-muted-foreground">{category.description}</p>
              </div>
              <p className="shrink-0 text-sm tabular-nums text-foreground">
                <span className="font-semibold">{formatBytes(category.totalBytes)}</span>
                <span className="text-muted-foreground"> · {formatPercent(category.share)}</span>
              </p>
            </div>
            <Progress value={Math.min(category.share, 100)} aria-label={`${category.label}: ${formatPercent(category.share)} del total`} />
            <p className="text-xs text-muted-foreground">
              {formatRows(category.rows, category.rowsApproximate)} filas ·{' '}
              {category.tables
                .slice(0, TABLES_PER_CATEGORY)
                .map((t) => `${t.name} (${formatBytes(t.totalBytes)})`)
                .join(', ')}
              {category.tables.length > TABLES_PER_CATEGORY && ` y ${category.tables.length - TABLES_PER_CATEGORY} más`}
            </p>
          </li>
        ))}
      </ul>
    </SurfaceCard>
  );
}
