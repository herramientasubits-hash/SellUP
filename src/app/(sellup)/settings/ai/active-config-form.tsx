'use client';

import { useState } from 'react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { setActiveConfig } from '@/modules/ai-config/actions';
import type { AIProvider, AIModel, AIActiveConfig } from '@/modules/ai-config/types';

interface ActiveConfigFormProps {
  providers: AIProvider[];
  models: AIModel[];
  activeConfig: AIActiveConfig | null;
}

export function ActiveConfigForm({ providers, models, activeConfig }: ActiveConfigFormProps) {
  const [selectedProvider, setSelectedProvider] = useState<string>(
    activeConfig?.active_provider_id ?? ''
  );
  const [selectedModel, setSelectedModel] = useState<string>(
    activeConfig?.active_model_id ?? ''
  );
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const filteredModels = models.filter(m => m.provider_id === selectedProvider && m.is_executable !== false);

  const activeModelObj = models.find(m => m.id === activeConfig?.active_model_id);
  const activeModelNonExecutable = activeModelObj?.is_executable === false;

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const handleSave = async () => {
    if (!selectedProvider || !selectedModel) return;
    setSaving(true);
    const result = await setActiveConfig(selectedProvider, selectedModel);
    setSaving(false);
    if (result.success) {
      showToast('Configuración guardada correctamente', 'success');
      setTimeout(() => window.location.reload(), 1000);
    } else {
      showToast('Error al guardar: ' + (result.error ?? 'Error desconocido'), 'error');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {activeModelNonExecutable && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-700 dark:text-amber-400">
          El modelo activo de Claude no está disponible. Selecciona otro modelo o usa <strong>Actualizar modelos disponibles</strong> en el proveedor.
        </div>
      )}
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
      <div className="flex-1">
        <Label className="text-xs text-muted-foreground mb-1.5 block">Proveedor activo</Label>
        <Select 
          value={selectedProvider} 
          onValueChange={(value) => {
            if (value) {
              setSelectedProvider(value);
              const firstModelOfProvider = models.find(m => m.provider_id === value && m.is_executable !== false);
              setSelectedModel(firstModelOfProvider?.id ?? '');
            }
          }}
        >
          <SelectTrigger className="w-full justify-between">
            {selectedProvider ? (
              <span className="truncate">
                {providers.find(p => p.id === selectedProvider)?.name}
              </span>
            ) : (
              <span className="text-muted-foreground">Seleccionar proveedor</span>
            )}
          </SelectTrigger>
          <SelectContent>
            {providers.map(p => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex-1">
        <Label className="text-xs text-muted-foreground mb-1.5 block">Modelo base</Label>
        <Select 
          value={selectedModel || ''}
          onValueChange={(value) => setSelectedModel(value || '')}
        >
          <SelectTrigger className="w-full justify-between">
            {selectedModel ? (
              <span className="truncate">
                {models.find(m => m.id === selectedModel)?.name}
              </span>
            ) : (
              <span className="text-muted-foreground">Seleccionar modelo</span>
            )}
          </SelectTrigger>
          <SelectContent>
            {filteredModels.length === 0 ? (
              <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                No hay modelos ejecutables. Actualiza modelos disponibles o revisa la API key.
              </div>
            ) : (
              filteredModels.map(m => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>
      <button
        onClick={handleSave}
        disabled={!selectedProvider || !selectedModel || saving}
        className="px-4 py-2 bg-su-brand text-white rounded-md hover:bg-su-brand/90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {saving ? 'Guardando...' : 'Guardar'}
      </button>

      {toast && (
        <div className={`fixed bottom-8 left-1/2 -translate-x-1/2 transform px-4 py-3 rounded-lg shadow-lg border z-50 bg-card ${
          toast.type === 'success'
            ? 'border-emerald-500/50 text-emerald-700 dark:text-emerald-400'
            : 'border-destructive/50 text-destructive'
        }`}>
          {toast.message}
        </div>
      )}
    </div>
    </div>
  );
}