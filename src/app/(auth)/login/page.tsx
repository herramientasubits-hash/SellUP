import { GoogleSignInButton } from '@/modules/auth/components/google-sign-in-button';
import { LoginBrandPanel } from '@/modules/auth/components/login-brand-panel';
import { LoginAccessCard } from '@/modules/auth/components/login-access-card';

const errorMessages: Record<string, string> = {
  auth_callback_failed:
    'No fue posible completar el inicio de sesión. Intenta nuevamente.',
  missing_auth_code:
    'La respuesta de autenticación fue incompleta. Intenta nuevamente.',
  oauth:
    'No fue posible iniciar el flujo de autenticación. Intenta nuevamente.',
  domain_not_authorized:
    'Tu cuenta no tiene acceso a SellUp. Ingresa con tu correo corporativo de UBITS.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const errorMessage = params.error
    ? (errorMessages[params.error] ??
      'Ocurrió un error al autenticar. Intenta nuevamente.')
    : null;

  return (
    <div className="flex min-h-screen bg-background">
      {/* Panel izquierdo — branding (desktop only) */}
      <LoginBrandPanel />

      {/* Panel derecho — login */}
      <div className="relative flex flex-1 flex-col items-center justify-center px-6 py-12 lg:py-16">
        {/* Resplandor ambiental detrás de la card — solo desktop */}
        <div
          className="pointer-events-none absolute inset-0 hidden lg:block"
          style={{
            background:
              'radial-gradient(ellipse 65% 55% at 50% 50%, rgba(91,127,255,0.05) 0%, transparent 75%)',
          }}
        />
        <LoginAccessCard errorMessage={errorMessage}>
          <GoogleSignInButton />
        </LoginAccessCard>
      </div>
    </div>
  );
}
