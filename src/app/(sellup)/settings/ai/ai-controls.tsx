'use client';

import { useState } from 'react';
import { Check, MoreHorizontal, Plus, X } from '@/icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { updateAIModelStatus } from '@/modules/ai-config/actions';
import type { AIProvider, AIModel, AIActiveConfig } from '@/modules/ai-config/types';
import { AIProviderControls } from './ai-provider-controls';
import { ModelPricingModal } from './model-pricing-modal';

interface AIControlsProps {
  type: 'provider' | 'model' | 'pricing';
  item: AIProvider | AIModel;
  models?: AIModel[];
  activeConfig?: AIActiveConfig | null;
}

/** «Nueva tarifa»: el botón de la pestaña de tarifas y su diálogo. */
function PricingControls({ model }: { model: AIModel }) {
  const [showPricingDialog, setShowPricingDialog] = useState(false);

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setShowPricingDialog(true)}>
        <Plus aria-hidden="true" />
        Nueva tarifa
      </Button>
      <ModelPricingModal
        modelId={model.id}
        modelName={model.name}
        open={showPricingDialog}
        onOpenChange={setShowPricingDialog}
      />
    </>
  );
}

/** El menú de un modelo: activarlo, desactivarlo o registrar su tarifa. */
function ModelControls({ model }: { model: AIModel }) {
  const [showPricingDialog, setShowPricingDialog] = useState(false);

  const handleStatusChange = async (newStatus: string) => {
    await updateAIModelStatus(model.id, newStatus);
    window.location.reload();
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Abrir acciones de ${model.name}`}
              className="text-muted-foreground"
            />
          }
        >
          <MoreHorizontal aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
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
        </DropdownMenuContent>
      </DropdownMenu>
      <ModelPricingModal
        modelId={model.id}
        modelName={model.name}
        open={showPricingDialog}
        onOpenChange={setShowPricingDialog}
      />
    </>
  );
}

/**
 * Las acciones de una fila de Configuración de IA. Según `type` son las de un
 * proveedor, las de un modelo o el botón de tarifa.
 */
export function AIControls({ type, item, models }: AIControlsProps) {
  if (type === 'pricing') return <PricingControls model={item as AIModel} />;
  if (type === 'model') return <ModelControls model={item as AIModel} />;
  return <AIProviderControls provider={item as AIProvider} models={models ?? []} />;
}
