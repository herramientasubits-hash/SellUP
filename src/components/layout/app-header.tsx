"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Building2, ChevronRight, PanelLeft, User as UserIcon } from "@/icons";
import { cn } from "@/lib/utils";
import type { User } from "@supabase/supabase-js";
import {
  GlobalSearch,
  type SearchNavigateItem,
  type SearchObjectItem,
  type SearchRemoteResult,
} from "@/components/search";
import { fetchSellUpRecords } from "@/modules/global-search/client";
import { isSameListView, sellUpSearchItems, type OpenSellUpRecord } from "@/components/search/sellup-search-items";
import { stripCandidateReviewParam } from "@/modules/contact-enrichment/candidate-review-link";
import { getAccountsList } from "@/modules/accounts/actions";
import { getAllContacts } from "@/modules/contacts/actions";
import { fetchHubSpotSearch } from "@/modules/hubspot-lookup/client";
import {
  hubspotSearchItems,
  type OpenHubSpotRecord,
  type OpenSellUpDrawer,
} from "@/components/search/hubspot-search-items";
import {
  OPEN_RECORD_EVENT,
  isOnRecordList,
  openRecordHref,
  type OpenRecordDetail,
} from "@/modules/global-search/open-record-link";
import {
  HUBSPOT_OPEN_EVENT,
  hubspotCompanyHref,
  hubspotContactHref,
  hubspotRecordPath,
  type HubSpotOpenDetail,
} from "@/modules/hubspot-lookup/types";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { DrawerShell } from "@/components/shared/drawer-shell";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AccountMenu } from "@/components/layout/account-menu";
import { HEADER_ICON_BUTTON } from "@/components/layout/header-icon";
import { useSidebar } from "@/components/layout/sidebar-context";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { setShellHeaderHost, usePublishedCrumbs } from "@/components/layout/shell-header-slot";
import {
  mainNavItems,
  getVisibleNavItems,
  type NavAccessContext,
  type NavItem,
  ROI_CALCULATOR_ROUTE,
  SOURCE_CATALOG_ROUTE,
} from "@/config/navigation";
import { getVisibleSettingsSections } from "@/components/settings/settings-sections";
import { createClient } from "@/lib/supabase/client";
import { roleLabelFor } from "@/modules/access/role-labels";

interface AppHeaderProps {
  user: User;
  initialUnreadCount?: number;
  navAccess: NavAccessContext;
  /**
   * Centro de procesos (Thema · `ProcessCenter`), a la derecha de los avisos. Lo
   * pasa el shell para que la cabecera no dependa de qué procesos existen.
   */
  processCenter?: React.ReactNode;
}

/** Palabras con las que también se busca una sección de Configuración. */
const SETTINGS_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  users: ["roles", "permisos", "equipo"],
  providers: ["apollo", "lusha", "tavily", "claude", "presupuesto", "créditos", "gasto", "tope"],
  integrations: ["hubspot", "slack"],
  activity: ["historial", "auditoría"],
  "my-drive": ["google", "drive"],
  "my-notifications": ["slack", "boletín", "avisos", "notificaciones"],
};

/** Palabras con las que también se busca un módulo. */
const NAV_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  [SOURCE_CATALOG_ROUTE]: ["fuentes", "países", "registros"],
  [ROI_CALCULATOR_ROUTE]: ["roi", "proyección", "valor", "cotización", "propuesta"],
};

const SEARCH_OBJECTS_HINT =
  "Busca en todo SellUp y en HubSpot, desde cualquier pantalla: nombre, ID, NIT, dominio, correo o teléfono.";

/** Nombres de las listas de SellUp, para avisar cuál no respondió. */
const SELLUP_KIND_LABEL: Record<string, string> = {
  account: "empresas",
  contact: "contactos",
  prospect: "empresas por revisar",
  discarded_company: "empresas descartadas",
  search: "búsquedas",
  contact_candidate: "contactos por revisar",
};

/**
 * La búsqueda por lo escrito en todo SellUp (por revisar, descartadas, búsquedas,
 * candidatos de contacto) y en HubSpot, a la vez. Si una parte no responde, lo demás
 * se muestra y se avisa cuál faltó; sólo si fallan las dos, el buscador lo dice.
 */
