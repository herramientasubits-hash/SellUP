'use client';

import * as React from 'react';
import { AlertCircle, Sparkles } from '@/icons';

import { RailScreenActions, type RailActionSpec } from '@/components/action-rail';

/** Lo que estos componentes necesitan poder decirle al asistente de IA. */
export interface ControllablePanelProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * El asistente «Generar con IA» del módulo Empresas, tal como lo resolvió el
 * servidor (`resolveGenerateProspectsAgent`). Aquí solo se decide cuándo está
 * abierto: qué experiencia muestra dentro lo sigue decidiendo el servidor.
 */
export interface GenerateProspectsAgent {
  /** `<GenerateAIBatchDrawer … />` con todas sus props ya resueltas. */
  generateDrawer: React.ReactElement<ControllablePanelProps>;
  /**
   * Falso cuando el servidor resolvió que la búsqueda con IA no puede
   * ejecutarse. El agente deja de llamarse «Generar con IA» y abre la
   * explicación.
   */
  isGenerateAvailable: boolean;
}

/**
 * La acción del agente de IA del módulo Empresas, para
 * `<RailScreenActions agent={…} />`.
 *
 * 🔴 Capa 4 del cerco del camino heredado: si la búsqueda no puede ejecutarse,
 * el agente NO se llama «Generar con IA» ni lleva el degradado de IA: se llama
 * «Búsqueda no disponible» y abre el mismo panel, que es quien explica por qué.
 *
 * @example
 * const agent = useGenerateProspectsAgentAction(isGenerateAvailable, () => setIsOpen(true));
 * <RailScreenActions actions={actions} agent={agent} />
 */
export function useGenerateProspectsAgentAction(isGenerateAvailable: boolean, onOpen: () => void): RailActionSpec {
  // La acción guarda la última `onOpen` sin volver a pintar la barra por ella.
  const onOpenRef = React.useRef(onOpen);
  React.useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);

  return React.useMemo<RailActionSpec>(
    () =>
      isGenerateAvailable
        ? {
            id: 'generate-with-ai',
            label: 'Generar con IA',
            icon: <Sparkles aria-hidden="true" />,
            scope: ['screen'],
            variant: 'ai',
            onSelect: () => onOpenRef.current(),
          }
        : {
            id: 'generate-with-ai',
            label: 'Búsqueda no disponible',
            icon: <AlertCircle aria-hidden="true" />,
            scope: ['screen'],
            onSelect: () => onOpenRef.current(),
          },
    [isGenerateAvailable],
  );
}

/**
 * Las acciones de pantalla de una pestaña del módulo Empresas que solo ofrece
 * el agente de IA («Descartadas»): lo declara a la barra y monta su asistente,
 * controlado desde aquí.
 */
export function GenerateProspectsAgentActions({ generateDrawer, isGenerateAvailable }: GenerateProspectsAgent) {
  const [isOpen, setIsOpen] = React.useState(false);
  const agent = useGenerateProspectsAgentAction(isGenerateAvailable, () => setIsOpen(true));

  return (
    <>
      <RailScreenActions actions={NO_ACTIONS} agent={agent} isBlocked={isOpen} />
      {React.cloneElement(generateDrawer, { open: isOpen, onOpenChange: setIsOpen })}
    </>
  );
}

const NO_ACTIONS: readonly RailActionSpec[] = [];
