'use client';

import * as React from 'react';
import { AlertCircle, PenLine, Plus, Sparkles, Upload } from '@/icons';

import { RailScreenActions, type RailActionSpec } from '@/components/action-rail';
import { CreateCandidateDrawer } from '@/components/prospect-batches/create-candidate-drawer';
import { ImportCandidatesDrawer } from '@/components/prospect-batches/import-candidates-drawer';

/** Lo que este componente necesita poder decirle al asistente de IA. */
interface ControllablePanelProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface ProspectsScreenActionsProps {
  /**
   * El asistente «Generar con IA» ya resuelto por el servidor
   * (`<GenerateAIBatchDrawer … />`). Aquí solo se decide cuándo está abierto:
   * qué experiencia muestra dentro lo sigue decidiendo el servidor.
   */
  generateDrawer: React.ReactElement<ControllablePanelProps>;
  /**
   * Falso cuando el servidor resolvió que la búsqueda con IA no puede
   * ejecutarse. La opción deja de llamarse «Generar con IA» y abre la
   * explicación, igual que hacía su botón.
   */
  isGenerateAvailable: boolean;
}

type OpenPanel = 'generate' | 'import' | 'manual' | null;

/**
 * Lo que se puede hacer en «Por revisar» sin nada marcado. Las tres maneras de
 * traer prospectos caben en UNA acción primaria, «Agregar prospectos», que abre
 * un popover de creación: generar con IA, importar un archivo o crear a mano.
 *
 * No pinta botones: le entrega la acción a la barra flotante de la pantalla y
 * monta los paneles que abre, controlados desde aquí.
 */
export function ProspectsScreenActions({ generateDrawer, isGenerateAvailable }: ProspectsScreenActionsProps) {
  const [openPanel, setOpenPanel] = React.useState<OpenPanel>(null);

  const actions = React.useMemo<RailActionSpec[]>(
    () => [
      {
        id: 'add-prospects',
        label: 'Agregar prospectos',
        icon: <Plus aria-hidden="true" />,
        scope: ['screen'],
        primary: true,
        options: [
          isGenerateAvailable
            ? {
                id: 'generate',
                title: 'Generar con IA',
                description: 'Describe qué empresas buscas y la IA te las propone.',
                icon: <Sparkles aria-hidden="true" />,
                variant: 'ai',
                onSelect: () => setOpenPanel('generate'),
              }
            : {
                id: 'generate',
                title: 'Búsqueda no disponible',
                description: 'Mira por qué la búsqueda de empresas no puede ejecutarse ahora.',
                icon: <AlertCircle aria-hidden="true" />,
                onSelect: () => setOpenPanel('generate'),
              },
          {
            id: 'import',
            title: 'Importar archivo',
            description: 'Sube un CSV o Excel, o pega una tabla con tus empresas.',
            icon: <Upload aria-hidden="true" />,
            onSelect: () => setOpenPanel('import'),
          },
          {
            id: 'manual',
            title: 'Crear a mano',
            description: 'Registra un prospecto dato por dato.',
            icon: <PenLine aria-hidden="true" />,
            onSelect: () => setOpenPanel('manual'),
          },
        ],
      },
    ],
    [isGenerateAvailable],
  );

  const closeIf = (panel: OpenPanel) => (isOpen: boolean) => {
    if (isOpen) setOpenPanel(panel);
    else setOpenPanel((current) => (current === panel ? null : current));
  };

  return (
    <>
      <RailScreenActions actions={actions} isBlocked={openPanel !== null} />
      {React.cloneElement(generateDrawer, {
        open: openPanel === 'generate',
        onOpenChange: closeIf('generate'),
      })}
      <ImportCandidatesDrawer open={openPanel === 'import'} onOpenChange={closeIf('import')} />
      <CreateCandidateDrawer open={openPanel === 'manual'} onOpenChange={closeIf('manual')} />
    </>
  );
}
