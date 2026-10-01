"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, FileText, ListTree, Search, Sparkles, type LucideIcon } from "@/icons";

import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/feedback/spinner";

/** Un registro del producto: una empresa, un contacto, un lote. */
export interface SearchObjectItem {
  id: string;
  title: string;
  /** Contexto que se lee tras el título, separado por puntos medios. */
  meta?: readonly string[];
  /** Términos por los que se encuentra pero que no se muestran: dominio, correo. */
  keywords?: readonly string[];
  icon?: LucideIcon;
  /** El tipo de registro: agrupa los resultados («Empresas», «Contactos»). */
  group?: string;
  /** Ruta a la que lleva. */
  href?: string;
  /** Alternativa a `href` cuando abrir no es navegar. */
  onSelect?: () => void;
  /** Etiqueta de la acción a la derecha; «Abrir» si no se dice otra cosa. */
  actionLabel?: string;
}

/** Un destino de la navegación. */
export interface SearchNavigateItem {
  id: string;
  /** Nombre de la pantalla: «Lotes de prospección». */
  label: string;
  /** Ruta a la que lleva. */
  href: string;
  icon?: LucideIcon;
  /** Sección a la que pertenece; se lee antes del nombre: «Admin › Usuarios». */
  section?: string;
  /** Términos por los que se encuentra pero que no se muestran: alias, siglas. */
  keywords?: readonly string[];
}

export type SearchScope = "all" | "navigate" | "objects" | "ask";

export interface GlobalSearchProps {
  /** Los destinos entre los que se busca. */
  navigate: readonly SearchNavigateItem[];
  /** Registros ya en memoria. */
  objects?: readonly SearchObjectItem[];
  /**
   * Registros que se piden al servidor. Se llama una vez, la primera vez que
   * se escribe algo con la búsqueda abierta, y el resultado se filtra aquí.
   */
  loadObjects?: () => Promise<readonly SearchObjectItem[]>;
  /** Qué cubre `loadObjects`, para que un «sin resultados» no engañe. */
  objectsHint?: string;
  /** Habilita preguntar con lo escrito; sin esto, no hay grupo de preguntas. */
  onAsk?: (question: string) => void;
  /** Una línea que explica qué hará la pregunta y dónde responde. */
  askHint?: string;
  placeholder?: string;
  className?: string;
}

/** Cuánto hay que escribir antes de pedir registros al servidor. */
const MIN_QUERY_FOR_OBJECTS = 2;
/** Cuántos registros se pintan por grupo: más que eso, hay que afinar. */
const MAX_OBJECTS_PER_GROUP = 8;
const DEFAULT_OBJECT_GROUP = "Objetos";

const SCOPE_LABELS: Readonly<Record<SearchScope, string>> = {
  all: "Todo",
  navigate: "Ir a",
  objects: "Objetos",
  ask: "Preguntar",
};

/** Sin tildes y en minúsculas: «prospeccion» encuentra «Prospección». */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * Palabra a palabra, no la frase entera: «lotes prospeccion» encuentra
 * «Lotes de prospección» aunque la frase no aparezca tal cual. Cada palabra
 * tiene que estar en algún campo; el orden no importa.
 */
function matches(haystack: readonly string[], needle: string): boolean {
  const words = fold(needle).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = fold(haystack.join(" "));
  return words.every((word) => text.includes(word));
}

function Hint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <kbd className="font-sans text-xs text-muted-foreground">{keys}</kbd>
      {label}
    </span>
  );
}

type ObjectsStatus = "idle" | "loading" | "ready" | "error";

interface ObjectGroup {
  heading: string;
  items: readonly SearchObjectItem[];
  /** Cuántos coincidían antes de recortar el grupo. */
  total: number;
}

function groupObjects(items: readonly SearchObjectItem[]): ObjectGroup[] {
  const headings = Array.from(new Set(items.map((item) => item.group ?? DEFAULT_OBJECT_GROUP)));
  return headings.map((heading) => {
    const inGroup = items.filter((item) => (item.group ?? DEFAULT_OBJECT_GROUP) === heading);
    return { heading, items: inGroup.slice(0, MAX_OBJECTS_PER_GROUP), total: inGroup.length };
  });
}

