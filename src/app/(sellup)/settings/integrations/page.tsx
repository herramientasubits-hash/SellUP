import Link from 'next/link';
import { Plug, MessageSquare, HardDrive, Bot, ExternalLink } from 'lucide-react';
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
  slack: { icon: MessageSquare, href: '/settings/integrations/slack', cta: 'Administrar conexión' },
  google_drive: {
    icon: HardDrive,
    href: '/settings/my-drive',
    cta: 'Ir a Mi Google Drive',
    // Nota: Google Drive es una integración personal, no global.
    // Cada usuario conecta su propio Drive desde /settings/my-drive.
    personalNote: 'Conexión personal disponible en Mi Google Drive',
  },
  samu_ia: { icon: Bot, href: '/settings/integrations/samu', cta: 'Administrar conexión' },
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
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border/40 bg-muted/30 px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground/60">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/25" />
        Próximamente
      </span>
    );
  }

  if (credentialsStatus === 'missing' || !credentialsStatus) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border/40 bg-muted/30 px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground/60">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/25" />
        No configurado
      </span>
    );
  }

  if (connectionStatus === 'connected') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-medium text-emerald-500">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Conectado
      </span>
    );
  }

  if (connectionStatus === 'error') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-0.5 text-[10px] font-medium text-destructive">
        <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
        Error
      </span>
    );
  }

  if (connectionStatus === 'disconnected') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-medium text-amber-500">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Desconectado
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border/40 bg-muted/30 px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground/60">
      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/25" />
      Sin probar
    </span>
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
    <span className="inline-flex items-center gap-1.5 rounded-full border border-su-brand/30 bg-su-brand-soft px-2.5 py-0.5 text-[10px] font-medium text-su-brand">
      <span className="h-1.5 w-1.5 rounded-full bg-su-brand" />
      Personal
    </span>
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
          className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${
            isPersonal
              ? 'bg-su-brand-soft text-su-brand group-hover:bg-su-brand/20'
              : isAvailable && conn?.connection_status === 'connected'
              ? 'bg-su-brand-soft text-su-brand group-hover:bg-su-brand/20'
              : isAvailable
              ? 'bg-su-brand-soft/60 text-su-brand/70 group-hover:bg-su-brand/15'
              : 'bg-accent/60 text-muted-foreground/40'
          }`}
        >
          <Icon className="h-4 w-4" />
        </div>
        {(isAvailable || isPersonal) && meta?.href && (
          <span className="flex items-center gap-1 text-[11px] font-medium text-su-brand opacity-0 transition-opacity group-hover:opacity-100">
            {meta.cta}
            <ExternalLink className="h-3 w-3" />
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
      <Link href={meta.href}>
        <SurfaceCard className="group cursor-pointer transition-all hover:border-su-brand/30 hover:shadow-md">
          {cardContent}
        </SurfaceCard>
      </Link>
    );
  }

  return (
    <SurfaceCard className="group">
      {cardContent}
    </SurfaceCard>
  );
}

export default async function IntegrationsPage() {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) redirect('/settings');

  const allIntegrations = await getAllIntegrations();
  const integrations = allIntegrations.filter(
    (i) => i.integration_key !== 'google_drive'
  );

  return (
    <div className="space-y-8">
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
