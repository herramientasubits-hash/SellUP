'use client';

/**
 * Ficha de un contacto que está en HubSpot y no en SellUp, en modo consulta (dueña
 * 17-11: «si busca contacto y prepara primer contacto, que automáticamente se cree en
 * SellUp y se sincronice»).
 *
 * Muestra sus datos, su empresa y su actividad en HubSpot. «Traer a SellUp» y «Preparar
 * primer contacto» lo crean en SellUp —con su empresa— vinculado a HubSpot, y siguen.
 */

import * as React from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import {
  Activity,
  Briefcase,
  Building2,
  Calendar,
  Clock,
  Download,
  ExternalLink,
  Globe,
  Info,
  Mail,
  MapPin,
  Phone,
  Tag,
  User,
} from '@/icons';
import { DrawerShell } from '@/components/shared/drawer-shell';
import { DrawerSection } from '@/components/shared/drawer-section';
import { SurfaceCard } from '@/components/shared/surface-card';
import { DetailItem, DetailList } from '@/components/shared/detail-list';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/feedback/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RumboIcon } from '@/components/chat/chat-mark';
import { RUMBO_ACTION_LABELS } from '@/components/ai/rumbo-labels';
import { hubspotContactUrl } from '@/components/contact-enrichment/hubspot-company-url';
import { useExclusivePanel } from '@/lib/exclusive-panels';
import { HubSpotDetailRow, formatHubSpotShortDate } from './detail-row';
import { fetchHubSpotContact } from '@/modules/hubspot-lookup/client';
import { importHubSpotContact } from '@/modules/hubspot-lookup/actions';
import { hubspotCompanyHref, type HubSpotContactLookupResult } from '@/modules/hubspot-lookup/types';
import { HubSpotActivitySection, useHubSpotActivity } from './hubspot-activity';
import { HubSpotPropertiesDisclosure } from './hubspot-properties-section';


type PendingAction = 'import' | 'first-contact' | null;

interface HubSpotContactPreviewSheetProps {
  hubspotContactId: string | null;
  open: boolean;
  onClose: () => void;
  /** Ya está en SellUp (o se acaba de traer): abrir su ficha de SellUp. */
  onOpenContact: (contactId: string) => void;
  /** Tras traerlo: abrir el Agente 3 con su empresa y este contacto elegido. */
  onRequestFirstContact: (accountId: string, contactId: string) => void;
  firstContactAvailable: boolean;
}


