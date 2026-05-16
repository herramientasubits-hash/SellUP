import { Building2, Brain, MessageSquare, Activity, Coins } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { ModulePlaceholder } from "@/components/shared/module-placeholder";
import { SurfaceCard, SurfaceCardHeader } from "@/components/shared/surface-card";

interface AccountPageProps {
  params: Promise<{ accountId: string }>;
}

const EXPEDIENTE_SECTIONS = [
  {
    title: "Inteligencia de cuenta",
    desc: "Árbol empresarial, decisores y competidores",
    icon: Brain,
    gradient: "from-su-brand/8 to-su-accent-cool/5",
  },
  {
    title: "Speech comercial",
    desc: "Narrativa de valor generada por IA",
    icon: MessageSquare,
    gradient: "from-su-accent-cool/8 to-su-brand/5",
  },
  {
    title: "Actividad y agentes",
    desc: "Ejecuciones, estado y trazabilidad",
    icon: Activity,
    gradient: "from-su-success/6 to-su-brand/4",
  },
  {
    title: "Costos asociados",
    desc: "Tokens y costo de IA por cuenta",
    icon: Coins,
    gradient: "from-su-warning/6 to-su-accent-warm/4",
  },
];

export default async function AccountDetailPage({ params }: AccountPageProps) {
  const { accountId } = await params;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Expediente de Cuenta"
        description={`Vista contextual central · ID: ${accountId}`}
      />

      {/* Section cards with icons and gradients */}
      <div className="grid gap-4 md:grid-cols-2">
        {EXPEDIENTE_SECTIONS.map((section) => (
          <SurfaceCard key={section.title} className="group relative overflow-hidden">
            <div className={`absolute inset-0 bg-gradient-to-br ${section.gradient} rounded-2xl opacity-40 transition-opacity group-hover:opacity-80`} />
            <div className="relative">
              <SurfaceCardHeader
                title={section.title}
                description={section.desc}
                actions={
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-card/60 text-muted-foreground/40 transition-colors group-hover:text-su-brand/60">
                    <section.icon className="h-4 w-4" />
                  </div>
                }
              />
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-1.5 rounded-full su-skeleton"
                    style={{ width: `${80 - i * 18}%` }}
                  />
                ))}
              </div>
            </div>
          </SurfaceCard>
        ))}
      </div>

      <ModulePlaceholder
        icon={Building2}
        module="Expediente de Cuenta — Módulo en construcción"
        description="El Expediente es la pantalla de trabajo más importante del MVP. Aquí el usuario consulta información de la cuenta, ve outputs de IA, ejecuta agentes y revisa actividad y costos."
        features={[
          { label: "Perfil completo de la cuenta" },
          { label: "Árbol empresarial y decisores clave" },
          { label: "Speech y narrativa comercial generada" },
          { label: "Ejecución de agentes IA desde la pantalla" },
          { label: "Actividad y trazabilidad completa" },
          { label: "Costos de IA asociados a la cuenta" },
        ]}
      />
    </div>
  );
}
