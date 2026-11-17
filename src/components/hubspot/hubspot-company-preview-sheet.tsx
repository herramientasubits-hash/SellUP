'use client';

/**
 * Ficha de una empresa que está en HubSpot y no en SellUp, en modo consulta (dueña 17-11:
 * «que al buscarla abra el mismo modal normal… con todas las posibilidades y flujos»).
 *
 * Es el mismo panel que la ficha de una empresa de SellUp (mismo tamaño, mismo resumen,
 * mismas pestañas y el mismo pie), pero con los datos leídos de HubSpot. Las acciones
 * que trabajan la empresa —traerla, buscar contactos, preparar el primer contacto—
 * primero la crean en SellUp (vinculada a HubSpot) y luego siguen como siempre.
 */

import * as React from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import {
  Activity,
  Briefcase,
  Building2,
  Calendar,
  Clock,
  Database,
  Download,
  ExternalLink,
  GitBranch,
  Globe,
  Hash,
  Info,
  MapPin,
  Phone,
  PhoneCall,
  Rumbo,
  Tag,
  User,
  Users,
  type LucideIcon,
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
import { Timeline } from '@/components/data-display';
import { RumboIcon } from '@/components/chat/chat-mark';
import { RUMBO_ACTION_LABELS } from '@/components/ai/rumbo-labels';
import { hubspotCompanyUrl } from '@/components/contact-enrichment/hubspot-company-url';
import type { ContactEnrichmentInitialCompany } from '@/components/contact-enrichment/contact-enrichment-drawer';
import { useExclusivePanel } from '@/lib/exclusive-panels';
import { HubSpotDetailRow, formatHubSpotShortDate } from './detail-row';
import { fetchHubSpotCompany } from '@/modules/hubspot-lookup/client';
import { importHubSpotCompany, importHubSpotContact } from '@/modules/hubspot-lookup/actions';
import type { HubSpotCompanyLookupResult, HubSpotContactHit } from '@/modules/hubspot-lookup/types';
import { FIRST_CALL_TAB_ID } from '@/modules/speech/first-call-links';
import { HubSpotActivitySection, HubSpotActivityTimelineItem, useHubSpotActivity } from './hubspot-activity';
import { HubSpotContactsSection } from './hubspot-contacts-section';
import { HUBSPOT_DATA_TAB, HubSpotPropertiesSection, useHubSpotProperties } from './hubspot-properties-section';


type PendingAction = 'import' | 'enrich' | 'first-contact' | null;

interface HubSpotCompanyPreviewSheetProps {
  hubspotCompanyId: string | null;
  open: boolean;
  onClose: () => void;
  /** Ya está en SellUp (o se acaba de traer): abrir su ficha de SellUp en esta pestaña. */
  onOpenAccount: (accountId: string, tab?: string) => void;
  /** Tras traerla: abrir «Buscar contactos» con la empresa ya de SellUp. */
  onRequestEnrich: (company: ContactEnrichmentInitialCompany) => void;
  /** Tras traerla: abrir el Agente 3 con esa empresa. */
  onRequestFirstContact: (accountId: string) => void;
  /** ¿Está activado el Agente 3? Sin él, no se ofrece preparar el primer contacto. */
  firstContactAvailable: boolean;
}


export function HubSpotCompanyPreviewSheet({
  hubspotCompanyId,
  open,
  onClose,
  onOpenAccount,
  onRequestEnrich,
  onRequestFirstContact,
  firstContactAvailable,
}: HubSpotCompanyPreviewSheetProps) {
  useExclusivePanel('detail', open, onClose);
  const router = useRouter();
  const [attempt, setAttempt] = React.useState(0);
  const key = open && hubspotCompanyId ? `${hubspotCompanyId}:${attempt}` : null;
  const [loaded, setLoaded] = React.useState<{ key: string; result: HubSpotCompanyLookupResult } | null>(null);
  const [tab, setTab] = React.useState('resumen');
  const [pending, setPending] = React.useState<PendingAction>(null);
  const [importingContactId, setImportingContactId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!key || !hubspotCompanyId) return;
    const controller = new AbortController();
    fetchHubSpotCompany(hubspotCompanyId, controller.signal)
      .then((result) => setLoaded({ key, result }))
      .catch(() => {});
    return () => controller.abort();
  }, [key, hubspotCompanyId]);

  const result = key && loaded?.key === key ? loaded.result : null;
  const data = result?.status === 'ok' ? result : null;
  const activity = useHubSpotActivity('company', open ? hubspotCompanyId : null);
  // Todos los datos (cientos de propiedades): se leen al abrir su pestaña.
  const properties = useHubSpotProperties('company', open ? hubspotCompanyId : null, tab === HUBSPOT_DATA_TAB);

  // Otra empresa: empieza en «Resumen» (ajuste durante el render).
  const [shownId, setShownId] = React.useState(hubspotCompanyId);
  if (hubspotCompanyId !== shownId) {
    setShownId(hubspotCompanyId);
    setTab('resumen');
  }

  const company = data?.company ?? null;
  const visibleAccountId = company?.sellup.status === 'visible' ? company.sellup.id : null;
  const otherOwner = company?.sellup.status === 'other_owner' ? company.sellup : null;
  const hubspotUrl = company ? hubspotCompanyUrl(company.id, data?.portalId ?? null) : null;

  /** Trae la empresa a SellUp; devuelve su id (o null si no se pudo, ya avisado). */
  async function importCompany(action: Exclude<PendingAction, null>): Promise<string | null> {
    if (!hubspotCompanyId) return null;
    if (visibleAccountId) return visibleAccountId;
    setPending(action);
    try {
      const res = await importHubSpotCompany(hubspotCompanyId);
      if (!res.success) {
        toast.error(res.error);
        return null;
      }
      toast.success(res.created ? 'Empresa traída a SellUp' : 'La empresa ya estaba en SellUp', {
        description: res.created ? 'Quedó vinculada a HubSpot. El responsable es el de HubSpot si usa SellUp; si no, tú.' : undefined,
      });
      router.refresh();
      return res.accountId;
    } catch {
      toast.error('No pudimos traer la empresa a SellUp. Vuelve a intentarlo.');
      return null;
    } finally {
      setPending(null);
    }
  }

  async function handleImport() {
    const accountId = await importCompany('import');
    if (accountId) onOpenAccount(accountId);
  }

  async function handleEnrich() {
    if (!company) return;
    const accountId = await importCompany('enrich');
    if (!accountId) return;
    onRequestEnrich({
      name: company.name,
      domain: company.domain,
      country: company.country,
      countryCode: null,
      sellupAccountId: accountId,
      hubspotCompanyId: company.id,
    });
  }

  async function handleFirstContact() {
    const accountId = await importCompany('first-contact');
    if (accountId) onRequestFirstContact(accountId);
  }

  async function handleImportContact(contact: HubSpotContactHit) {
    setImportingContactId(contact.id);
    try {
      const res = await importHubSpotContact(contact.id, hubspotCompanyId);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success(`${contact.fullName} quedó en SellUp`, { description: 'Con su empresa, vinculados a HubSpot.' });
      router.refresh();
      onOpenAccount(res.accountId, 'contactos');
    } catch {
      toast.error('No pudimos traer el contacto. Vuelve a intentarlo.');
    } finally {
      setImportingContactId(null);
    }
  }

  const busy = pending !== null || importingContactId !== null;
  const canWork = !!company && !otherOwner;

  const title = company ? company.name : result && result.status !== 'ok' ? 'Empresa no disponible' : 'Cargando empresa…';

  return (
    <DrawerShell
      open={open}
      onOpenChange={(v) => !v && onClose()}
      side="right"
      className="w-full sm:w-[58vw] sm:min-w-[660px] sm:!max-w-[900px]"
      icon={<Building2 className="h-4 w-4" />}
      title={title}
      titleBadge={
        company ? (
          otherOwner ? (
            <Badge variant="neutral">En SellUp · {otherOwner.ownerName ?? 'otra persona'}</Badge>
          ) : (
            <Badge variant="outline">Sólo en HubSpot</Badge>
          )
        ) : undefined
      }
      loading={!result}
      actions={
        company ? (
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2" data-testid="hubspot-preview-actions">
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
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={handleImport}>
                  {pending === 'import' ? <Spinner size="xs" decorative /> : <Download className="h-4 w-4" />}
                  Traer a SellUp
                </Button>
                <Button type="button" size="sm" variant={firstContactAvailable ? 'ai-outline' : 'ai'} disabled={busy} onClick={handleEnrich}>
                  {pending === 'enrich' ? <Spinner size="xs" decorative /> : <RumboIcon />}
                  {RUMBO_ACTION_LABELS.findContacts}
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
          icon={Building2}
          title={result.status === 'not_found' ? 'Esa empresa no está en HubSpot' : 'HubSpot no respondió'}
          description={
            result.status === 'not_found'
              ? 'Puede que la hayan borrado o fusionado con otra en HubSpot.'
              : 'No pudimos leer la empresa en HubSpot. Inténtalo de nuevo en un momento.'
          }
          action={
            result.status !== 'not_found' ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
                Reintentar
              </Button>
            ) : undefined
          }
        />
      ) : company ? (
        <div className="space-y-4">
          <section aria-label="Resumen de la empresa">
            <SurfaceCard className="p-4">
              <DetailList columns={4}>
                <DetailItem icon={User} label="Responsable en HubSpot" emptyLabel="Sin asignar">
                  {company.ownerName}
                </DetailItem>
                <DetailItem icon={MapPin} label="Ubicación" emptyLabel="Sin ubicación">
                  {[company.city, company.region, company.country].filter(Boolean).join(', ')}
                </DetailItem>
                <DetailItem icon={Globe} label="Sitio web" emptyLabel="Sin sitio web">
                  {company.website ? (
                    <a
                      href={company.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                    >
                      {company.domain ?? company.website}
                    </a>
                  ) : null}
                </DetailItem>
                <DetailItem icon={Users} label="Contactos">
                  <span className="tabular-nums">{data?.contacts.length ?? 0}</span>
                </DetailItem>
              </DetailList>
            </SurfaceCard>
          </section>

          <PreviewNotice otherOwnerName={otherOwner ? otherOwner.ownerName ?? 'otra persona' : null} />

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList variant="segmented" className="mb-2 max-w-full overflow-x-auto">
              <TabsTrigger value="resumen"><Building2 className="h-4 w-4" /> Resumen</TabsTrigger>
              <TabsTrigger value="contactos"><Users className="h-4 w-4" /> Contactos</TabsTrigger>
              <TabsTrigger value={FIRST_CALL_TAB_ID}><PhoneCall className="h-4 w-4" /> Primer contacto</TabsTrigger>
              <TabsTrigger value="actividad"><Activity className="h-4 w-4" /> Actividad</TabsTrigger>
              <TabsTrigger value="agentes"><Rumbo className="h-4 w-4" /> Agentes</TabsTrigger>
              <TabsTrigger value="asociaciones"><GitBranch className="h-4 w-4" /> Árbol</TabsTrigger>
              <TabsTrigger value={HUBSPOT_DATA_TAB}><Database className="h-4 w-4" /> HubSpot</TabsTrigger>
            </TabsList>

            <TabsContent value="resumen" className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <DrawerSection title="Datos de la empresa" icon={Building2}>
                  <dl className="space-y-3">
                    <HubSpotDetailRow icon={Briefcase} label="Industria">{company.industry}</HubSpotDetailRow>
                    <HubSpotDetailRow icon={Users} label="Tamaño">{company.employees}</HubSpotDetailRow>
                    <HubSpotDetailRow icon={Hash} label="ID fiscal">
                      {company.taxId ? <span className="break-all font-mono text-xs tabular-nums">{company.taxId}</span> : null}
                    </HubSpotDetailRow>
                    <HubSpotDetailRow icon={Tag} label="Etapa en HubSpot">{company.lifecycle}</HubSpotDetailRow>
                    <HubSpotDetailRow icon={Phone} label="Teléfono">{company.phone}</HubSpotDetailRow>
                    <HubSpotDetailRow icon={Globe} label="ID en HubSpot">
                      <span className="break-all font-mono text-xs tabular-nums">{company.id}</span>
                    </HubSpotDetailRow>
                    <HubSpotDetailRow icon={Calendar} label="Creada en HubSpot">{formatHubSpotShortDate(company.createdAt)}</HubSpotDetailRow>
                    <HubSpotDetailRow icon={Clock} label="Última actividad">{formatHubSpotShortDate(company.lastActivityAt)}</HubSpotDetailRow>
                    <HubSpotDetailRow icon={Globe} label="LinkedIn">
                      {company.linkedinUrl ? (
                        <a href={company.linkedinUrl} target="_blank" rel="noopener noreferrer" className="break-all rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
                          Ver página
                        </a>
                      ) : null}
                    </HubSpotDetailRow>
                  </dl>
                  <button
                    type="button"
                    onClick={() => setTab(HUBSPOT_DATA_TAB)}
                    className="mt-3 rounded-sm text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                  >
                    Ver todos los datos de HubSpot
                  </button>
                </DrawerSection>
                <DrawerSection title="Descripción" icon={Tag}>
                  {company.description ? (
                    <p className="whitespace-pre-line break-words text-sm leading-relaxed text-foreground">{company.description}</p>
                  ) : (
                    <p className="text-sm leading-relaxed text-muted-foreground">HubSpot no tiene descripción de esta empresa.</p>
                  )}
                </DrawerSection>
              </div>
              <DrawerSection title="Actividad reciente" icon={Activity}>
                {activity.state.status === 'ok' && activity.state.items.length > 0 ? (
                  <Timeline>
                    {activity.state.items.slice(0, 4).map((item) => (
                      <HubSpotActivityTimelineItem key={`${item.kind}-${item.id}`} item={item} showBody={false} />
                    ))}
                  </Timeline>
                ) : activity.state.status === 'loading' ? (
                  <div role="status" className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                    <Spinner size="xs" decorative /> Leyendo la actividad en HubSpot…
                  </div>
                ) : (
                  <EmptyState
                    variant="plain"
                    icon={Activity}
                    title="Sin actividad todavía"
                    description="Las notas, llamadas, reuniones, tareas y negocios de HubSpot aparecerán aquí."
                  />
                )}
              </DrawerSection>
            </TabsContent>

            <TabsContent value="contactos">
              <HubSpotContactsSection
                state={data ? { status: 'ok', contacts: data.contacts, portalId: data.portalId } : { status: 'loading' }}
                onImport={canWork ? handleImportContact : undefined}
                importingId={importingContactId}
              />
            </TabsContent>

            <TabsContent value={FIRST_CALL_TAB_ID}>
              <NeedsSellUp
                icon={PhoneCall}
                what="preparar el primer contacto"
                actionLabel={firstContactAvailable ? RUMBO_ACTION_LABELS.prepareFirstContact : 'Traer a SellUp'}
                onAction={canWork ? (firstContactAvailable ? handleFirstContact : handleImport) : undefined}
                busy={busy}
              />
            </TabsContent>

            <TabsContent value="actividad">
              <HubSpotActivitySection state={activity.state} onRetry={activity.retry} hubspotUrl={hubspotUrl} />
            </TabsContent>

            <TabsContent value="agentes">
              <NeedsSellUp icon={Rumbo} what="ver lo que hicieron los agentes" actionLabel={RUMBO_ACTION_LABELS.findContacts} onAction={canWork ? handleEnrich : undefined} busy={busy} />
            </TabsContent>

            <TabsContent value={HUBSPOT_DATA_TAB}>
              <HubSpotPropertiesSection kind="company" state={properties.state} onRetry={properties.retry} hubspotUrl={hubspotUrl} />
            </TabsContent>

            <TabsContent value="asociaciones">
              <NeedsSellUp icon={GitBranch} what="buscar su árbol (grupo, filiales y otros países)" actionLabel="Traer a SellUp" onAction={canWork ? handleImport : undefined} busy={busy} />
            </TabsContent>
          </Tabs>
        </div>
      ) : null}
    </DrawerShell>
  );
}

