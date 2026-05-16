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

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