async function searchEverywhere(
  query: string,
  signal: AbortSignal,
  openHubSpot: OpenHubSpotRecord,
  openSellUp: OpenSellUpRecord,
  openDrawer: OpenSellUpDrawer,
): Promise<SearchRemoteResult> {
  const [sellup, hubspot] = await Promise.allSettled([
    fetchSellUpRecords(query, signal),
    searchHubSpot(query, signal, openHubSpot, openDrawer),
  ]);
  if (sellup.status === "rejected" && hubspot.status === "rejected") throw new Error("Búsqueda no disponible");
  const notices: string[] = [];
  if (sellup.status === "rejected") {
    notices.push("Una parte de SellUp no respondió: se muestra lo demás.");
  } else if (sellup.value.failed.length > 0) {
    const missing = sellup.value.failed.map((kind) => SELLUP_KIND_LABEL[kind] ?? kind).join(", ");
    notices.push(`No pudimos buscar en ${missing}: se muestra lo demás.`);
  }
  if (hubspot.status === "rejected") notices.push("HubSpot no respondió: se muestra lo de SellUp.");
  return {
    items: [
      ...(sellup.status === "fulfilled" ? sellUpSearchItems(sellup.value.hits, openSellUp, openDrawer) : []),
      ...(hubspot.status === "fulfilled" ? hubspot.value : []),
    ],
    notice: notices.length > 0 ? notices.join(" ") : null,
  };
}

/**
 * Empresas y contactos de HubSpot con lo escrito (dueña 17-11: «que todos puedan
 * consultar lo que sea desde SellUp en HubSpot»). Sin HubSpot conectado no hay grupo;
 * si no responde, se avisa y lo de SellUp sigue.
 */
async function searchHubSpot(
  query: string,
  signal: AbortSignal,
  open: OpenHubSpotRecord,
  openDrawer: OpenSellUpDrawer,
): Promise<SearchObjectItem[]> {
  const result = await fetchHubSpotSearch(query, signal);
  if (result.status === "unavailable") {
    if (result.reason === "not_connected") return [];
    throw new Error("HubSpot no disponible");
  }
  return hubspotSearchItems(result.companies, result.contacts, open, openDrawer);
}

function compact(values: readonly (string | null | undefined)[]): string[] {
  return values.filter((value): value is string => Boolean(value));
}

/**
 * Los registros de la búsqueda general: empresas y contactos. Reutiliza las
 * lecturas que ya alimentan sus tablas (mismo permiso y mismo alcance
 * comercial); no hay consulta nueva. Si una de las dos falla, la otra sigue.
 */
async function loadSearchObjects(openDrawer: OpenSellUpDrawer): Promise<SearchObjectItem[]> {
  const [accounts, contacts] = await Promise.allSettled([getAccountsList(), getAllContacts()]);
  if (accounts.status === "rejected" && contacts.status === "rejected") {
    throw new Error("No se pudieron cargar los registros de la búsqueda.");
  }

  const accountItems: SearchObjectItem[] =
    accounts.status === "fulfilled"
      ? accounts.value.map((account) => ({
          id: `account-${account.id}`,
          title: account.name,
          meta: compact([account.industry, account.country]),
          keywords: compact([account.domain, account.website, account.owner_name]),
          icon: Building2,
          group: "Empresas",
          // Abre la ficha lateral, no la página completa (dueña 17-11).
          href: openRecordHref("account", account.id),
          onSelect: () => openDrawer("account", account.id),
        }))
      : [];
  const contactItems: SearchObjectItem[] =
    contacts.status === "fulfilled"
      ? contacts.value.map((contact) => ({
          id: `contact-${contact.id}`,
          title: contact.full_name,
          meta: compact([contact.job_title, contact.account_name]),
          keywords: compact([contact.email]),
          icon: UserIcon,
          group: "Contactos",
          href: openRecordHref("contact", contact.id),
          onSelect: () => openDrawer("contact", contact.id),
        }))
      : [];

  return [...accountItems, ...contactItems];
}

/** Cómo se nombra el rol en el chip de la cuenta. */
function roleLabel({ isAdmin, roleKey }: NavAccessContext): string {
  if (isAdmin) return "Administrador";
  return roleLabelFor(roleKey);
}

/**
 * La ruta de la cabecera. Sin migas publicadas pinta la sección, como el título
 * del playground de UX (la marca ya está en el menú lateral). Cuando
 * la pantalla publica las suyas (`PageHeader breadcrumbs`, vía
 * `ShellBreadcrumbs`), la sección pasa a ser un enlace y las migas de la
 * pantalla se pintan a continuación, en el hueco.
 */
