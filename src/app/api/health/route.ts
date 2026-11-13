import { NextResponse } from 'next/server';

// Sólo dice que la app responde. No revela qué variables de entorno existen.
export async function GET() {
  return NextResponse.json({ ok: true });
}
