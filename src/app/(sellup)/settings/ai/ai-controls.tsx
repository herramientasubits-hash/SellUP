'use client';

import { useState, useEffect } from 'react';
import { MoreHorizontal, Check, X, Plus, Settings, Eye, EyeOff, Key, Unplug } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import {
  updateAIProviderStatus,
  updateAIModelStatus,
  setActiveConfig,
  addModelPricing,
  testAIProviderConnection,
  connectAiProvider,
  updateAiProviderCredential,
  disconnectAiProvider,
  testAiProviderConnectionWithVault,
  getAiProviderConnectionStatus,
  syncAnthropicModels,
} from '@/modules/ai-config/actions';
import type { AIProvider, AIModel, AIActiveConfig } from '@/modules/ai-config/types';

interface AIControlsProps {
  type: 'provider' | 'model' | 'pricing';
  item: AIProvider | AIModel;
  models?: AIModel[];
  activeConfig?: AIActiveConfig | null;
}

export function AIControls({ type, item, models, activeConfig }: AIControlsProps) {
  const [showPricingDialog, setShowPricingDialog] = useState(false);
  const [showActiveDialog, setShowActiveDialog] = useState(false);
  const [showConnectDialog, setShowConnectDialog] = useState(false);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [inputCost, setInputCost] = useState('');
  const [outputCost, setOutputCost] = useState('');
  const [loading, setLoading] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [syncingModels, setSyncingModels] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<{
    has_credential: boolean;
    connection_status: string;
    can_activate: boolean;
  }>({ has_credential: false, connection_status: 'not_configured', can_activate: false });

  const provider = type === 'provider' ? (item as AIProvider) : null;
  const model = type === 'model' || type === 'pricing' ? (item as AIModel) : null;

  const handleStatusChange = async (newStatus: string) => {
    setLoading(true);
    if (type === 'provider') {
      await updateAIProviderStatus(item.id, newStatus);
    } else if (type === 'model') {
      await updateAIModelStatus(item.id, newStatus);
    }
    setLoading(false);
    window.location.reload();
  };

  const handleSetActive = async () => {
    if (!selectedModelId) return;
    setLoading(true);
    const result = await setActiveConfig(item.id, selectedModelId);
    setLoading(false);
    if (result.success) {
      setShowActiveDialog(false);
      window.location.reload();
    }
  };

  const handleAddPricing = async () => {
    if (!inputCost || !outputCost) return;
    setLoading(true);
    const result = await addModelPricing(
      item.id,
      parseFloat(inputCost),
      parseFloat(outputCost)
    );
    setLoading(false);
    if (result.success) {
      setShowPricingDialog(false);
      setInputCost('');
      setOutputCost('');
      window.location.reload();
    }
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const handleConnect = async () => {
    if (!provider || !apiKey) return;
    setLoading(true);
    let result;
    try {
      result = await connectAiProvider(provider.key, apiKey);
    } catch (err: any) {
      showToast(`Error de conexión: ${err.message || err}`, 'error');
      setLoading(false);
      return;
    }
    setLoading(false);
    if (!result) {
      showToast('No se recibió respuesta del servidor', 'error');
      return;
    }
    if (result.success) {
      setShowConnectDialog(false);
      setApiKey('');
      showToast(result.message || 'Proveedor conectado correctamente', 'success');
      console.log('Conectado! Recargando en 1.5s...');
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } else {
      showToast(result.message || 'Error al conectar', 'error');
    }
  };

  const handleUpdateCredential = async () => {
    if (!provider || !apiKey) return;
    setLoading(true);
    const result = await updateAiProviderCredential(provider.key, apiKey);
    setLoading(false);
    if (result.success) {
      setShowUpdateDialog(false);
      setApiKey('');
      showToast(result.message || 'Credencial actualizada correctamente', 'success');
      setTimeout(() => window.location.reload(), 1500);
    } else {
      showToast(result.message || 'Error al actualizar', 'error');
    }
  };

  const handleDisconnect = async () => {
    console.log('handleDisconnect clicked, provider:', provider?.key);
    if (!provider) return;
    setLoading(true);
    const result = await disconnectAiProvider(provider.key);
    console.log('handleDisconnect result:', result);
    setLoading(false);
    if (result.success) {
      setShowDisconnectDialog(false);
      showToast(result.message || 'Proveedor desconectado correctamente', 'success');
      setTimeout(() => window.location.reload(), 1500);
    } else {
      showToast(result.message || 'Error al desconectar: ' + result.message, 'error');
    }
  };

  const handleSyncAnthropicModels = async () => {
    if (!provider || provider.key !== 'anthropic') return;
    setSyncingModels(true);
    try {
      const result = await syncAnthropicModels();
      if (result.success) {
        const executableCount = result.models_checked.filter((m) => m.is_executable).length;
        const total = result.models_checked.length;
        showToast(
          `Modelos sincronizados: ${executableCount}/${total} ejecutables. Nuevos: ${result.models_added.length}.`,
          executableCount > 0 ? 'success' : 'error'
        );
      } else {
        showToast(result.error || 'Error al sincronizar modelos', 'error');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Error inesperado: ${msg}`, 'error');
    }
    setSyncingModels(false);
    setTimeout(() => window.location.reload(), 2000);
  };

  const handleTestConnection = async () => {
    if (!provider) return;
    setTestingConnection(true);
    const result = await testAiProviderConnectionWithVault(provider.key);
    setTestingConnection(false);
    console.group('[testVault] Resultado desde servidor');
    (result.debugLogs ?? []).forEach(l => console.log(l));
    console.log('[testVault] success:', result.success, '| error:', result.error, '| message:', result.message);
    console.groupEnd();
    if (result.success) {
      showToast(result.message || 'Conexión exitosa', 'success');
    } else {
      showToast(result.message || 'Error de conexión: ' + result.message, 'error');
    }
    setTimeout(() => window.location.reload(), 1500);
  };

  if (type === 'pricing' && model) {
    return (
      <>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowPricingDialog(true)}
          className="gap-2"
        >
          <Plus className="h-4 w-4" />
          Nueva tarifa
        </Button>

        <Dialog open={showPricingDialog} onOpenChange={setShowPricingDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Registrar nueva tarifa</DialogTitle>
              <DialogDescription>
                Ingresa los costos por millón de tokens para {model.name}.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="input-cost">Costo input (por millón tokens)</Label>
                <Input
                  id="input-cost"
                  type="number"
                  step="0.0001"
                  placeholder="0.00"
                  value={inputCost}
                  onChange={(e) => setInputCost(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="output-cost">Costo output (por millón tokens)</Label>
                <Input
                  id="output-cost"
                  type="number"
                  step="0.0001"
                  placeholder="0.00"
                  value={outputCost}
                  onChange={(e) => setOutputCost(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowPricingDialog(false)}>
                Cancelar
              </Button>
              <Button onClick={handleAddPricing} disabled={loading || !inputCost || !outputCost}>
                Guardar tarifa
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger>
          <div className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md hover:bg-muted">
            <MoreHorizontal className="h-4 w-4" />
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {type === 'provider' && provider && (
            <>
              {(provider.credentials_status === 'configured' || provider.connection_status === 'connected') ? (
                <>
                  <DropdownMenuItem 
                    onClick={() => setShowActiveDialog(true)}
                    disabled={provider.connection_status !== 'connected'}
                  >
                    <Settings className="mr-2 h-4 w-4" />
                    Configurar como activo
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    onClick={handleTestConnection} 
                    disabled={testingConnection}
                  >
                    <div className="mr-2 h-4 w-4 animate-spin">⟳</div>
                    {testingConnection ? 'Probando...' : 'Probar conexión'}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setShowUpdateDialog(true)}>
                    <Key className="mr-2 h-4 w-4" />
                    Actualizar credencial
                  </DropdownMenuItem>
                  {provider.key === 'anthropic' && (
                    <DropdownMenuItem
                      onClick={handleSyncAnthropicModels}
                      disabled={syncingModels}
                    >
                      <div className="mr-2 h-4 w-4">↻</div>
                      {syncingModels ? 'Sincronizando...' : 'Actualizar modelos disponibles'}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => setShowDisconnectDialog(true)}>
                    <Unplug className="mr-2 h-4 w-4" />
                    Desconectar proveedor
                  </DropdownMenuItem>
                </>
              ) : (
                <>
                  <DropdownMenuItem onClick={() => setShowConnectDialog(true)}>
                    <Key className="mr-2 h-4 w-4" />
                    Conectar proveedor
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              {provider.status === 'inactive' && (
                <DropdownMenuItem onClick={() => handleStatusChange('active')}>
                  <Check className="mr-2 h-4 w-4" />
                  Activar proveedor
                </DropdownMenuItem>
              )}
              {provider.status === 'active' && (
                <DropdownMenuItem onClick={() => handleStatusChange('inactive')}>
                  <X className="mr-2 h-4 w-4" />
                  Desactivar proveedor
                </DropdownMenuItem>
              )}
            </>
          )}
          {type === 'model' && model && (
            <>
              {model.status === 'inactive' && (
                <DropdownMenuItem onClick={() => handleStatusChange('active')}>
                  <Check className="mr-2 h-4 w-4" />
                  Activar modelo
                </DropdownMenuItem>
              )}
              {model.status === 'active' && (
                <>
                  <DropdownMenuItem onClick={() => handleStatusChange('inactive')}>
                    <X className="mr-2 h-4 w-4" />
                    Desactivar modelo
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setShowPricingDialog(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Agregar tarifa
                  </DropdownMenuItem>
                </>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Active Config Dialog */}
      <Dialog open={showActiveDialog} onOpenChange={setShowActiveDialog}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Configurar proveedor activo</DialogTitle>
            <DialogDescription>
              Selecciona el modelo base que se utilizará para las ejecuciones de IA con {provider?.name}.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Select value={selectedModelId} onValueChange={(value) => setSelectedModelId(value || '')}>
              <SelectTrigger className="w-full">
                {selectedModelId ? (
                  <span className="truncate">
                    {models?.find(m => m.id === selectedModelId)?.name}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Seleccionar modelo</span>
                )}
              </SelectTrigger>
              <SelectContent>
                {(models ?? []).filter(m => m.provider_id === provider?.id).map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowActiveDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSetActive} disabled={!selectedModelId || loading}>
              Guardar configuración
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Pricing Dialog */}
      <Dialog open={showPricingDialog} onOpenChange={setShowPricingDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar nueva tarifa</DialogTitle>
            <DialogDescription>
              Ingresa los costos por millón de tokens para {model?.name}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="input-cost">Costo input (por millón tokens)</Label>
              <Input
                id="input-cost"
                type="number"
                step="0.0001"
                placeholder="0.00"
                value={inputCost}
                onChange={(e) => setInputCost(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="output-cost">Costo output (por millón tokens)</Label>
              <Input
                id="output-cost"
                type="number"
                step="0.0001"
                placeholder="0.00"
                value={outputCost}
                onChange={(e) => setOutputCost(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPricingDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleAddPricing} disabled={loading || !inputCost || !outputCost}>
              Guardar tarifa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Connect Provider Dialog */}
      <Dialog open={showConnectDialog} onOpenChange={(open) => { setShowConnectDialog(open); if (!open) setApiKey(''); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Conectar {provider?.name}</DialogTitle>
            <DialogDescription>
              Ingresa la API key del proveedor. Esta credencial se almacenará de forma segura y no volverá a mostrarse después de guardarla.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="api-key">API Key</Label>
              <div className="relative">
                <Input
                  id="api-key"
                  type={showApiKey ? 'text' : 'password'}
                  placeholder="Pegar API key..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              La clave se cifrará y almacenará de forma segura en Supabase Vault.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowConnectDialog(false); setApiKey(''); }}>
              Cancelar
            </Button>
            <Button onClick={handleConnect} disabled={!apiKey || loading}>
              Guardar credencial
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Update Credential Dialog */}
      <Dialog open={showUpdateDialog} onOpenChange={(open) => { setShowUpdateDialog(open); if (!open) setApiKey(''); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Actualizar credencial de {provider?.name}</DialogTitle>
            <DialogDescription>
              La nueva API key reemplazará la credencial anterior. Después de actualizarla, deberás probar nuevamente la conexión.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="update-api-key">Nueva API Key</Label>
              <div className="relative">
                <Input
                  id="update-api-key"
                  type={showApiKey ? 'text' : 'password'}
                  placeholder="Pegar nueva API key..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowUpdateDialog(false); setApiKey(''); }}>
              Cancelar
            </Button>
            <Button onClick={handleUpdateCredential} disabled={!apiKey || loading}>
              Actualizar y probar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disconnect Provider Dialog */}
      <Dialog open={showDisconnectDialog} onOpenChange={setShowDisconnectDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Desconectar {provider?.name}</DialogTitle>
            <DialogDescription>
              ¿Estás seguro de que deseas desconectar este proveedor? La credencial se eliminará y no podrá ser utilizado como proveedor activo.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              Esta acción no se puede deshacer. Si deseas volver a conectar el proveedor, tendrás que ingresar una nueva API key.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDisconnectDialog(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDisconnect} disabled={loading}>
              Desconectar proveedor
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-8 left-1/2 -translate-x-1/2 transform px-4 py-3 rounded-lg shadow-lg border z-50 bg-card ${
          toast.type === 'success'
            ? 'border-emerald-500/50 text-emerald-700 dark:text-emerald-400'
            : 'border-destructive/50 text-destructive'
        }`}>
          {toast.message}
        </div>
      )}
    </>
  );
}