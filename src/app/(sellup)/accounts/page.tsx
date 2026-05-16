import { Building2 } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { ModulePlaceholder } from "@/components/shared/module-placeholder";
import { SurfaceCard } from "@/components/shared/surface-card";

export default function AccountsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Empresas / Cuentas"
        description="Vista transversal de todas las cuentas registradas en SellUp."
      />

      {/* Table skeleton placeholder */}
      <SurfaceCard noPadding>
        {/* Table header */}
        <div className="border-b border-border/40 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="h-2 w-32 rounded-full su-skeleton" />
            <div className="h-2 w-20 rounded-full su-skeleton" />
            <div className="ml-auto h-8 w-28 rounded-xl su-skeleton" />
          </div>
        </div>
        {/* Table rows */}
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b border-border/20 px-5 py-4 transition-colors hover:bg-accent/30 last:border-0"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div className="h-9 w-9 rounded-xl su-skeleton shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-2 w-40 rounded-full su-skeleton" />
              <div className="h-1.5 w-24 rounded-full su-skeleton" />
            </div>
            <div className="h-6 w-18 rounded-full su-skeleton" />
            <div className="h-2 w-12 rounded-full su-skeleton" />
          </div>
        ))}
      </SurfaceCard>

      <ModulePlaceholder
        icon={Building2}
        module="Empresas / Cuentas — Módulo en construcción"
        description="La vista de Cuentas mostrará el listado transversal de todas las cuentas registradas con filtros, búsqueda avanzada y acceso directo al expediente de cada una."
        features={[
          { label: "Listado con búsqueda y filtros" },
          { label: "Estado de cada cuenta en el pipeline" },
          { label: "Señales de inteligencia recientes" },
          { label: "Acceso al expediente por cuenta" },
          { label: "Vista por industria y tamaño" },
          { label: "Enriquecimiento vía Apollo.io" },
        ]}
      />
    </div>
  );
}
