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
} from "@/components/search";
import { getAccountsList } from "@/modules/accounts/actions";
import { getAllContacts } from "@/modules/contacts/actions";
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
};

/** Palabras con las que también se busca un módulo. */
const NAV_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  [SOURCE_CATALOG_ROUTE]: ["fuentes", "países", "registros"],
  [ROI_CALCULATOR_ROUTE]: ["roi", "proyección", "valor", "cotización", "propuesta"],
};

const SEARCH_OBJECTS_HINT = "Registros: tus 200 empresas y 500 contactos más recientes.";

function compact(values: readonly (string | null | undefined)[]): string[] {
  return values.filter((value): value is string => Boolean(value));
}

/**
 * Los registros de la búsqueda general: empresas y contactos. Reutiliza las
 * lecturas que ya alimentan sus tablas (mismo permiso y mismo alcance
 * comercial); no hay consulta nueva. Si una de las dos falla, la otra sigue.
 */
async function loadSearchObjects(): Promise<SearchObjectItem[]> {
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
          href: `/accounts/${account.id}`,
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
          href: `/contacts/${contact.id}`,
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
        loadObjects={loadSearchObjects}
        objectsHint={SEARCH_OBJECTS_HINT}
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
          onLogout={handleSignOut}
        />
      </div>
    </header>
  );
}
