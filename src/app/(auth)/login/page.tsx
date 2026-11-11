import { GoogleSignInButton } from '@/modules/auth/components/google-sign-in-button';
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
    // «Mínimo premium»: una sola tarjeta centrada sobre una aurora quieta con el color de la marca.
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-background px-4 py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute -left-[15%] -top-[25%] size-[70vmax] rounded-full opacity-60 blur-3xl"
        style={{ background: 'radial-gradient(circle, color-mix(in srgb, var(--su-brand) 32%, transparent), transparent 60%)' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-[30%] -right-[20%] size-[60vmax] rounded-full opacity-50 blur-3xl"
        style={{ background: 'radial-gradient(circle, color-mix(in srgb, var(--chart-3) 30%, transparent), transparent 60%)' }}
      />
      <LoginAccessCard errorMessage={errorMessage}>
        <GoogleSignInButton />
      </LoginAccessCard>
    </main>
  );
}
