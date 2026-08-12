/**
 * Agente 2A — el RUNTIME de la aprobación atómica contra un driver simulado
 * (AGENT2A-PHONE-REVEAL-4O-H3).
 *
 * Lo que se mide aquí es lo que el módulo de persistencia HACE, no lo que dice: cuántas
 * llamadas emite, con qué parámetros, y qué ocurre cuando el servidor responde con un error o
 * con un sobre que no reconoce.
 *
 * La propiedad más importante es la de ABAJO del todo: si la RPC falla, el módulo LANZA y no
 * intenta nada más. Un fallback secuencial —insertar el contacto por PostgREST «ya que la
 * transacción no fue»— reintroduciría exactamente la ventana que este hito cierra, y un
 * reintento ciego no sabe si hubo COMMIT: en aprobación, un COMMIT invisible es un contacto
 * duplicado para una persona real.
 *
 * Sin red, sin Supabase, sin proveedores, 0 créditos. No toca Producción.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

const RPC_FN = 'approve_contact_candidate_with_phones';

type RpcCall = { fn: string; params: Record<string, unknown> };

/**
 * El doble del cliente admin se instala UNA sola vez (`mock.module` no admite remockear el
 * mismo especificador) y cada prueba sólo cambia la respuesta y limpia el registro.
 *
 * El Proxy falla ruidosamente ante CUALQUIER método que no sea `rpc`: si un día alguien
 * añadiera un `.from(...).insert(...)` de rescate, esta prueba lo vería en vez de dejarlo pasar.
 */
let response: { data?: unknown; error?: { message: string } } = {};
const calls: RpcCall[] = [];

mock.module('@/lib/supabase/admin', {
  namedExports: {
    createSupabaseAdminClient: () =>
      new Proxy(
        {
          rpc: async (fn: string, params: Record<string, unknown>) => {
            calls.push({ fn, params });
            return { data: response.data ?? null, error: response.error ?? null };
          },
        },
        {
          get(target, prop) {
            if (prop in target) return (target as Record<string | symbol, unknown>)[prop];
            throw new Error(
              `la persistencia de aprobación no puede usar el cliente admin para «${String(prop)}»`,
            );
          },
        },
      ),
  },
});

/**
 * Carga PEREZOSA del módulo bajo prueba. Un `await import()` de nivel superior no compila aquí:
 * tsx transpila `.ts` a CJS y el top-level await revienta el transform.
 */
let loaded: Promise<typeof import('../official-contact-approval-persistence')> | null = null;
const persistence = () => {
  loaded ??= import('../official-contact-approval-persistence');
  return loaded;
};

/** Fija la respuesta del servidor para la prueba en curso y limpia el registro. */
function given(next: { data?: unknown; error?: { message: string } }) {
  response = next;
  calls.length = 0;
}

const approve = async (request: Parameters<
  (typeof import('../official-contact-approval-persistence'))['approveContactCandidateWithPhones']
>[0]) => (await persistence()).approveContactCandidateWithPhones(request);

const REQUEST = {
  candidateId: 'cand-1',
  accountId: 'acc-1',
  contactPayload: { account_id: 'acc-1', full_name: 'Persona Sintetica' },
  reviewPatch: { status: 'approved' },
  scalarFallback: null,
  actorId: 'user-1',
  nowIso: '2026-08-12T12:00:00.000Z',
};

const OK_ENVELOPE = {
  status: 'approved',
  candidate_id: 'cand-1',
  contact_id: 'contact-1',
  contact_mode: 'created',
  contact_created: true,
  phones_seen: 2,
  phones_inserted: 2,
  phones_reused: 0,
  phones_skipped_suppressed: 0,
  sources_inserted: 3,
  sources_reused: 0,
  primary_dedupe_key: `e164:${'a'.repeat(64)}`,
  scalar_synced: true,
  scalar_fallback: 'absent',
  candidate_terminal: true,
};

describe('4O-H3 — la persistencia de aprobación emite UNA transacción y nada más', () => {
  it('hace exactamente UNA llamada, a la RPC de la migración 116', async () => {
    given({ data: OK_ENVELOPE });
    const out = await approve(REQUEST);

    assert.equal(calls.length, 1, 'una sola llamada al servidor');
    assert.equal(calls[0].fn, RPC_FN);
    assert.deepEqual(Object.keys(calls[0].params), [
      'p_candidate_id',
      'p_account_id',
      'p_contact_payload',
      'p_review_patch',
      'p_scalar_fallback',
      'p_actor_id',
      'p_now',
    ]);
    assert.equal(out.status, 'approved');
    assert.equal(out.contactId, 'contact-1');
    assert.equal(out.phonesInserted, 2);
    assert.equal(out.sourcesInserted, 3);
  });

  it('NO llama a ningún proveedor, ni reserva créditos, ni escribe usage logs', async () => {
    given({ data: OK_ENVELOPE });
    await approve(REQUEST);
    // El Proxy ya haría fallar cualquier uso del cliente distinto de `rpc`; aquí se fija además
    // que la ÚNICA función invocada es la de aprobación, y no una de gasto.
    assert.deepEqual(
      calls.map((c) => c.fn),
      [RPC_FN],
    );
  });

  it('LANZA si el servidor reporta un error, y no intenta ninguna escritura de rescate', async () => {
    given({
      error: { message: 'deadlock detected' },
    });
    await assert.rejects(
      () => approve(REQUEST),
      (err: Error) => err.message.includes('official contact approval failed'),
    );
    assert.equal(calls.length, 1, 'no reintenta ni cae a un camino secuencial');
  });

  it('recorta el mensaje del driver antes de propagarlo', async () => {
    // PostgreSQL cita valores de la query en sus errores, y uno de ellos puede ser un teléfono.
    given({ error: { message: 'x'.repeat(5000) } });
    await assert.rejects(
      () => approve(REQUEST),
      (err: Error) => err.message.length < 300,
    );
  });

  it('LANZA ante un sobre que no reconoce en vez de reportar éxito', async () => {
    given({ data: { status: 'probablemente_ok' } });
    await assert.rejects(() => approve(REQUEST), /unknown envelope status/);
  });

  it('propaga `already_approved` como resultado, no como fallo', async () => {
    given({
      data: { ...OK_ENVELOPE, status: 'already_approved', contact_created: false },
    });
    const out = await approve(REQUEST);
    assert.equal(out.status, 'already_approved');
    assert.equal(out.contactCreated, false);
  });

  it('propaga `person_suppressed` sin contacto', async () => {
    given({
      data: { status: 'person_suppressed', candidate_id: 'cand-1', contact_id: null },
    });
    const out = await approve(REQUEST);
    assert.equal(out.status, 'person_suppressed');
    assert.equal(out.contactId, null);
    assert.equal(out.contactCreated, false);
  });
});
