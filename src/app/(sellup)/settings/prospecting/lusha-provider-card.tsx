'use client';

import { Sparkles } from '@/icons';
import {
  connectLusha,
  testLushaConnectionAction,
  updateLushaApiKey,
  disconnectLusha,
} from '@/modules/prospecting-config/actions';
import type { ProspectingProviderConnection } from '@/modules/prospecting-config/types';
import {
  ProspectingProviderCard,
  type ProspectingProviderActions,
} from './prospecting-provider-card';

const LUSHA_ACTIONS: ProspectingProviderActions = {
  connect: connectLusha,
  updateApiKey: updateLushaApiKey,
  testConnection: testLushaConnectionAction,
  disconnect: disconnectLusha,
};

interface LushaProviderCardProps {
  connection: ProspectingProviderConnection | null;
  description: string | null;
}

/** Lusha: la tarjeta común de proveedor con sus acciones y sus textos. */
export function LushaProviderCard({ connection, description }: LushaProviderCardProps) {
  return (
    <ProspectingProviderCard
      providerId="lusha"
      name="Lusha"
      icon={Sparkles}
      purpose="Prospección y enriquecimiento"
      credentialDescription="La clave se guarda cifrada en el servidor. Con ella SellUp usa Lusha para encontrar empresas y completar sus datos."
      credentialHint="Las capacidades disponibles y el consumo de créditos dependen del plan de Lusha asociado a esta API Key."
      connection={connection}
      description={description}
      actions={LUSHA_ACTIONS}
    />
  );
}