function HeaderRoute({ current }: { current: NavItem | undefined }) {
  const published = usePublishedCrumbs();
  const hasPublished = published.length > 0;
  // Si la pantalla ya empieza sus migas por la sección, no se repite.
  const showSection = Boolean(current) && !(hasPublished && published[0]?.firstLabel === current?.title);

  return (
    <div data-slot="shell-route" className="flex min-w-0 items-center gap-1.5 overflow-hidden text-sm">
      <nav aria-label="Ruta" className="flex min-w-0 shrink-0 items-center gap-1.5">
        {showSection && current && (
          <>
            {hasPublished ? (
              <Link
                href={current.href}
                className="shrink-0 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {current.title}
              </Link>
            ) : (
              <span aria-current="page" className="truncate text-foreground">
                {current.title}
              </span>
            )}
            {hasPublished && <ChevronRight aria-hidden className="size-3.5 shrink-0 text-text-muted" />}
          </>
        )}
      </nav>
      {/* El hueco donde la pantalla montada pinta sus migas. `overflow-hidden`:
          en pantalla estrecha cede el sitio en vez de montarse sobre los
          botones de la derecha. */}
      <div
        ref={setShellHeaderHost}
        data-slot="shell-header-slot"
        className="flex min-w-0 items-center gap-2 overflow-hidden [&_[data-slot=breadcrumbs]]:flex-nowrap [&_[data-slot=breadcrumbs]]:gap-1.5 [&_[data-slot=breadcrumbs]]:whitespace-nowrap [&_[data-slot=breadcrumbs]]:text-sm [&_[data-slot=breadcrumbs]_[aria-current=page]]:font-normal [&_[data-slot=breadcrumbs]_[aria-current=page]]:text-foreground"
      />
    </div>
  );
}

/**
 * Cabecera del shell — anatomía del playground de UX (`AppHeader.tsx`): 60px,
 * plegar + ruta a la izquierda, buscador al centro y a la derecha avisos,
 * procesos y la cuenta (avatar redondo).
 *
 * Esta franja es para lo transversal: dónde estás (la ruta, con las migas que
 * publica cada pantalla), la búsqueda, los avisos y la cuenta. El tema y la
 * configuración no están aquí: cuelgan de la marca, en el menú lateral. No
 * repite el título de la pantalla: ese es el `PageHeader`.
 */