function PreviewNotice({ otherOwnerName }: { otherOwnerName: string | null }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-info/20 bg-info/10 px-4 py-3 text-sm">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
      <div className="space-y-0.5">
        <p className="font-medium text-foreground">
          {otherOwnerName ? `Esta empresa ya está en SellUp y la lleva ${otherOwnerName}` : 'Estás consultando HubSpot: esta empresa no está en SellUp'}
        </p>
        <p className="text-xs text-muted-foreground">
          {otherOwnerName
            ? 'Puedes ver sus datos, contactos y actividad. Para trabajarla, pide que te la asignen.'
            : 'Puedes ver sus datos, contactos y actividad. Al traerla, buscar contactos o preparar el primer contacto, se crea en SellUp vinculada a HubSpot.'}
        </p>
      </div>
    </div>
  );
}

function NeedsSellUp({
  icon,
  what,
  actionLabel,
  onAction,
  busy,
}: {
  icon: LucideIcon;
  what: string;
  actionLabel: string;
  onAction?: () => void;
  busy: boolean;
}) {
  return (
    <EmptyState
      variant="plain"
      icon={icon}
      title="Disponible cuando esté en SellUp"
      description={`Para ${what}, la empresa tiene que estar en SellUp.`}
      action={
        onAction ? (
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onAction}>
            {actionLabel}
          </Button>
        ) : undefined
      }
    />
  );
}