/**
 * GlobalSearch — port de Thema `search/GlobalSearch.tsx` (⌘K / Ctrl+K).
 *
 * Un solo campo para las tres cosas que alguien quiere hacer cuando no sabe
 * dónde está algo: abrir un registro («Objetos»), ir a una pantalla («Ir a») o
 * preguntar («Preguntar», solo si quien la monta pasa `onAsk`). Las pestañas
 * de alcance acotan los grupos y el recuento dice cuánto hay. Solo aparece la
 * pestaña de lo que existe: sin registros ni agente, es una búsqueda de
 * pantallas.
 *
 * Teclado: ↑ ↓ se mueven por los resultados, ↵ abre, ⇥ cambia de alcance (en
 * vez de sacar el foco del campo) y esc cierra.
 *
 * El componente no sabe nada del dominio: los destinos, los registros y cómo
 * se piden se los pasa quien lo monta (`app-header.tsx`). El filtrado se hace
 * aquí y no en cmdk (`shouldFilter={false}`) porque las pestañas y el recuento
 * necesitan saber cuántos resultados hay en cada grupo antes de pintarlos, y
 * porque la coincidencia ignora tildes.
 *
 * @example
 * <GlobalSearch
 *   placeholder="Buscar…"
 *   navigate={[{ id: "accounts", label: "Empresas", href: "/accounts", icon: Building2 }]}
 *   loadObjects={loadSearchObjects}
 *   objectsHint="Busca entre tus empresas y contactos más recientes."
 * />
 */
