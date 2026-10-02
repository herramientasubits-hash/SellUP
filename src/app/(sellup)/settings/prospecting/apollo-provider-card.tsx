'use client';

import { Search } from '@/icons';
import {
  connectApollo,
  testApolloConnectionAction,
  updateApolloApiKey,
  disconnectApollo,
} from '@/modules/prospecting-config/actions';
import type { ProspectingProviderConnection } from '@/modules/prospecting-config/types';
import {
  ProspectingProviderCard,
  type ProspectingProviderActions,
} from './prospecting-provider-card';

const APOLLO_ACTIONS: ProspectingProviderActions = {
  connect: connectApollo,
  updateApiKey: updateApolloApiKey,
  testConnection: testApolloConnectionAction,
  disconnect: disconnectApollo,
};

interface ApolloProviderCardProps {
  connection: ProspectingProviderConnection | null;
  description: string | null;
}

/** Apollo.io: la tarjeta común de proveedor con sus acciones y sus textos. */
export function ApolloProviderCard({ connection, description }: ApolloProviderCardProps) {
  return (
    <ProspectingProviderCard
      providerId="apollo"
      name="Apollo.io"
      shortName="Apollo"
      icon={Search}
      purpose="Completa datos de empresas · búsqueda de empresas en pruebas"
      credentialDescription="La clave se guarda cifrada en el servidor. Apollo completa datos de empresas que ya se encontraron y, de forma experimental, ayuda a buscar empresas nuevas; no está pensado para lotes muy grandes."
      credentialHint="Qué se puede consultar y cuántos créditos se gastan depende del plan de Apollo al que pertenece esta clave."
      connection={connection}
      description={description}
      actions={APOLLO_ACTIONS}
    />
  );
}
