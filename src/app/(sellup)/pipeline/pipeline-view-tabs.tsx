"use client";

import { useRouter } from "next/navigation";
import { parsePipelineFilters } from "@/modules/pipeline/pipeline-filters";
import { ThemaTabs } from "@/components/navigation/thema-tabs";
import { PIPELINE_VIEWS, pipelineHref, resolvePipelineView, type PipelineView } from "./pipeline-copy";

interface PipelineViewTabsProps {
  view: PipelineView;
  /** La empresa elegida: el recorrido la conserva al volver a él; el tablero no lleva ninguna. */
  accountId: string | null;
  /** Quien ya lleva la navegación (la pantalla, con su transición) la pasa aquí. Sin ella, navega la propia tira. */
  onViewChange?: (view: PipelineView) => void;
}

/**
 * Las dos vistas del Pipeline (Recorrido / Tablero) como pestañas de módulo
 * (`ThemaTabs` nivel `page`, en modo navegación): la vista vive en la URL
 * (`?view=`). Se pinta igual en la pantalla y en su esqueleto de carga.
 */
export function PipelineViewTabs({ view, accountId, onViewChange }: PipelineViewTabsProps) {
  const router = useRouter();

  return (
    <ThemaTabs
      navigation
      variant="page"
      fitContent
      listLabel="Vistas del pipeline"
      tabs={PIPELINE_VIEWS}
      activeTabId={view}
      onTabChange={(id) => {
        const next = resolvePipelineView(id);
        if (onViewChange) onViewChange(next);
        else {
          // Los filtros viven en la URL: se conservan al cambiar de vista.
          const filters = parsePipelineFilters(new URLSearchParams(window.location.search));
          router.push(pipelineHref(next, next === "recorrido" ? accountId : null, filters), { scroll: false });
        }
      }}
    />
  );
}
