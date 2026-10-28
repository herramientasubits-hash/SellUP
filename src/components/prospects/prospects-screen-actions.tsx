'use client';

import * as React from 'react';
import { Upload } from '@/icons';

import { RailScreenActions, type RailActionSpec } from '@/components/action-rail';
import { ImportCandidatesDrawer } from '@/components/prospect-batches/import-candidates-drawer';
import { useGenerateProspectsAgentAction, type GenerateProspectsAgent } from './generate-prospects-agent';
import { ControlledPanelSlot } from './controlled-panel-slot';

type ProspectsScreenActionsProps = Partial<GenerateProspectsAgent> & {
  /**
   * ¿Puede importar archivos? Lo decide el servidor (`checkCapability('prospectarMasivo')`).
   * Sin la capacidad —un BD con las reglas por rol encendidas— no hay «Importar archivo»;
   * Rumbo sigue a la vista para todos.
   */
  canProspectBulk?: boolean;
};

type OpenPanel = 'generate' | 'import' | null;

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
export function ProspectsScreenActions({
  generateDrawer,
  isGenerateAvailable = false,
  canProspectBulk = true,
}: ProspectsScreenActionsProps) {
  const [openPanel, setOpenPanel] = React.useState<OpenPanel>(null);

  const generateAction = useGenerateProspectsAgentAction(isGenerateAvailable, () => setOpenPanel('generate'));
  // Rumbo es de todos (dueña 28-10); sólo «Importar archivo» depende de lo masivo.
  const agent = generateDrawer ? generateAction : null;

  // Una sola manera de crear a mano en toda la app: «Agregar empresa» en
  // Empresas, con su revisión de duplicados. Aquí solo se trae en masa.
  const actions = React.useMemo<RailActionSpec[]>(
    () =>
      canProspectBulk
        ? [
            {
              id: 'import',
              label: 'Importar archivo',
              icon: <Upload aria-hidden="true" />,
              scope: ['screen'],
              onSelect: () => setOpenPanel('import'),
            },
          ]
        : [],
    [canProspectBulk],
  );

  const closeIf = (panel: OpenPanel) => (isOpen: boolean) => {
    if (isOpen) setOpenPanel(panel);
    else setOpenPanel((current) => (current === panel ? null : current));
  };

  return (
    <>
      <RailScreenActions actions={actions} agent={agent} isBlocked={openPanel !== null} />
      {agent && generateDrawer && (
        <ControlledPanelSlot panel={generateDrawer} open={openPanel === 'generate'} onOpenChange={closeIf('generate')} />
      )}
      {canProspectBulk && <ImportCandidatesDrawer open={openPanel === 'import'} onOpenChange={closeIf('import')} />}
    </>
  );
}
