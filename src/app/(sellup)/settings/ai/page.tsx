import { redirect } from 'next/navigation';
import { BrainCircuit, CheckCircle, Settings, DollarSign, Clock } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { MetricCard } from '@/components/shared/metric-card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  isCurrentUserAdmin,
  getAllAIProviders,
  getAllAIModels,
  getAIActiveConfig,
  getAIConfigSummary,
  updateAIProviderStatus,
  updateAIModelStatus,
  addModelPricing,
} from '@/modules/ai-config/actions';
import type { AIProvider, AIModel } from '@/modules/ai-config/types';
import { AIControls } from './ai-controls';
import { ActiveConfigForm } from './active-config-form';

function formatCurrency(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function getStatusBadge(status: string) {
  const statusConfig: Record<string, { label: string; className: string }> = {
    active: { label: 'Activo', className: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30' },
    inactive: { label: 'Inactivo', className: 'bg-muted text-muted-foreground border-border' },
    not_configured: { label: 'Sin configurar', className: 'bg-amber-500/10 text-amber-500 border-amber-500/30' },
    error: { label: 'Error', className: 'bg-destructive/10 text-destructive border-destructive/30' },
  };
  return statusConfig[status] ?? { label: status, className: '' };
}

function getConnectionBadge(connStatus: string | undefined) {
  const connConfig: Record<string, { label: string; className: string; icon: string }> = {
    connected: { label: 'Conectado', className: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30', icon: '✓' },
    not_tested: { label: 'Sin probar', className: 'bg-muted text-muted-foreground border-border', icon: '?' },
    not_configured: { label: 'Sin credenciales', className: 'bg-amber-500/10 text-amber-500 border-amber-500/30', icon: '!' },
    error: { label: 'Error conexión', className: 'bg-destructive/10 text-destructive border-destructive/30', icon: '✗' },
  };
  return connConfig[connStatus ?? ''] ?? { label: 'Desconocido', className: '', icon: '' };
}

function formatNumber(num: number | null): string {
  if (num === null) return '-';
  return new Intl.NumberFormat('es-CO').format(num);
}

export default async function AIConfigPage() {
  const isAdmin = await isCurrentUserAdmin();

  if (!isAdmin) {
    redirect('/settings');
  }

  const [providers, models, activeConfig, summary] = await Promise.all([
    getAllAIProviders(),
    getAllAIModels(),
    getAIActiveConfig(),
    getAIConfigSummary(),
  ]);

  const activeModels = models.filter(m => m.status === 'active');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Proveedores y tarifas de IA"
        description="Administra los proveedores, modelos y tarifas base que SellUp utilizará para calcular y gobernar el consumo de inteligencia artificial."
        backHref="/settings"
      />

      {/* Summary Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Proveedor activo"
          description="Proveedor configurado"
          value={summary.activeProvider ?? '-'}
          iconPosition="left-large"
          icon={
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-su-brand-soft">
              <BrainCircuit className="h-6 w-6 text-su-brand" />
            </div>
          }
        />

        <MetricCard
          title="Modelo base"
          description="Modelo por defecto"
          value={summary.activeModel ?? '-'}
          iconPosition="left-large"
          icon={
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10">
              <CheckCircle className="h-6 w-6 text-emerald-500" />
            </div>
          }
        />

        <MetricCard
          title="Modelos ejecutables"
          description="Disponibles para invocar"
          value={`${summary.activeModels}/${summary.totalModels}`}
          iconPosition="left-large"
          icon={
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10">
              <Settings className="h-6 w-6 text-blue-500" />
            </div>
          }
        />

        <MetricCard
          title="Última tarifa"
          description="Fecha de actualización"
          value={formatDate(summary.lastPricingUpdate)}
          iconPosition="left-large"
          icon={
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10">
              <Clock className="h-6 w-6 text-amber-500" />
            </div>
          }
        />
      </div>

      {/* Active Configuration */}
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

      {/* Tabs for Providers, Models, Tariffs */}
      <Tabs defaultValue="providers" className="space-y-4">
        <TabsList className="bg-muted/50">
          <TabsTrigger value="providers" className="gap-2">
            <BrainCircuit className="h-4 w-4" />
            Proveedores ({providers.length})
          </TabsTrigger>
          <TabsTrigger value="models" className="gap-2">
            <Settings className="h-4 w-4" />
            Modelos ({models.length})
          </TabsTrigger>
          <TabsTrigger value="tariffs" className="gap-2">
            <DollarSign className="h-4 w-4" />
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
                className="flex items-center gap-4 rounded-xl border border-border/50 bg-card p-4"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-su-brand-soft">
                  <BrainCircuit className="h-5 w-5 text-su-brand" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{provider.name}</span>
                    <Badge variant="outline" className={`text-[10px] ${getStatusBadge(provider.status).className}`}>
                      {getStatusBadge(provider.status).label}
                    </Badge>
                    <Badge variant="outline" className={`text-[10px] ${getConnectionBadge(provider.connection_status).className}`}>
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
                className="flex items-center gap-4 rounded-xl border border-border/50 bg-card p-4"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
                  <Settings className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{model.name}</span>
                    <Badge variant="outline" className={`text-[10px] ${getStatusBadge(model.status).className}`}>
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
                    <span className="text-xs text-amber-500">Sin tarifa</span>
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
                  className="flex items-center gap-4 rounded-xl border border-border/50 bg-card p-4"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10">
                    <DollarSign className="h-5 w-5 text-amber-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{model.name}</span>
                      <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-500 border-emerald-500/30">
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
                      <p className="text-[10px] text-muted-foreground">por millón tokens</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground">Output</p>
                      <p className="font-semibold text-foreground">
                        {formatCurrency(model.current_pricing?.output_cost_per_million_tokens ?? 0, model.current_pricing?.currency ?? 'USD')}
                      </p>
                      <p className="text-[10px] text-muted-foreground">por millón tokens</p>
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