export function AppHeader({ user, initialUnreadCount = 0, navAccess, processCenter }: AppHeaderProps) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  // Un registro de HubSpot se abre en su pantalla (Empresas / Contactos). Si ya se está
  // en ella, se avisa a la lista: navegar a la misma ruta no la vuelve a montar.
  const openHubSpotRecord = React.useCallback<OpenHubSpotRecord>(
    (kind, id) => {
      if (pathname === hubspotRecordPath(kind)) {
        window.dispatchEvent(new CustomEvent<HubSpotOpenDetail>(HUBSPOT_OPEN_EVENT, { detail: { kind, id } }));
        return;
      }
      router.push(kind === "company" ? hubspotCompanyHref(id) : hubspotContactHref(id));
    },
    [pathname, router],
  );
  // Lo de SellUp que se abre en una pantalla ya montada (Por revisar, candidatos): se
  // avisa con su evento además de navegar.
  const openSellUpRecord = React.useCallback<OpenSellUpRecord>(
    (href, event) => {
      // Sólo si ya se está en ESA lista (misma ruta y misma pestaña) se le avisa, y la
      // dirección va sin `candidate` (si no, recargar volvería a abrir la ficha). Si es otra
      // lista, la nueva la abre al montarse desde la dirección: así otra cola no la abre.
      if (event && isSameListView(window.location.href, href)) {
        window.dispatchEvent(new CustomEvent(event.type, { detail: { candidateId: event.candidateId, queue: event.queue } }));
        router.push(stripCandidateReviewParam(href));
        return;
      }
      router.push(href);
    },
    [router],
  );
  // Una empresa o un contacto de SellUp se abre en su ficha lateral (dueña 17-11): si ya
  // se está en su lista, se le avisa; si no, se va a la lista con `?abrir=<id>`.
  const openSellUpDrawer = React.useCallback<OpenSellUpDrawer>(
    (kind, id) => {
      if (isOnRecordList(window.location.href, kind)) {
        window.dispatchEvent(new CustomEvent<OpenRecordDetail>(OPEN_RECORD_EVENT, { detail: { kind, id } }));
        return;
      }
      router.push(openRecordHref(kind, id));
    },
    [router],
  );
  const loadObjects = React.useCallback(() => loadSearchObjects(openSellUpDrawer), [openSellUpDrawer]);
  const searchRemote = React.useCallback(
    (query: string, signal: AbortSignal) =>
      searchEverywhere(query, signal, openHubSpotRecord, openSellUpRecord, openSellUpDrawer),
    [openHubSpotRecord, openSellUpRecord, openSellUpDrawer],
  );
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const { collapsed, toggle } = useSidebar();
  // Un solo botón: en escritorio pliega el menú lateral; en el móvil, donde el
  // lateral es un cajón, lo abre.
  const menuLabel = collapsed ? "Abrir menú" : "Cerrar menú";
  const onMenuClick = () => {
    const desktop = typeof window.matchMedia === "function" && window.matchMedia("(min-width: 768px)").matches;
    if (desktop) toggle();
    else setMobileMenuOpen(true);
  };

  const { isAdmin, roleKey } = navAccess;
  const current = mainNavItems.find(
    (item) => pathname === item.href || pathname.startsWith(item.href + "/"),
  );

  // Las secciones de Configuración también son destinos de la búsqueda: son
  // justo a lo que se llega una vez al mes y de lo que no se recuerda la ruta.
  const searchDestinations = React.useMemo<SearchNavigateItem[]>(
    () => [
      ...getVisibleNavItems(mainNavItems, { isAdmin, roleKey }).map((item) => ({
        id: item.href,
        label: item.title,
        href: item.href,
        icon: item.icon,
        keywords: NAV_KEYWORDS[item.href],
      })),
      ...getVisibleSettingsSections({ isAdmin, isActive: true }).map((section) => ({
        id: `settings-${section.id}`,
        label: section.title,
        href: section.href,
        icon: section.icon,
        section: "Configuración",
        keywords: SETTINGS_KEYWORDS[section.id],
      })),
    ],
    [isAdmin, roleKey],
  );

  const displayName =
    (user.user_metadata?.full_name as string | undefined) ?? user.email ?? "Usuario";
  const avatarUrl = user.user_metadata?.avatar_url as string | undefined;

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <header className="flex h-15 shrink-0 items-center gap-3.5 border-b border-border px-5 max-sm:gap-2 max-sm:px-3">
      <DrawerShell
        open={mobileMenuOpen}
        onOpenChange={setMobileMenuOpen}
        side="left"
        size="sm"
        title="Menú"
        className="w-72 sm:!max-w-xs"
      >
        <AppSidebar
          navAccess={navAccess}
          forceExpanded
          onNavigate={() => setMobileMenuOpen(false)}
          className="p-0 pt-0"
        />
      </DrawerShell>

      <div className="flex min-w-0 flex-1 basis-0 items-center gap-2.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={onMenuClick}
                aria-label={menuLabel}
                className={cn(HEADER_ICON_BUTTON, "size-7.5")}
              >
                <PanelLeft className="size-4" />
              </button>
            }
          />
          <TooltipContent side="bottom">{menuLabel} · ⌘B</TooltipContent>
        </Tooltip>
        <HeaderRoute current={current} />
      </div>

      {/* Búsqueda general (⌘K), en el centro de la cabecera — como en Thema: los
          dos lados crecen por igual (`flex-1 basis-0`), así que queda centrada
          respecto a la franja y no respecto a lo que haya a cada lado. */}
      <GlobalSearch
        navigate={searchDestinations}
        loadObjects={loadObjects}
        objectsHint={SEARCH_OBJECTS_HINT}
        searchRemote={searchRemote}
        remoteLabel="todo SellUp y HubSpot"
        placeholder="Buscar en todo…"
        // Cede ancho antes que las acciones: con el panel del Agente IA abierto en
        // una ventana estrecha, un ancho fijo las empujaba debajo del panel.
        className="min-w-8 shrink overflow-hidden md:w-72 lg:w-85"
      />

      {/* Acciones transversales */}
      <div className="flex flex-1 basis-0 items-center justify-end gap-1.5 sm:gap-2.5 [&>*]:shrink-0">
        <NotificationBell initialUnreadCount={initialUnreadCount} />
        {processCenter}
        <AccountMenu
          user={{ name: displayName, email: user.email, avatarUrl }}
          roleLabel={roleLabel(navAccess)}
          rolePreview={navAccess.rolePreview}
          onLogout={handleSignOut}
        />
      </div>
    </header>
  );
}
