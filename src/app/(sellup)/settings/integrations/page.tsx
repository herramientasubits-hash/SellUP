import Link from 'next/link';
import { Plug, MessageSquare, HardDrive, Bot, Search, ArrowRight } from "@/icons";
import { Badge } from '@/components/ui/badge';
import { SettingsPage } from '@/components/settings/settings-page';
import { EmptyState } from '@/components/ui/empty-state';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { getAllIntegrations } from '@/modules/integrations/actions';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { redirect } from 'next/navigation';
import type { IntegrationWithConnection } from '@/modules/integrations/types';

const INTEGRATION_META: Record<
  string,
  {
    icon: React.ComponentType<{ className?: string }>;
    href: string | null;
    cta: string;
    personalNote?: string;
  }
> = {
  hubspot: {
    icon: Plug,
    href: '/settings/integrations/hubspot',
    cta: 'Ver conexión',
  },
  slack: {
    icon: MessageSquare,
    href: '/settings/integrations/slack',
    cta: 'Ver conexión',
  },
  google_drive: {
    icon: HardDrive,
    href: '/settings/my-drive',
    cta: 'Ir a Mi Google Drive',
    // Nota: Google Drive es una integración personal, no global.
    // Cada usuario conecta su propio Drive desde /settings/my-drive.
    personalNote: 'Conexión personal disponible en Mi Google Drive',
  },
  samu_ia: {
    icon: Bot,
    href: '/settings/integrations/samu',
    cta: 'Ver conexión',
  },
  google_cse: {
    icon: Search,
    href: '/settings/integrations/google-cse',
    cta: 'Ver conexión',
  },
};

/**
 * Lo que no se lista aquí aunque exista como integración: Google Drive es
 * personal (Mi Google Drive) y Tavily es un proveedor de datos que se conecta y
 * se mide en «Proveedores y consumo».
 */
const NOT_LISTED_HERE: ReadonlySet<string> = new Set(['google_drive', 'tavily']);

function ConnectionStatusBadge({
  credentialsStatus,
  connectionStatus,
  isAvailable,
}: {
  credentialsStatus?: string;
  connectionStatus?: string;
  isAvailable: boolean;
}) {
  if (!isAvailable) {
    return (
      <Badge variant="neutral">
        <span className="size-1.5 rounded-full bg-muted-foreground/40" />
        Próximamente
      </Badge>
    );
  }

  if (credentialsStatus === 'missing' || !credentialsStatus) {
    return (
      <Badge variant="neutral">
        <span className="size-1.5 rounded-full bg-muted-foreground/40" />
        Sin conectar
      </Badge>
    );
  }

  if (connectionStatus === 'connected') {
    return (
      <Badge variant="positive">
        <span className="size-1.5 rounded-full bg-success" />
        Conectado
      </Badge>
    );
  }

  if (connectionStatus === 'error') {
    return (
      <Badge variant="negative">
        <span className="size-1.5 rounded-full bg-destructive" />
        Con error
      </Badge>
    );
  }

  if (connectionStatus === 'disconnected') {
    return (
      <Badge variant="warning">
        <span className="size-1.5 rounded-full bg-warning" />
        Desconectado
      </Badge>
    );
  }

  return (
    <Badge variant="neutral">
      <span className="size-1.5 rounded-full bg-muted-foreground/40" />
      Sin probar
    </Badge>
  );
}

function IntegrationCard({ integration }: { integration: IntegrationWithConnection }) {
  const meta = INTEGRATION_META[integration.integration_key];
  const Icon = meta?.icon ?? Plug;
  const isAvailable = integration.is_available;
  const conn = integration.connection;
  const isPersonal = !!meta?.personalNote;

  const statusBadge = isPersonal ? (
    // Google Drive: conexión personal, no gestionada aquí
    <Badge variant="brand">
      <span className="size-1.5 rounded-full bg-primary" />
      Personal
    </Badge>
  ) : (
    <ConnectionStatusBadge
      credentialsStatus={conn?.credentials_status}
      connectionStatus={conn?.connection_status}
      isAvailable={isAvailable}
    />
  );

  const cardContent = (
    <>
      <SurfaceCardHeader
        title={integration.name}
        description={isPersonal ? meta.personalNote : (integration.description ?? undefined)}
        actions={statusBadge}
      />
      <div className="flex items-center justify-between">
        <div
          className={`flex size-9 items-center justify-center rounded-xl transition-colors ${
            isPersonal
              ? 'bg-primary/10 text-primary group-hover:bg-primary/15'
              : isAvailable && conn?.connection_status === 'connected'
                ? 'bg-primary/10 text-primary group-hover:bg-primary/15'
                : isAvailable
                  ? 'bg-primary/5 text-primary group-hover:bg-primary/10'
                  : 'bg-surface-muted text-text-muted'
          }`}
        >
          <Icon className="size-4" />
        </div>
        {(isAvailable || isPersonal) && meta?.href && (
          // Siempre a la vista: en pantalla táctil no hay «pasar el puntero».
          <span className="flex items-center gap-1 text-xs font-medium text-primary">
            {meta.cta}
            <ArrowRight aria-hidden className="size-3" />
          </span>
        )}
        {isAvailable && !meta?.href && (
          <span className="text-xs text-muted-foreground">Todavía no se configura desde aquí</span>
        )}
      </div>
    </>
  );

  if ((isAvailable || isPersonal) && meta?.href) {
    return (
      <Link
        href={meta.href}
        className="block rounded-2xl focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
      >
        <SurfaceCard className="group h-full cursor-pointer hover:border-primary/30 hover:shadow-drawer">
          {cardContent}
        </SurfaceCard>
      </Link>
    );
  }

  return <SurfaceCard className="group">{cardContent}</SurfaceCard>;
}

export default async function IntegrationsPage() {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) redirect('/settings');

  const allIntegrations = await getAllIntegrations();
  const integrations = allIntegrations.filter(
    (i) => !NOT_LISTED_HERE.has(i.integration_key),
  );

  return (
    <SettingsPage
      title="Integraciones comerciales"
      description="Las herramientas externas con las que trabaja SellUp. Entra a cada una para ver si funciona y probar su conexión."
    >
      {integrations.length === 0 ? (
        <EmptyState
          icon={Plug}
          title="No hay integraciones disponibles"
          description="Cuando se habilite una herramienta para tu organización aparecerá aquí."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {integrations.map((integration) => (
            <IntegrationCard key={integration.id} integration={integration} />
          ))}
        </div>
      )}
    </SettingsPage>
  );
}