export function GlobalSearch({
  navigate,
  objects,
  loadObjects,
  objectsHint,
  onAsk,
  askHint,
  placeholder = "Buscar…",
  className,
}: GlobalSearchProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [activeScope, setActiveScope] = React.useState<SearchScope>("all");
  const [loadedObjects, setLoadedObjects] = React.useState<readonly SearchObjectItem[]>([]);
  const [objectsStatus, setObjectsStatus] = React.useState<ObjectsStatus>("idle");

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        // Cada apertura empieza en limpio: abrir la búsqueda con los restos de
        // la anterior es desconcertante.
        setQuery("");
        setActiveScope("all");
        setIsOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // La lista responde a lo escrito sin frenar el tecleo.
  const trimmed = React.useDeferredValue(query).trim();
  const hasObjects = Boolean(loadObjects) || Boolean(objects?.length);
  const canAsk = Boolean(onAsk) && trimmed.length > 0;
  const wantsObjects = trimmed.length >= MIN_QUERY_FOR_OBJECTS;

  // Los registros se piden una sola vez por apertura, y solo cuando hay algo
  // que buscar: abrir ⌘K para ir a una pantalla no cuesta una consulta.
  React.useEffect(() => {
    if (!isOpen || !loadObjects || !wantsObjects || objectsStatus !== "idle") return undefined;
    let isCurrent = true;
    setObjectsStatus("loading");
    loadObjects()
      .then((items) => {
        if (!isCurrent) return;
        setLoadedObjects(items);
        setObjectsStatus("ready");
      })
      .catch(() => {
        if (isCurrent) setObjectsStatus("error");
      });
    return () => {
      isCurrent = false;
    };
    // `objectsStatus` fuera: cambiarlo a "loading" no debe cancelar la carga.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, loadObjects, wantsObjects]);

  const allObjects = React.useMemo(
    () => [...(objects ?? []), ...loadedObjects],
    [objects, loadedObjects],
  );
  const foundObjects = React.useMemo(
    () =>
      wantsObjects || !loadObjects
        ? allObjects.filter((item) =>
            matches([item.title, ...(item.meta ?? []), ...(item.keywords ?? [])], trimmed),
          )
        : [],
    [allObjects, trimmed, wantsObjects, loadObjects],
  );
  const foundNavigate = React.useMemo(
    () =>
      navigate.filter((item) =>
        matches([item.label, item.section ?? "", ...(item.keywords ?? [])], trimmed),
      ),
    [navigate, trimmed],
  );

  const scopes = React.useMemo<readonly SearchScope[]>(() => {
    const available: SearchScope[] = ["all"];
    if (navigate.length > 0) available.push("navigate");
    if (hasObjects) available.push("objects");
    if (onAsk) available.push("ask");
    return available;
  }, [navigate.length, hasObjects, onAsk]);

  const inScope = (scope: SearchScope) => activeScope === "all" || activeScope === scope;
  const objectGroups = inScope("objects") ? groupObjects(foundObjects) : [];
  const shownObjects = objectGroups.reduce((sum, group) => sum + group.items.length, 0);
  const showAsk = canAsk && inScope("ask");
  const showNavigate = foundNavigate.length > 0 && inScope("navigate");
  const isLoadingObjects = hasObjects && inScope("objects") && wantsObjects && objectsStatus === "loading";
  const hasObjectsError = hasObjects && inScope("objects") && wantsObjects && objectsStatus === "error";
  const count = (showAsk ? 1 : 0) + shownObjects + (showNavigate ? foundNavigate.length : 0);

  const resetAndOpen = () => {
    setQuery("");
    setActiveScope("all");
    setIsOpen(true);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setIsOpen(nextOpen);
    // La próxima apertura vuelve a pedir los registros: pueden haber cambiado.
    if (!nextOpen) {
      setObjectsStatus("idle");
      setLoadedObjects([]);
    }
  };

  const close = (run: () => void) => {
    handleOpenChange(false);
    run();
  };

  const openObject = (item: SearchObjectItem) =>
    close(() => {
      if (item.onSelect) item.onSelect();
      else if (item.href) router.push(item.href);
    });

  // El tabulador cambia de alcance en vez de sacar el foco del campo, que es
  // lo que anuncia la barra de atajos.
  const onCommandKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "Tab" || scopes.length < 2) return;
    event.preventDefault();
    const index = scopes.indexOf(activeScope);
    const next = event.shiftKey ? index - 1 + scopes.length : index + 1;
    setActiveScope(scopes[next % scopes.length]);
  };

  const emptyMessage = (() => {
    if (activeScope === "objects" && !wantsObjects) {
      return "Escribe al menos dos letras para buscar registros.";
    }
    if (activeScope === "ask" && !trimmed) return "Escribe tu pregunta.";
    return trimmed ? `Nada que coincida con «${trimmed}».` : "Escribe para buscar.";
  })();

  return (
    <>
      <button
        type="button"
        onClick={resetAndOpen}
        aria-label="Abrir la búsqueda general"
        className={cn(
          "flex h-8 items-center gap-2 rounded-md border border-border/70 bg-card px-2.5 text-sm text-text-muted transition-colors",
          "hover:bg-surface-muted hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
          className,
        )}
      >
        <Search className="size-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">{placeholder}</span>
        <Kbd className="ml-1 hidden sm:inline-flex">⌘K</Kbd>
      </button>

      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="top-[12%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-2xl"
        >
          <DialogTitle className="sr-only">Búsqueda general</DialogTitle>
          <DialogDescription className="sr-only">
            {hasObjects
              ? "Busca un registro o una pantalla y ábrelo."
              : "Busca una pantalla y ve a ella."}
          </DialogDescription>

          <Command
            shouldFilter={false}
            loop
            onKeyDown={onCommandKeyDown}
            className="rounded-none bg-transparent"
          >
            <div className="relative">
              <CommandInput
                value={query}
                onValueChange={setQuery}
                placeholder={placeholder}
                className="h-12 pr-12"
              />
              <Kbd className="absolute right-3 top-1/2 hidden -translate-y-1/2 sm:inline-flex">esc</Kbd>
            </div>

            <div className="flex items-center gap-1 border-b border-border/60 px-3 py-2">
              <div role="tablist" aria-label="Alcance de la búsqueda" className="flex items-center gap-1">
                {scopes.map((item) => (
                  <button
                    key={item}
                    type="button"
                    role="tab"
                    // Fuera del orden de tabulación: ⇥ ya cambia de alcance.
                    tabIndex={-1}
                    aria-selected={activeScope === item}
                    onClick={() => setActiveScope(item)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
                      activeScope === item
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-surface-muted hover:text-foreground",
                    )}
                  >
                    {SCOPE_LABELS[item]}
                  </button>
                ))}
              </div>
              <span
                aria-live="polite"
                data-slot="search-count"
                className="ml-auto shrink-0 text-xs tabular-nums text-text-muted"
              >
                {isLoadingObjects ? "Buscando…" : `${count} ${count === 1 ? "resultado" : "resultados"}`}
              </span>
            </div>

            <CommandList className="max-h-[min(60vh,26rem)]">
              {count === 0 && !isLoadingObjects && !hasObjectsError && (
                <CommandEmpty>{emptyMessage}</CommandEmpty>
              )}

              {showAsk && (
                <CommandGroup heading="Preguntar">
                  <SearchRow
                    value={`ask-${trimmed}`}
                    icon={Sparkles}
                    title={`«${trimmed}»`}
                    description={askHint}
                    ariaLabel={`Preguntar: ${trimmed}`}
                    action={<CornerDownLeft className="size-3.5" aria-hidden="true" />}
                    onSelect={() => close(() => onAsk?.(trimmed))}
                  />
                </CommandGroup>
              )}

              {objectGroups.map((group) => (
                <CommandGroup
                  key={group.heading}
                  heading={
                    group.total > group.items.length
                      ? `${group.heading} · ${group.items.length} de ${group.total}`
                      : group.heading
                  }
                >
                  {group.items.map((item) => (
                    <SearchRow
                      key={item.id}
                      value={`object-${item.id}`}
                      icon={item.icon ?? FileText}
                      title={item.title}
                      meta={item.meta}
                      action={item.actionLabel ?? "Abrir"}
                      onSelect={() => openObject(item)}
                    />
                  ))}
                </CommandGroup>
              ))}

              {isLoadingObjects && (
                <div
                  role="status"
                  data-slot="search-objects-loading"
                  className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground"
                >
                  <Spinner size="xs" decorative />
                  Buscando registros…
                </div>
              )}

              {hasObjectsError && (
                <p role="alert" className="px-4 py-3 text-xs text-destructive">
                  No pudimos buscar entre los registros. Cierra la búsqueda y vuelve a intentarlo.
                </p>
              )}

              {showNavigate && (
                <CommandGroup heading="Ir a">
                  {foundNavigate.map((item) => (
                    <SearchRow
                      key={item.id}
                      value={`navigate-${item.id}`}
                      icon={item.icon ?? ListTree}
                      title={item.label}
                      breadcrumb={item.section ? [item.section] : undefined}
                      action="Navegar"
                      onSelect={() => close(() => router.push(item.href))}
                    />
                  ))}
                </CommandGroup>
              )}
            </CommandList>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 px-3 py-2 text-xs text-text-muted">
              <Hint keys="↑↓" label="moverse" />
              <Hint keys="↵" label={onAsk ? "abrir o preguntar" : "abrir"} />
              {scopes.length > 1 && <Hint keys="⇥" label="cambiar de grupo" />}
              <Hint keys="esc" label="cerrar" />
              {hasObjects && objectsHint && inScope("objects") && (
                <span className="basis-full sm:ml-auto sm:basis-auto">{objectsHint}</span>
              )}
            </div>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Una fila de resultado: icono, título con su contexto y la acción a la derecha. */
function SearchRow({
  value,
  icon: Icon,
  title,
  meta,
  breadcrumb,
  description,
  action,
  ariaLabel,
  onSelect,
}: {
  value: string;
  icon: LucideIcon;
  title: string;
  meta?: readonly string[];
  breadcrumb?: readonly string[];
  description?: string;
  action?: React.ReactNode;
  ariaLabel?: string;
  onSelect: () => void;
}) {
  // Etiqueta explícita: los «·» y «›» que separan las partes son decorativos,
  // y sin esto un lector de pantalla leería «AdminUsuarios» todo junto.
  const label = ariaLabel ?? [...(breadcrumb ?? []), title, ...(meta ?? [])].join(", ");
  return (
    <CommandItem
      value={value}
      aria-label={label}
      onSelect={onSelect}
      className="items-start gap-2.5 px-2.5 py-2 data-[selected=true]:before:absolute data-[selected=true]:before:inset-y-1 data-[selected=true]:before:left-0 data-[selected=true]:before:w-0.5 data-[selected=true]:before:rounded-full data-[selected=true]:before:bg-primary"
    >
      <Icon className="mt-0.5 size-4 shrink-0 text-text-muted" aria-hidden="true" />
      <span className="min-w-0 flex-1 overflow-hidden">
        <span className="flex min-w-0 items-baseline gap-x-1.5 truncate">
          {breadcrumb?.map((step) => (
            <React.Fragment key={step}>
              <span className="text-muted-foreground">{step}</span>
              <span aria-hidden className="text-text-muted">
                ›
              </span>
            </React.Fragment>
          ))}
          <span className="shrink-0 font-semibold text-foreground">{title}</span>
          {meta?.map((entry) => (
            <React.Fragment key={entry}>
              <span aria-hidden className="text-text-muted">
                ·
              </span>
              <span className="truncate text-muted-foreground">{entry}</span>
            </React.Fragment>
          ))}
        </span>
        {description && (
          <span className="mt-0.5 block text-xs leading-snug text-text-muted">{description}</span>
        )}
      </span>
      {action && (
        <CommandShortcut className="shrink-0 self-center tracking-normal">{action}</CommandShortcut>
      )}
    </CommandItem>
  );
}
