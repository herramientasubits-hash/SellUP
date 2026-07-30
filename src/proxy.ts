import { type NextRequest, NextResponse } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function proxy(request: NextRequest) {
  const { supabaseResponse, isAuthenticated } = await updateSession(request);

  const { pathname } = request.nextUrl;

  const isPublicPath =
    pathname.startsWith('/login') || pathname.startsWith('/auth');

  // Redirigir usuarios autenticados fuera de /login
  if (pathname.startsWith('/login') && isAuthenticated) {
    return NextResponse.redirect(new URL('/pipeline', request.url));
  }

  // Proteger todas las rutas que no son públicas
  if (!isPublicPath && !isAuthenticated) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return supabaseResponse;
}

// Rutas EXCLUIDAS de la protección de sesión. Son callbacks de máquina y jobs
// programados: no traen cookie de sesión de Supabase, así que sin exclusión el
// proxy los redirige a /login (307) ANTES de que corra su handler.
//
// Cada exclusión debe autenticarse por su cuenta y ser fail-closed:
//   * api/integrations/apollo/phone-reveal/webhook → token compartido
//     (APOLLO_PHONE_REVEAL_WEBHOOK_TOKEN); sin token válido responde 401 y no
//     toca la base. Su ausencia de esta lista era la CAUSA RAÍZ de los candidatos
//     pegados en "Revelación en proceso": Apollo recibía 307 → /login en cada
//     callback, así que `phone_reveal_webhook_received_at` nunca se escribía.
//   * api/cron/phone-reveal-recovery → CRON_SECRET (`Authorization: Bearer …`),
//     que es lo único que manda Vercel Cron; sin él responde 401.
// El matcher tiene que ser un STRING LITERAL: Next lo parsea en compilación y una
// plantilla construida con variables rompe el build ("matcher[0] need to be static
// strings"). Así que la lista va inline. Rutas excluidas, en orden:
//
//   _next/static, _next/image, favicon.ico          → assets
//   api/health                                      → healthcheck público
//   api/integrations/slack/oauth/callback            → callback OAuth
//   api/integrations/samu/webhook                    → webhook de máquina
//   api/integrations/apollo/phone-reveal/webhook     → webhook de máquina (token)
//   api/cron/enrich                                  → job programado (CRON_SECRET)
//   api/cron/phone-reveal-recovery                   → job programado (CRON_SECRET)
//
// Cada exclusión termina en `(?:$|/)`, así que abre EXACTAMENTE ese endpoint (y sus
// subrutas) y no sus vecinos por prefijo: excluir `…/phone-reveal/webhook` no
// expone `…/phone-reveal/webhook-otro`, ni excluir `api/cron/phone-reveal-recovery`
// expone un cron nuevo de nombre parecido.
export const config = {
  matcher: [
    '/((?!_next/static(?:$|/)|_next/image(?:$|/)|favicon.ico(?:$|/)|api/health(?:$|/)|api/integrations/slack/oauth/callback(?:$|/)|api/integrations/samu/webhook(?:$|/)|api/integrations/apollo/phone-reveal/webhook(?:$|/)|api/cron/enrich(?:$|/)|api/cron/phone-reveal-recovery(?:$|/)|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
