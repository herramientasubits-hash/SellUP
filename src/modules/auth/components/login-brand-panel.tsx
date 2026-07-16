/**
 * Panel de marca para login desktop.
 * Headline dominante + 3 feature cards horizontales.
 * Diseño oscuro forzado — independiente del tema del sistema.
 */

// ─── Feature card horizontal ──────────────────────────────────────────────────

interface FeatureCardProps {
  label: string;
  desc: string;
}

function FeatureCard({ label, desc }: FeatureCardProps) {
  return (
    <div className="group flex-1 rounded-2xl px-4 py-4 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[rgba(91,127,255,0.08)]"
      style={{
        // Editorial context: hardcoded for brand expression.
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.10)',
      }}
    >
      <div className="mb-2 h-0.5 w-6 rounded-full bg-[#5b7eff]/50 transition-all duration-300 group-hover:w-10 group-hover:bg-[#5b7eff]/80" />
      <p className="text-sm font-semibold leading-snug text-white/90">{label}</p>
      <p className="mt-1.5 text-xs leading-relaxed text-white/60">{desc}</p>
    </div>
  );
}

// ─── Panel principal ──────────────────────────────────────────────────────────

export function LoginBrandPanel() {
  return (
    <div
      className="hidden lg:flex lg:w-[52%] relative flex-col justify-between overflow-hidden p-12"
      style={{ background: '#060c1a' }}
    >
      {/* Textura: grid sutil */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)',
          backgroundSize: '56px 56px',
        }}
      />

      {/* Glow principal — azul, desde la izquierda */}
      <div
        className="pointer-events-none absolute left-0 top-1/3 h-[600px] w-[600px] -translate-x-1/3 rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(91,127,255,0.12) 0%, transparent 60%)',
        }}
      />

      {/* Glow secundario — violeta, desde abajo */}
      <div
        className="pointer-events-none absolute bottom-0 right-1/4 h-[400px] w-[400px] translate-y-1/3 rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(139,92,246,0.08) 0%, transparent 60%)',
        }}
      />

      {/* Anillos concéntricos — borde derecho */}
      <div className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 translate-x-[42%]">
        <div className="relative h-[520px] w-[520px]">
          <div
            className="absolute inset-0 rounded-full"
            style={{ border: '1px solid rgba(255,255,255,0.04)' }}
          />
          <div
            className="absolute inset-[13%] rounded-full"
            style={{ border: '1px solid rgba(91,127,255,0.07)' }}
          />
          <div
            className="absolute inset-[27%] rounded-full"
            style={{ border: '1px solid rgba(91,127,255,0.13)' }}
          />
          <div
            className="absolute inset-[41%] rounded-full"
            style={{
              border: '1px solid rgba(91,127,255,0.22)',
              background: 'rgba(91,127,255,0.03)',
            }}
          />
          <div
            className="absolute inset-[48%] rounded-full"
            style={{ background: 'rgba(91,127,255,0.45)' }}
          />
        </div>
      </div>

      {/* ── Logo ─────────────────────────────────────────────────────────── */}
      <div className="relative">
        <h1 className="text-[1.85rem] font-extrabold leading-none tracking-tight">
          <span className="text-white">Sell</span>
          <span style={{ color: '#5b7eff' }}>Up</span>
        </h1>
        <div className="mt-2.5 flex items-center gap-2.5">
          <div className="h-px w-6 rounded-full" style={{ background: 'linear-gradient(90deg, #5b7eff, transparent)' }} />
          <p
            className="text-[10px] font-semibold uppercase tracking-[0.18em]"
            style={{ color: 'rgba(255,255,255,0.42)' }}
          >
            Inteligencia Comercial
          </p>
        </div>
      </div>

      {/* ── Bloque central ───────────────────────────────────────────────── */}
      <div className="relative space-y-10">
        {/* Headline grande */}
        <h2
          className="font-extrabold tracking-tight text-white"
          style={{
            fontSize: 'clamp(2.4rem, 3.5vw, 3.2rem)',
            lineHeight: 1.06,
          }}
        >
          Prepara tus cuentas
          <br />
          con inteligencia
          <br />
          <span style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0.50), rgba(91,127,255,0.60))',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}>comercial.</span>
        </h2>

        {/* Feature cards */}
        <div className="flex gap-3">
          <FeatureCard
            label="Pipeline organizado"
            desc="Prospectos con contexto automático."
          />
          <FeatureCard
            label="IA de cuenta"
            desc="Insights accionables al instante."
          />
          <FeatureCard
            label="Trazabilidad"
            desc="Audita todo el trabajo comercial."
          />
        </div>
      </div>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <div className="relative">
        <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.32)' }}>
          Plataforma interna · UBITS · 2026
        </p>
      </div>
    </div>
  );
}