export function HubSpotContactPreviewSheet({
  hubspotContactId,
  open,
  onClose,
  onOpenContact,
  onRequestFirstContact,
  firstContactAvailable,
}: HubSpotContactPreviewSheetProps) {
  useExclusivePanel('detail', open, onClose);
  const router = useRouter();
  const [attempt, setAttempt] = React.useState(0);
  const key = open && hubspotContactId ? `${hubspotContactId}:${attempt}` : null;
  const [loaded, setLoaded] = React.useState<{ key: string; result: HubSpotContactLookupResult } | null>(null);
  const [tab, setTab] = React.useState('resumen');
  const [pending, setPending] = React.useState<PendingAction>(null);

  React.useEffect(() => {
    if (!key || !hubspotContactId) return;
    const controller = new AbortController();
    fetchHubSpotContact(hubspotContactId, controller.signal)
      .then((result) => setLoaded({ key, result }))
      .catch(() => {});
    return () => controller.abort();
  }, [key, hubspotContactId]);

  const [shownId, setShownId] = React.useState(hubspotContactId);
  if (hubspotContactId !== shownId) {
    setShownId(hubspotContactId);
    setTab('resumen');
  }

  const result = key && loaded?.key === key ? loaded.result : null;
  const data = result?.status === 'ok' ? result : null;
  const contact = data?.contact ?? null;
  const company = data?.company ?? null;
  const activity = useHubSpotActivity('contact', open ? hubspotContactId : null);
  const otherOwner = contact?.sellup.status === 'other_owner' ? contact.sellup : null;
  const visibleContactId = contact?.sellup.status === 'visible' ? contact.sellup.id : null;
  const hubspotUrl = contact ? hubspotContactUrl(contact.id, data?.portalId ?? null) : null;

  async function importContact(action: Exclude<PendingAction, null>) {
    if (!hubspotContactId) return null;
    setPending(action);
    try {
      const res = await importHubSpotContact(hubspotContactId, company?.id ?? null);
      if (!res.success) {
        toast.error(res.error);
        return null;
      }
      toast.success(res.created ? `${contact?.fullName ?? 'El contacto'} quedó en SellUp` : 'El contacto ya estaba en SellUp', {
        description: res.created ? 'Con su empresa, vinculados a HubSpot.' : undefined,
      });
      router.refresh();
      return res;
    } catch {
      toast.error('No pudimos traer el contacto a SellUp. Vuelve a intentarlo.');
      return null;
    } finally {
      setPending(null);
    }
  }

  async function handleImport() {
    if (visibleContactId) {
      onOpenContact(visibleContactId);
      return;
    }
    const res = await importContact('import');
    if (res?.success) onOpenContact(res.contactId);
  }

  async function handleFirstContact() {
    const res = await importContact('first-contact');
    if (res?.success) onRequestFirstContact(res.accountId, res.contactId);
  }

  const busy = pending !== null;
  const canWork = !!contact && !otherOwner;
  const title = contact ? contact.fullName : result && result.status !== 'ok' ? 'Contacto no disponible' : 'Cargando contacto…';

  return (
    <DrawerShell
      open={open}
      onOpenChange={(v) => !v && onClose()}
      side="right"
      className="w-full sm:w-[58vw] sm:min-w-[660px] sm:!max-w-[900px]"
      icon={<User className="h-4 w-4" />}
      title={title}
      description={contact?.jobTitle ?? undefined}
      titleBadge={
        contact ? (
          otherOwner ? (
            <Badge variant="neutral">En SellUp · {otherOwner.ownerName ?? 'otra persona'}</Badge>
          ) : visibleContactId ? (
            <Badge variant="positive">En SellUp</Badge>
          ) : (
            <Badge variant="outline">Sólo en HubSpot</Badge>
          )
        ) : undefined
      }
      loading={!result}
      actions={
        contact ? (
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2" data-testid="hubspot-contact-preview-actions">
            {hubspotUrl && (
              <Button type="button" variant="outline" size="icon-sm" asChild>
                <a href={hubspotUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4 text-muted-foreground" />
                  <span className="sr-only">Abrir en HubSpot</span>
                </a>
              </Button>
            )}
            {canWork && (
              <>
                <Button type="button" size="sm" variant={firstContactAvailable ? 'outline' : 'default'} disabled={busy} onClick={handleImport}>
                  {pending === 'import' ? <Spinner size="xs" decorative /> : <Download className="h-4 w-4" />}
                  {visibleContactId ? 'Abrir en SellUp' : 'Traer a SellUp'}
                </Button>
                {firstContactAvailable && (
                  <Button type="button" size="sm" variant="ai" disabled={busy} onClick={handleFirstContact}>
                    {pending === 'first-contact' ? <Spinner size="xs" decorative /> : <RumboIcon />}
                    {RUMBO_ACTION_LABELS.prepareFirstContact}
                  </Button>
                )}
              </>
            )}
          </div>
        ) : undefined
      }
    >
      {!result ? null : result.status !== 'ok' ? (
        <EmptyState
          variant="plain"
          icon={User}
          title={result.status === 'not_found' ? 'Ese contacto no está en HubSpot' : 'HubSpot no respondió'}
          description={
            result.status === 'not_found'
              ? 'Puede que lo hayan borrado o fusionado con otro en HubSpot.'
              : 'No pudimos leer el contacto en HubSpot. Inténtalo de nuevo en un momento.'
          }
          action={
            result.status !== 'not_found' ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
                Reintentar
              </Button>
            ) : undefined
          }
        />
      ) : contact ? (
        <div className="space-y-4">
          <section aria-label="Resumen del contacto">
            <SurfaceCard className="p-4">
              <DetailList columns={4}>
                <DetailItem icon={Building2} label="Empresa" emptyLabel="Sin empresa">
                  {company ? (
                    <Link
                      href={company.sellup.status === 'visible' ? `/accounts/${company.sellup.id}` : hubspotCompanyHref(company.id)}
                      className="rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                    >
                      {company.name}
                    </Link>
                  ) : (
                    contact.companyName
                  )}
                </DetailItem>
                <DetailItem icon={Mail} label="Correo" emptyLabel="Sin correo">
                  {contact.email ? <span className="break-all">{contact.email}</span> : null}
                </DetailItem>
                <DetailItem icon={Phone} label="Teléfono" emptyLabel="Sin teléfono">
                  {contact.phone ?? contact.mobilePhone ? (
                    <span className="tabular-nums">{contact.phone ?? contact.mobilePhone}</span>
                  ) : null}
                </DetailItem>
                <DetailItem icon={User} label="Responsable en HubSpot" emptyLabel="Sin asignar">
                  {contact.ownerName}
                </DetailItem>
              </DetailList>
            </SurfaceCard>
          </section>

          <div className="flex items-start gap-2.5 rounded-xl border border-info/20 bg-info/10 px-4 py-3 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
            <div className="space-y-0.5">
              <p className="font-medium text-foreground">
                {otherOwner
                  ? `Este contacto ya está en SellUp, en una empresa que lleva ${otherOwner.ownerName ?? 'otra persona'}`
                  : visibleContactId
                    ? 'Este contacto ya está en SellUp'
                    : 'Estás consultando HubSpot: este contacto no está en SellUp'}
              </p>
              <p className="text-xs text-muted-foreground">
                {otherOwner
                  ? 'Puedes ver sus datos y su actividad. Para trabajarlo, pide que te asignen su empresa.'
                  : 'Al traerlo o preparar el primer contacto, se crea en SellUp con su empresa, vinculados a HubSpot.'}
              </p>
            </div>
          </div>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList variant="segmented" className="mb-2 max-w-full overflow-x-auto">
              <TabsTrigger value="resumen"><User className="h-4 w-4" /> Resumen</TabsTrigger>
              <TabsTrigger value="actividad"><Activity className="h-4 w-4" /> Actividad</TabsTrigger>
            </TabsList>
            <TabsContent value="resumen">
              <DrawerSection title="Datos del contacto" icon={User}>
                <dl className="space-y-3">
                  <HubSpotDetailRow icon={Briefcase} label="Cargo">{contact.jobTitle}</HubSpotDetailRow>
                  <HubSpotDetailRow icon={User} label="Responsable en HubSpot">{contact.ownerName}</HubSpotDetailRow>
                  <HubSpotDetailRow icon={Tag} label="Etapa en HubSpot">{contact.lifecycle}</HubSpotDetailRow>
                  <HubSpotDetailRow icon={MapPin} label="Ubicación">{[contact.city, contact.country].filter(Boolean).join(', ') || null}</HubSpotDetailRow>
                  <HubSpotDetailRow icon={Globe} label="LinkedIn">
                    {contact.linkedinUrl ? (
                      <a href={contact.linkedinUrl} target="_blank" rel="noopener noreferrer" className="break-all text-primary hover:underline">
                        Ver perfil
                      </a>
                    ) : null}
                  </HubSpotDetailRow>
                  <HubSpotDetailRow icon={Globe} label="ID en HubSpot">
                    <span className="break-all font-mono text-xs tabular-nums">{contact.id}</span>
                  </HubSpotDetailRow>
                  <HubSpotDetailRow icon={Calendar} label="Creado en HubSpot">{formatHubSpotShortDate(contact.createdAt)}</HubSpotDetailRow>
                  <HubSpotDetailRow icon={Clock} label="Última actividad">{formatHubSpotShortDate(contact.lastActivityAt)}</HubSpotDetailRow>
                </dl>
              </DrawerSection>
              <div className="mt-4">
                <HubSpotPropertiesDisclosure kind="contact" hubspotId={contact.id} hubspotUrl={hubspotUrl} />
              </div>
            </TabsContent>
            <TabsContent value="actividad">
              <HubSpotActivitySection state={activity.state} onRetry={activity.retry} hubspotUrl={hubspotUrl} />
            </TabsContent>
          </Tabs>
        </div>
      ) : null}
    </DrawerShell>
  );
}
