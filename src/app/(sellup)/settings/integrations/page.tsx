import Link from 'next/link';
import { Plug, MessageSquare, HardDrive, Bot, Globe, Search, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/shared/page-header';
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
    cta: 'Administrar conexión',
  },
  slack: {
    icon: MessageSquare,
    href: '/settings/integrations/slack',
    cta: 'Administrar conexión',
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
    cta: 'Administrar conexión',
  },
  tavily: {
    icon: Globe,
    href: '/settings/integrations/tavily',
    cta: 'Administrar conexión',
  },
  google_cse: {
    icon: Search,
    href: '/settings/integrations/google-cse',
    cta: 'Administrar conexión',
  },
};

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
        No configurado
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
        Error
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
                  ? 'bg-primary/5 text-primary/80 group-hover:bg-primary/10'
                  : 'bg-surface-muted text-text-muted'
          }`}
        >
          <Icon className="size-4" />
        </div>
        {(isAvailable || isPersonal) && meta?.href && (
          <span className="flex items-center gap-1 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            {meta.cta}
            <ExternalLink className="size-3" />
          </span>
        )}
        {isAvailable && !meta?.href && (
          <div className="flex-1 ml-3 space-y-2">
            <div className="h-1.5 w-3/4 rounded-full su-skeleton" />
            <div className="h-1.5 w-1/2 rounded-full su-skeleton" />
          </div>
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
  const integrations = allIntegrations.filter((i) => i.integration_key !== 'google_drive');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integraciones comerciales"
        description="Conecta herramientas externas que permiten a SellUp validar, enriquecer y operar información comercial."
        backHref="/settings"
      />

      <div className="grid gap-4 md:grid-cols-2">
        {integrations.map((integration) => (
          <IntegrationCard key={integration.id} integration={integration} />
        ))}
      </div>
    </div>
  );
}
