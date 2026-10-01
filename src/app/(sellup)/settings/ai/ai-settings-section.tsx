import { formatInAppZone } from '@/lib/format-date';
import { BrainCircuit, CheckCircle, Settings, DollarSign, Clock } from "@/icons";
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { MetricCard } from '@/components/shared/metric-card';
import { Badge } from '@/components/ui/badge';
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

function getConnectionBadge(connStatus: string | undefined): {
  label: string;
  variant: BadgeTone;
  icon: string;
} {
  const map: Record<string, { label: string; variant: BadgeTone; icon: string }> = {
    connected: { label: 'Conectado', variant: 'positive', icon: '✓' },
    not_tested: { label: 'Sin probar', variant: 'neutral', icon: '?' },
    not_configured: { label: 'Sin credenciales', variant: 'warning', icon: '!' },
    error: { label: 'Error conexión', variant: 'negative', icon: '✗' },
  };
  return map[connStatus ?? ''] ?? { label: 'Desconocido', variant: 'neutral', icon: '' };
}

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
            Tarifas
          </TabsTrigger>
        </TabsList>

        <TabsContent value="providers" className="space-y-3">
          {providers.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              No hay proveedores registrados.
            </div>
          ) : (
            providers.map(provider => (
              <div
                key={provider.id}
                className="flex flex-wrap items-center gap-4 rounded-xl border border-border/60 bg-card p-4"
              >
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
                      {getConnectionBadge(provider.connection_status).icon} {getConnectionBadge(provider.connection_status).label}
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
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="models" className="space-y-3">
          {models.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              No hay modelos registrados.
            </div>
          ) : (
            models.map(model => (
              <div
                key={model.id}
                className="flex flex-wrap items-center gap-4 rounded-xl border border-border/60 bg-card p-4"
              >
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
                        In: {formatCurrency(model.current_pricing.input_cost_per_million_tokens, model.current_pricing.currency)}/M
                      </div>
                      <div className="text-muted-foreground">
                        Out: {formatCurrency(model.current_pricing.output_cost_per_million_tokens, model.current_pricing.currency)}/M
                      </div>
                    </div>
                  ) : (
                    <span className="text-xs text-warning">Sin tarifa</span>
                  )}
                </div>
                <AIControls
                  type="model"
                  item={model}
                  activeConfig={activeConfig}
                />
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="tariffs" className="space-y-3">
          {models.filter(m => m.current_pricing).length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              No hay tarifas registradas. Activa un modelo y agrega sus costos.
            </div>
          ) : (
            models
              .filter(m => m.current_pricing)
              .map(model => (
                <div
                  key={model.id}
                  className="flex flex-wrap items-center gap-4 rounded-xl border border-border/60 bg-card p-4"
                >
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
                      <p className="text-xs text-muted-foreground">Input</p>
                      <p className="font-semibold text-foreground">
                        {formatCurrency(model.current_pricing?.input_cost_per_million_tokens ?? 0, model.current_pricing?.currency ?? 'USD')}
                      </p>
                      <p className="text-xs text-muted-foreground">por millón tokens</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground">Output</p>
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
                </div>
              ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
