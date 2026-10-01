import { formatInAppZone } from '@/lib/format-date';
import { BrainCircuit, CheckCircle, Settings, DollarSign, Clock } from "@/icons";
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { MetricCard } from '@/components/shared/metric-card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  getAllAIProviders,
  getAllAIModels,
  getAIActiveConfig,
  getAIConfigSummary,
} from '@/modules/ai-config/actions';
import { AIControls } from './ai-controls';
import { ActiveConfigForm } from './active-config-form';

function formatCurrency(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return formatInAppZone(dateStr, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }, 'es-CO');
}

type BadgeTone = 'positive' | 'neutral' | 'warning' | 'negative';

function getStatusBadge(status: string): { label: string; variant: BadgeTone } {
  const map: Record<string, { label: string; variant: BadgeTone }> = {
    active: { label: 'Activo', variant: 'positive' },
    inactive: { label: 'Inactivo', variant: 'neutral' },
    not_configured: { label: 'Sin configurar', variant: 'warning' },
    error: { label: 'Error', variant: 'negative' },
  };
  return map[status] ?? { label: status, variant: 'neutral' };
}

function getConnectionBadge(connStatus: string | undefined): { label: string; variant: BadgeTone } {
  const map: Record<string, { label: string; variant: BadgeTone }> = {
    connected: { label: 'Conectado', variant: 'positive' },
    not_tested: { label: 'Conexión sin probar', variant: 'neutral' },
    not_configured: { label: 'Sin credenciales', variant: 'warning' },
    error: { label: 'Error de conexión', variant: 'negative' },
  };
  return map[connStatus ?? ''] ?? { label: 'Desconocido', variant: 'neutral' };
}

/** Una fila de las listas de proveedores, modelos y tarifas. */
const ROW_CLASS = 'flex flex-wrap items-center gap-4 px-5 py-4';
/** La lista vive en una sola tarjeta: las filas se separan con una línea, no con cajas. */
const LIST_CLASS = 'divide-y divide-border/50';

function formatNumber(num: number | null): string {
  if (num === null) return '-';
  return new Intl.NumberFormat('es-CO').format(num);
}

