import { NextResponse } from 'next/server';
import { bulkSearchControlSchema } from '@/modules/prospect-batches/bulk-search/bulk-search-schema';
import {
  controlBulkSearchForUser,
  resolveBulkSearchAccess,
} from '@/modules/prospect-batches/bulk-search/bulk-search-service.server';

/** Pausar, continuar o cancelar una búsqueda masiva propia. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await resolveBulkSearchAccess();
  if (!access.ok) return NextResponse.json({ ok: false, message: access.message }, { status: access.status });
  const parsed = bulkSearchControlSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, code: 'INVALID_REQUEST' }, { status: 400 });
  const { id } = await context.params;
  const result = await controlBulkSearchForUser(access.userId, id, parsed.data.action);
  const status = result.ok ? 200 : result.code === 'NOT_FOUND' ? 404 : 409;
  return NextResponse.json(result, { status, headers: { 'Cache-Control': 'no-store' } });
}
