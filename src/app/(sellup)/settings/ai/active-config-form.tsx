'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/forms/field';
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

  const filteredModels = models.filter(m => m.provider_id === selectedProvider && m.is_executable !== false);

  const activeModelObj = models.find(m => m.id === activeConfig?.active_model_id);
  const activeModelNonExecutable = activeModelObj?.is_executable === false;

  const handleSave = async () => {
    if (!selectedProvider || !selectedModel) return;
    setSaving(true);
    const result = await setActiveConfig(selectedProvider, selectedModel);
    setSaving(false);
    if (result.success) {
      toast.success('Configuración guardada correctamente');
      setTimeout(() => window.location.reload(), 1000);
    } else {
      toast.error('Error al guardar: ' + (result.error ?? 'Error desconocido'));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {activeModelNonExecutable && (
        <Alert variant="warning">
          El modelo activo de Claude no está disponible. Selecciona otro modelo o usa <strong>Actualizar modelos disponibles</strong> en el proveedor.
        </Alert>
      )}
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
      <Field label="Proveedor activo" className="min-w-0 flex-1">
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
      </Field>
      <Field label="Modelo base" className="min-w-0 flex-1">
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
      </Field>
      <Button
        type="button"
        onClick={handleSave}
        disabled={!selectedProvider || !selectedModel || saving}
      >
        {saving ? 'Guardando...' : 'Guardar'}
      </Button>

    </div>
    </div>
  );
}