export async function AiSettingsSection() {
  const [providers, models, activeConfig, summary] = await Promise.all([
    getAllAIProviders(),
    getAllAIModels(),
    getAIActiveConfig(),
    getAIConfigSummary(),
  ]);

  const pricedModels = models.filter(m => m.current_pricing);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Proveedor activo"
          description="Proveedor configurado"
          value={summary.activeProvider ?? '-'}
          iconPosition="left-large"
          icon={
            <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10">
              <BrainCircuit className="size-6 text-primary" />
            </div>
          }
        />
        <MetricCard
          title="Modelo base"
          description="Modelo por defecto"
          value={summary.activeModel ?? '-'}
          iconPosition="left-large"
          icon={
            <div className="flex size-12 items-center justify-center rounded-xl bg-success/10">
              <CheckCircle className="size-6 text-success" />
            </div>
          }
        />
        <MetricCard
          title="Modelos ejecutables"
          description="Disponibles para invocar"
          value={`${summary.activeModels}/${summary.totalModels}`}
          iconPosition="left-large"
          icon={
            <div className="flex size-12 items-center justify-center rounded-xl bg-info/10">
              <Settings className="size-6 text-info" />
            </div>
          }
        />
        <MetricCard
          title="Última tarifa"
          description="Fecha de actualización"
          value={formatDate(summary.lastPricingUpdate)}
          iconPosition="left-large"
          icon={
            <div className="flex size-12 items-center justify-center rounded-xl bg-warning/10">
              <Clock className="size-6 text-warning" />
            </div>
          }
        />
      </div>

      <SurfaceCard>
        <SurfaceCardHeader
          title="Configuración activa del sistema"
          description="Esta configuración será la base para futuras ejecuciones de IA, salvo configuraciones específicas por agente en fases posteriores."
        />
        <ActiveConfigForm
          providers={providers}
          models={models}
          activeConfig={activeConfig}
        />
      </SurfaceCard>

      <Tabs defaultValue="providers" className="space-y-4">
        <TabsList>
          <TabsTrigger value="providers" className="gap-2">
            <BrainCircuit className="size-4" />
            Proveedores ({providers.length})
          </TabsTrigger>
          <TabsTrigger value="models" className="gap-2">
            <Settings className="size-4" />
            Modelos ({models.length})
          </TabsTrigger>
          <TabsTrigger value="tariffs" className="gap-2">
            <DollarSign className="size-4" />
            Tarifas ({pricedModels.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="providers">
          {providers.length === 0 ? (
            <EmptyState
              icon={BrainCircuit}
              title="No hay proveedores de IA"
              description="Cuando se registre un proveedor aparecerá aquí para conectarlo."
            />
          ) : (
            <SurfaceCard noPadding>
            <ul className={LIST_CLASS}>
            {providers.map(provider => (
              <li key={provider.id} className={ROW_CLASS}>
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                  <BrainCircuit className="size-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium text-foreground">{provider.name}</span>
                    <Badge variant={getStatusBadge(provider.status).variant}>
                      {getStatusBadge(provider.status).label}
                    </Badge>
                    <Badge variant={getConnectionBadge(provider.connection_status).variant}>
                      {getConnectionBadge(provider.connection_status).label}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{provider.description}</p>
                </div>
                <div className="text-sm text-muted-foreground">
                  {provider.model_count} modelos
                </div>
                <AIControls
                  type="provider"
                  item={provider}
                  models={models.filter(m => m.provider_id === provider.id)}
                />
              </li>
            ))}
            </ul>
            </SurfaceCard>
          )}
        </TabsContent>

        <TabsContent value="models">
          {models.length === 0 ? (
            <EmptyState
              icon={Settings}
              title="No hay modelos registrados"
              description="Conecta un proveedor y actualiza sus modelos disponibles para verlos aquí."
            />
          ) : (
            <SurfaceCard noPadding>
            <ul className={LIST_CLASS}>
            {models.map(model => (
              <li key={model.id} className={ROW_CLASS}>
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
                  <Settings className="size-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium text-foreground">{model.name}</span>
                    <Badge variant={getStatusBadge(model.status).variant}>
                      {getStatusBadge(model.status).label}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{model.provider_name}</span>
                    <span>•</span>
                    <span className="font-mono">{model.key}</span>
                    {model.context_window_tokens && (
                      <>
                        <span>•</span>
                        <span>{formatNumber(model.context_window_tokens)} tokens</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  {model.current_pricing ? (
                    <div className="text-sm">
                      <div className="text-muted-foreground">
                        Entrada: {formatCurrency(model.current_pricing.input_cost_per_million_tokens, model.current_pricing.currency)}/M
                      </div>
                      <div className="text-muted-foreground">
                        Salida: {formatCurrency(model.current_pricing.output_cost_per_million_tokens, model.current_pricing.currency)}/M
                      </div>
                    </div>
                  ) : (
                    <Badge variant="warning">Sin tarifa</Badge>
                  )}
                </div>
                <AIControls
                  type="model"
                  item={model}
                  activeConfig={activeConfig}
                />
              </li>
            ))}
            </ul>
            </SurfaceCard>
          )}
        </TabsContent>

        <TabsContent value="tariffs">
          {pricedModels.length === 0 ? (
            <EmptyState
              icon={DollarSign}
              title="No hay tarifas registradas"
              description="Activa un modelo y agrega su tarifa desde la pestaña Modelos para calcular el costo de cada ejecución."
            />
          ) : (
            <SurfaceCard noPadding>
            <ul className={LIST_CLASS}>
            {pricedModels.map(model => (
                <li key={model.id} className={ROW_CLASS}>
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-warning/10">
                    <DollarSign className="size-5 text-warning" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium text-foreground">{model.name}</span>
                      <Badge variant="outline">
                        Vigente
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Vigencia: desde {formatDate(model.current_pricing?.effective_from ?? null)}
                    </p>
                  </div>
                  <div className="flex gap-6">
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground">Entrada</p>
                      <p className="font-semibold text-foreground">
                        {formatCurrency(model.current_pricing?.input_cost_per_million_tokens ?? 0, model.current_pricing?.currency ?? 'USD')}
                      </p>
                      <p className="text-xs text-muted-foreground">por millón tokens</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground">Salida</p>
                      <p className="font-semibold text-foreground">
                        {formatCurrency(model.current_pricing?.output_cost_per_million_tokens ?? 0, model.current_pricing?.currency ?? 'USD')}
                      </p>
                      <p className="text-xs text-muted-foreground">por millón tokens</p>
                    </div>
                  </div>
                  <AIControls
                    type="pricing"
                    item={model}
                  />
                </li>
            ))}
            </ul>
            </SurfaceCard>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
