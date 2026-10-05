import type { ReactNode } from "react";
import { DataTablePage } from "@/components/shared/data-table-page";
import { Breadcrumbs, type BreadcrumbItem } from "@/components/navigation/breadcrumbs";
import {
  PIPELINE_CRUMB_LABEL,
  PIPELINE_DESCRIPTION,
  PIPELINE_TITLE,
  type PipelineView,
} from "./pipeline-copy";
import { PipelineViewTabs } from "./pipeline-view-tabs";

interface PipelineFrameProps {
  view: PipelineView;
  accountId: string | null;
  /** El nombre de la empresa elegida, para la última miga. */
  accountName?: string | null;
  onViewChange?: (view: PipelineView) => void;
  /** Las acciones de la pantalla (`PipelineScreenActions`): van a la barra o, «En la pantalla», a esta cabecera. */
  actions?: ReactNode;
  children?: ReactNode;
}

/** Las migas: con una empresa elegida, «Pipeline SellUp» es un enlace de vuelta al resumen. */
export function pipelineCrumbs(accountId: string | null, accountName?: string | null): readonly (string | BreadcrumbItem)[] {
  if (!accountId) return [PIPELINE_CRUMB_LABEL];
  return [{ label: PIPELINE_CRUMB_LABEL, href: "/pipeline" }, accountName ?? "Empresa"];
}

/**
 * El marco de la pantalla Pipeline, el mismo que el de Empresas y Contactos:
 * `DataTablePage compact` (título, descripción y pestañas de vista en una sola
 * banda) con el contenido llenando el alto que queda. Lo usan la pantalla, su
 * esqueleto de carga y su estado de error, para que la cabecera no salte.
 */
export function PipelineFrame({ view, accountId, accountName, onViewChange, actions, children }: PipelineFrameProps) {
  return (
    <DataTablePage
      compact
      pageScroll
      title={PIPELINE_TITLE}
      description={PIPELINE_DESCRIPTION}
      breadcrumbs={<Breadcrumbs items={pipelineCrumbs(accountId, accountName)} />}
      actions={actions}
      tabs={<PipelineViewTabs view={view} accountId={accountId} onViewChange={onViewChange} />}
    >
      {/* Cada vista entra con el mismo fundido que el panel de una pestaña. La
          `key` lo repite al cambiar de vista; el esqueleto y la pantalla son
          marcos distintos, así que el paso de uno a otro también se suaviza. */}
      <div key={view} className="flex min-h-0 flex-1 flex-col animate-su-tab-in">
        {children}
      </div>
    </DataTablePage>
  );
}
