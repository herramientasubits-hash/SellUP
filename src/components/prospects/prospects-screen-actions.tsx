'use client';

import * as React from 'react';
import { PenLine, Upload } from '@/icons';

import { RailScreenActions, type RailActionSpec } from '@/components/action-rail';
import { CreateCandidateDrawer } from '@/components/prospect-batches/create-candidate-drawer';
import { ImportCandidatesDrawer } from '@/components/prospect-batches/import-candidates-drawer';
import { useGenerateProspectsAgentAction, type GenerateProspectsAgent } from './generate-prospects-agent';

type ProspectsScreenActionsProps = GenerateProspectsAgent;

type OpenPanel = 'generate' | 'import' | 'manual' | null;

/**
 * Lo que se puede hacer en «Por revisar» sin nada marcado. La IA está a UN
 * clic: es el agente de la barra («Generar con IA»). Las otras dos maneras de
 * traer prospectos —importar un archivo y crear uno a mano— son acciones de
 * pantalla, cada una con su botón, sin repetir la IA.
 *
 * No pinta botones propios: le entrega las acciones a la barra flotante de la
 * pantalla (o a la cabecera, con las acciones «En la pantalla») y monta los
 * paneles que abren, controlados desde aquí. Nunca hay dos abiertos a la vez.
 */
export function ProspectsScreenActions({ generateDrawer, isGenerateAvailable }: ProspectsScreenActionsProps) {
  const [openPanel, setOpenPanel] = React.useState<OpenPanel>(null);

  const agent = useGenerateProspectsAgentAction(isGenerateAvailable, () => setOpenPanel('generate'));

  const actions = React.useMemo<RailActionSpec[]>(
    () => [
      {
        id: 'import',
        label: 'Importar archivo',
        icon: <Upload aria-hidden="true" />,
        scope: ['screen'],
        onSelect: () => setOpenPanel('import'),
      },
      {
        id: 'manual',
        label: 'Crear a mano',
        icon: <PenLine aria-hidden="true" />,
        scope: ['screen'],
        onSelect: () => setOpenPanel('manual'),
      },
    ],
    [],
  );

  const closeIf = (panel: OpenPanel) => (isOpen: boolean) => {
    if (isOpen) setOpenPanel(panel);
    else setOpenPanel((current) => (current === panel ? null : current));
  };

  return (
    <>
      <RailScreenActions actions={actions} agent={agent} isBlocked={openPanel !== null} />
      {React.cloneElement(generateDrawer, {
        open: openPanel === 'generate',
        onOpenChange: closeIf('generate'),
      })}
      <ImportCandidatesDrawer open={openPanel === 'import'} onOpenChange={closeIf('import')} />
      <CreateCandidateDrawer open={openPanel === 'manual'} onOpenChange={closeIf('manual')} />
    </>
  );
}
