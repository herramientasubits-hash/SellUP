/**
 * Agente 2A — Apollo Phone Reveal: MONITOREO de supresiones no evaluables
 * (APOLLO-PHONE-CACHE-1b, FIX 5)
 *
 * FIX 4 dejó rastro de los casos en que la comprobación de tombstone NO se puede
 * evaluar (sin Apollo person id resoluble, o sin cuenta): un evento PII-free y el
 * mismo desenlace en `provider_usage_logs.metadata.suppression_state`. Pero ese
 * rastro solo se podía leer fila por fila, así que en la práctica nadie iba a
 * verlo. Estos tests cubren la agregación que lo hace visible.
 *
 * Sin red, sin DB, sin proveedor: el lector de filas se inyecta. Lo que se
 * verifica:
 *
 *   1. la agregación cuenta por ventana (24 h / 7 d), por fase (start / webhook /
 *      recovery) y por motivo, e IGNORA lo que no es `not_evaluable_*`;
 *   2. la salida es PII-free: ni teléfono, ni email, ni nombre, ni LinkedIn, ni
 *      person id, ni candidato/cuenta, ni metadata cruda;
 *   3. el estado vacío devuelve ceros y `last_seen_at = null`;
 *   4. no hay cambio de comportamiento: el monitoreo no está en el camino del
 *      reveal, no escribe, no llama a Apollo ni a Lusha, y no toca el flag;
 *   5. el criterio de alerta queda ejecutable (no un comentario suelto).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  PHONE_SUPPRESSION_NOT_EVALUABLE_STATES,
  type PhoneSuppressionNotEvaluableState,
} from '../phone-reveal-suppression-audit';
import {
  classifySuppressionCheckPhase,
  loadPhoneSuppressionNotEvaluableSummary,
  NOT_EVALUABLE_RECENT_WINDOW_HOURS,
  NOT_EVALUABLE_ROW_LIMIT,
  NOT_EVALUABLE_WINDOW_DAYS,
  phoneSuppressionMonitoringAlerts,
  summarizePhoneSuppressionNotEvaluable,
  type PhoneSuppressionNotEvaluableLogRow,
  type PhoneSuppressionNotEvaluableSummary,
} from '../phone-suppression-monitoring-core';

const HERE = dirname(fileURLToPath(import.meta.url));
// __tests__ → contact-enrichment → modules → src → repo root
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
function readRepo(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

/**
 * Fuente SIN comentarios. Los guards de abajo vigilan lo que el código HACE; la
 * cabecera de estos módulos nombra a propósito lo que NO hacen (`Date.now()`, el
 * flag de caché), y un guard que leyera la prosa se quejaría de su propia
 * documentación.
 */
function readCode(rel: string): string {
  return readRepo(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const MONITORING_CORE = 'src/modules/contact-enrichment/phone-suppression-monitoring-core.ts';
const MONITORING_QUERIES =
  'src/modules/contact-enrichment/phone-suppression-monitoring-queries.ts';
const MONITORING_CARD = 'src/app/(sellup)/ai-usage/phone-suppression-monitoring-card.tsx';

// ── Fixtures ───────────────────────────────────────────────────

const NOW_ISO = '2026-07-29T12:00:00.000Z';
const NOW_MS = new Date(NOW_ISO).getTime();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function isoAgo(millis: number): string {
  return new Date(NOW_MS - millis).toISOString();
}

function row(
  overrides: Partial<PhoneSuppressionNotEvaluableLogRow> = {},
): PhoneSuppressionNotEvaluableLogRow {
  return {
    created_at: isoAgo(HOUR),
    suppression_state: 'not_evaluable_missing_provider_person_id',
    reveal_phase: 'start',
    ...overrides,
  };
}

function summarize(
  rows: readonly PhoneSuppressionNotEvaluableLogRow[],
  rowLimit = NOT_EVALUABLE_ROW_LIMIT,
): PhoneSuppressionNotEvaluableSummary {
  return summarizePhoneSuppressionNotEvaluable({ rows, nowIso: NOW_ISO, rowLimit });
}

// ── 1. Vocabulario cerrado ─────────────────────────────────────

describe('FIX 5 — vocabulario de estados no evaluables', () => {
  it('la lista expone exactamente los dos motivos de v1', () => {
    assert.deepEqual([...PHONE_SUPPRESSION_NOT_EVALUABLE_STATES].sort(), [
      'not_evaluable_missing_account_id',
      'not_evaluable_missing_provider_person_id',
    ]);
  });

  it('todo estado de la lista empieza por not_evaluable_', () => {
    for (const state of PHONE_SUPPRESSION_NOT_EVALUABLE_STATES) {
      assert.match(state, /^not_evaluable_/);
    }
  });

  it('las ventanas son 24 h y 7 días', () => {
    assert.equal(NOT_EVALUABLE_RECENT_WINDOW_HOURS, 24);
    assert.equal(NOT_EVALUABLE_WINDOW_DAYS, 7);
  });
});

// ── 2. Clasificación de fase ───────────────────────────────────

describe('FIX 5 — clasificación de la fase', () => {
  it('reconoce start, webhook y las dos etiquetas del recovery', () => {
    assert.equal(classifySuppressionCheckPhase('start'), 'start');
    assert.equal(classifySuppressionCheckPhase('webhook'), 'webhook');
    // El usage-log del recovery escribe `recovery_poll`; el evento de FIX 4 usa
    // `recovery`. Ambos son la misma fase.
    assert.equal(classifySuppressionCheckPhase('recovery_poll'), 'recovery');
    assert.equal(classifySuppressionCheckPhase('recovery'), 'recovery');
  });

  it('no fuerza una fase para valores desconocidos o ausentes', () => {
    for (const value of ['cache_hit', 'otra', '', '   ', null, undefined]) {
      assert.equal(classifySuppressionCheckPhase(value), null, `fase ${String(value)}`);
    }
  });
});

// ── 3. Agregación por ventana ──────────────────────────────────

describe('FIX 5 — agregación por ventana temporal', () => {
  it('cuenta en 24 h y en 7 días según la antigüedad', () => {
    const summary = summarize([
      row({ created_at: isoAgo(1 * HOUR) }),
      row({ created_at: isoAgo(23 * HOUR) }),
      row({ created_at: isoAgo(25 * HOUR) }),
      row({ created_at: isoAgo(6 * DAY) }),
    ]);

    assert.equal(summary.total_24h, 2);
    assert.equal(summary.total_7d, 4);
  });

  it('incluye el borde exacto de 24 h en la ventana reciente', () => {
    const summary = summarize([row({ created_at: isoAgo(24 * HOUR) })]);
    assert.equal(summary.total_24h, 1);
    assert.equal(summary.total_7d, 1);
  });

  it('descarta lo anterior a la ventana de 7 días', () => {
    const summary = summarize([
      row({ created_at: isoAgo(8 * DAY) }),
      row({ created_at: isoAgo(30 * DAY) }),
    ]);
    assert.equal(summary.total_7d, 0);
    assert.equal(summary.last_seen_at, null);
  });

  it('descarta filas del futuro (desfase de reloj), no las cuenta como recientes', () => {
    const future = new Date(NOW_MS + HOUR).toISOString();
    const summary = summarize([row({ created_at: future })]);
    assert.equal(summary.total_24h, 0);
    assert.equal(summary.total_7d, 0);
  });

  it('descarta filas sin created_at interpretable en vez de inventar ventana', () => {
    const summary = summarize([
      row({ created_at: null }),
      row({ created_at: '' }),
      row({ created_at: 'no-es-una-fecha' }),
    ]);
    assert.equal(summary.total_7d, 0);
    assert.equal(summary.last_seen_at, null);
  });

  it('last_seen_at es el evento más reciente de la ventana, tal cual', () => {
    const recent = isoAgo(2 * HOUR);
    const summary = summarize([
      row({ created_at: isoAgo(5 * DAY) }),
      row({ created_at: recent }),
      row({ created_at: isoAgo(30 * HOUR) }),
    ]);
    assert.equal(summary.last_seen_at, recent);
  });
});

// ── 4. Desglose por fase y por motivo ──────────────────────────

describe('FIX 5 — desglose por fase y por motivo', () => {
  it('separa start / webhook / recovery', () => {
    const summary = summarize([
      row({ reveal_phase: 'start' }),
      row({ reveal_phase: 'start' }),
      row({ reveal_phase: 'webhook' }),
      row({ reveal_phase: 'recovery_poll' }),
      row({ reveal_phase: 'recovery' }),
    ]);

    assert.deepEqual(summary.by_phase_7d, { start: 2, webhook: 1, recovery: 2 });
    assert.equal(summary.total_7d, 5);
    assert.equal(summary.unclassified_phase_7d, 0);
  });

  it('una fase no reconocible se ve en unclassified, no se pierde del total', () => {
    const summary = summarize([
      row({ reveal_phase: 'start' }),
      row({ reveal_phase: 'cache_hit' }),
      row({ reveal_phase: null }),
    ]);

    assert.equal(summary.total_7d, 3);
    assert.deepEqual(summary.by_phase_7d, { start: 1, webhook: 0, recovery: 0 });
    assert.equal(summary.unclassified_phase_7d, 2);
    const phaseSum =
      summary.by_phase_7d.start +
      summary.by_phase_7d.webhook +
      summary.by_phase_7d.recovery +
      summary.unclassified_phase_7d;
    assert.equal(phaseSum, summary.total_7d);
  });

  it('separa missing_provider_person_id de missing_account_id', () => {
    const summary = summarize([
      row({ suppression_state: 'not_evaluable_missing_provider_person_id' }),
      row({ suppression_state: 'not_evaluable_missing_provider_person_id' }),
      row({ suppression_state: 'not_evaluable_missing_account_id' }),
    ]);

    assert.deepEqual(summary.by_state_7d, {
      not_evaluable_missing_provider_person_id: 2,
      not_evaluable_missing_account_id: 1,
    });
  });

  it('ignora los estados que NO son huecos de identificación', () => {
    const summary = summarize([
      row({ suppression_state: 'checked_not_suppressed' }),
      row({ suppression_state: 'blocked_suppressed' }),
      row({ suppression_state: 'check_unavailable' }),
      row({ suppression_state: null }),
      row({ suppression_state: 'not_evaluable_missing_account_id' }),
    ]);

    assert.equal(summary.total_7d, 1);
    assert.deepEqual(summary.by_state_7d, {
      not_evaluable_missing_provider_person_id: 0,
      not_evaluable_missing_account_id: 1,
    });
  });
});

// ── 5. Estado vacío ────────────────────────────────────────────

describe('FIX 5 — estado vacío', () => {
  it('sin filas devuelve ceros y last_seen_at null', () => {
    const summary = summarize([]);
    assert.deepEqual(summary, {
      total_24h: 0,
      total_7d: 0,
      by_phase_7d: { start: 0, webhook: 0, recovery: 0 },
      by_state_7d: {
        not_evaluable_missing_provider_person_id: 0,
        not_evaluable_missing_account_id: 0,
      },
      unclassified_phase_7d: 0,
      last_seen_at: null,
      read_truncated: false,
    });
  });

  it('un nowIso inválido no produce conteos inventados', () => {
    const summary = summarizePhoneSuppressionNotEvaluable({
      rows: [row(), row()],
      nowIso: 'no-es-una-fecha',
    });
    assert.equal(summary.total_7d, 0);
    assert.equal(summary.last_seen_at, null);
  });
});

// ── 6. Tope de lectura declarado ───────────────────────────────

describe('FIX 5 — truncamiento declarado', () => {
  it('marca read_truncated cuando la lectura llega al tope', () => {
    const rows = Array.from({ length: 3 }, () => row());
    assert.equal(summarize(rows, 3).read_truncated, true);
    assert.equal(summarize(rows, 4).read_truncated, false);
  });

  it('el tope por defecto es explícito y holgado', () => {
    assert.equal(NOT_EVALUABLE_ROW_LIMIT, 1000);
  });
});

// ── 7. Salida PII-free ─────────────────────────────────────────

/** Valores sentinela: si alguno aparece en la salida, hay fuga. */
const PII_SENTINELS = [
  '+573001112233',
  'contacto@empresa-ejemplo.test',
  'Nombre Apellido',
  'linkedin.com/in/nombre-apellido',
  '0123456789abcdef01234567', // Apollo person id
  'cand-monitoring-1',
  'acct-monitoring-1',
];

describe('FIX 5 — la salida no publica PII', () => {
  it('la forma es cerrada: solo conteos, una fecha y un booleano', () => {
    const summary = summarize([row()]);
    assert.deepEqual(Object.keys(summary).sort(), [
      'by_phase_7d',
      'by_state_7d',
      'last_seen_at',
      'read_truncated',
      'total_24h',
      'total_7d',
      'unclassified_phase_7d',
    ]);
    assert.deepEqual(Object.keys(summary.by_phase_7d).sort(), [
      'recovery',
      'start',
      'webhook',
    ]);
    assert.deepEqual(Object.keys(summary.by_state_7d).sort(), [
      'not_evaluable_missing_account_id',
      'not_evaluable_missing_provider_person_id',
    ]);
  });

  it('ignora cualquier campo extra que traiga la fila (no lo propaga)', () => {
    // Simula una fila "sucia": si el lector alguna vez trajera metadata de más,
    // el agregador no debe copiarla a la salida.
    const dirty = {
      ...row(),
      phone: '+573001112233',
      email: 'contacto@empresa-ejemplo.test',
      full_name: 'Nombre Apellido',
      linkedin_url: 'linkedin.com/in/nombre-apellido',
      provider_person_id: '0123456789abcdef01234567',
      candidate_id: 'cand-monitoring-1',
      account_id: 'acct-monitoring-1',
      metadata: { phone: '+573001112233' },
    } as unknown as PhoneSuppressionNotEvaluableLogRow;

    const serialized = JSON.stringify(summarize([dirty]));
    for (const sentinel of PII_SENTINELS) {
      assert.equal(
        serialized.includes(sentinel),
        false,
        `la salida no debe contener ${sentinel}`,
      );
    }
    // Se busca la clave ENTRE COMILLAS: los nombres de los motivos contienen
    // `provider_person_id` / `account_id` como parte de la ETIQUETA
    // (`not_evaluable_missing_account_id`), que es vocabulario de auditoría y no
    // un dato de la persona.
    for (const key of [
      'phone',
      'email',
      'full_name',
      'linkedin_url',
      'provider_person_id',
      'candidate_id',
      'account_id',
      'metadata',
    ]) {
      assert.equal(
        serialized.includes(`"${key}"`),
        false,
        `la salida no debe llevar la clave ${key}`,
      );
    }
  });

  it('no contiene ninguna secuencia con forma de teléfono', () => {
    const summary = summarize([row(), row({ reveal_phase: 'webhook' })]);
    // Un ISO-8601 nunca encadena 7 dígitos seguidos; un teléfono sí.
    assert.equal(/\d{7,}/.test(JSON.stringify(summary)), false);
  });
});

// ── 8. Lectura por inyección de dependencias ───────────────────

describe('FIX 5 — lectura autorizada y fail-loud', () => {
  it('sin autorización devuelve null y NO lee nada', async () => {
    let calls = 0;
    const summary = await loadPhoneSuppressionNotEvaluableSummary({
      nowIso: NOW_ISO,
      isAllowed: false,
      fetchRows: async () => {
        calls += 1;
        return [];
      },
    });

    assert.equal(summary, null);
    assert.equal(calls, 0);
  });

  it('pide exactamente la ventana de 7 días y la allowlist de estados', async () => {
    const seen: {
      sinceIso?: string;
      states?: readonly PhoneSuppressionNotEvaluableState[];
      rowLimit?: number;
    } = {};

    await loadPhoneSuppressionNotEvaluableSummary({
      nowIso: NOW_ISO,
      isAllowed: true,
      rowLimit: 250,
      fetchRows: async (args) => {
        seen.sinceIso = args.sinceIso;
        seen.states = args.states;
        seen.rowLimit = args.rowLimit;
        return [];
      },
    });

    assert.equal(seen.sinceIso, new Date(NOW_MS - 7 * DAY).toISOString());
    assert.deepEqual([...(seen.states ?? [])].sort(), [
      'not_evaluable_missing_account_id',
      'not_evaluable_missing_provider_person_id',
    ]);
    assert.equal(seen.rowLimit, 250);
  });

  it('agrega las filas devueltas por el lector', async () => {
    const summary = await loadPhoneSuppressionNotEvaluableSummary({
      nowIso: NOW_ISO,
      isAllowed: true,
      fetchRows: async () => [
        row({ reveal_phase: 'webhook', created_at: isoAgo(2 * HOUR) }),
        row({
          reveal_phase: 'recovery_poll',
          suppression_state: 'not_evaluable_missing_account_id',
          created_at: isoAgo(3 * DAY),
        }),
      ],
    });

    assert.ok(summary);
    assert.equal(summary.total_24h, 1);
    assert.equal(summary.total_7d, 2);
    assert.deepEqual(summary.by_phase_7d, { start: 0, webhook: 1, recovery: 1 });
  });

  it('un fallo de lectura se propaga: "no pude leer" NO se muestra como cero', async () => {
    await assert.rejects(
      () =>
        loadPhoneSuppressionNotEvaluableSummary({
          nowIso: NOW_ISO,
          isAllowed: true,
          fetchRows: async () => {
            throw new Error('relation "provider_usage_logs" does not exist');
          },
        }),
      /provider_usage_logs/,
    );
  });
});

// ── 9. Criterio de alerta (documentado y ejecutable) ───────────

describe('FIX 5 — criterio de alerta', () => {
  it('el estado esperado (cero eventos) no alerta', () => {
    assert.deepEqual([...phoneSuppressionMonitoringAlerts(summarize([]))], []);
  });

  it('cualquier evento en 24 h alerta', () => {
    const alerts = phoneSuppressionMonitoringAlerts(
      summarize([row({ created_at: isoAgo(HOUR) })]),
    );
    assert.ok(alerts.includes('not_evaluable_seen_last_24h'));
  });

  it('un caso EN VUELO (webhook o recovery) alerta aparte', () => {
    for (const phase of ['webhook', 'recovery_poll']) {
      const alerts = phoneSuppressionMonitoringAlerts(
        summarize([row({ reveal_phase: phase, created_at: isoAgo(3 * DAY) })]),
      );
      assert.ok(alerts.includes('not_evaluable_in_flight'), `fase ${phase}`);
    }
  });

  it('start sin person id alerta por el hueco posterior a la migración 098', () => {
    const alerts = phoneSuppressionMonitoringAlerts(
      summarize([
        row({
          reveal_phase: 'start',
          suppression_state: 'not_evaluable_missing_provider_person_id',
          created_at: isoAgo(3 * DAY),
        }),
      ]),
    );
    assert.ok(alerts.includes('missing_provider_person_id_after_migration_098'));
    assert.equal(alerts.includes('not_evaluable_in_flight'), false);
  });

  it('el truncamiento de la lectura alerta (el conteo es un mínimo)', () => {
    const alerts = phoneSuppressionMonitoringAlerts(summarize([row()], 1));
    assert.ok(alerts.includes('read_truncated'));
  });
});

// ── 10. Sin cambio de comportamiento (guards estáticos) ────────

describe('FIX 5 — el monitoreo no cambia el comportamiento', () => {
  const sources = [MONITORING_CORE, MONITORING_QUERIES, MONITORING_CARD].map(
    (rel) => [rel, readCode(rel)] as const,
  );

  it('ningún módulo de monitoreo escribe en Supabase', () => {
    for (const [rel, src] of sources) {
      for (const write of ['.insert(', '.update(', '.delete(', '.upsert(', '.rpc(']) {
        assert.equal(src.includes(write), false, `${rel} no debe usar ${write}`);
      }
    }
  });

  it('ningún módulo de monitoreo llama a un proveedor', () => {
    for (const [rel, src] of sources) {
      assert.equal(/\bfetch\s*\(/.test(src), false, `${rel} no debe llamar fetch`);
      const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
      for (const spec of imports) {
        assert.equal(/lusha/i.test(spec), false, `${rel} importa ${spec}`);
        assert.equal(
          /apollo-phone-reveal|integrations\/apollo/i.test(spec),
          false,
          `${rel} importa el cliente de Apollo: ${spec}`,
        );
      }
    }
  });

  it('el monitoreo NO está en el camino del reveal', () => {
    for (const rel of [
      'src/modules/contact-enrichment/phone-reveal-core.ts',
      'src/modules/contact-enrichment/phone-reveal-actions.ts',
      'src/modules/contact-enrichment/phone-reveal-webhook-core.ts',
      'src/modules/contact-enrichment/phone-reveal-recovery-core.ts',
      'src/modules/contact-enrichment/phone-reveal-recovery-actions.ts',
      'src/app/api/integrations/apollo/phone-reveal/webhook/route.ts',
    ]) {
      assert.equal(
        readRepo(rel).includes('phone-suppression-monitoring'),
        false,
        `${rel} no debe importar el monitoreo`,
      );
    }
  });

  it('el monitoreo no depende del flag de caché ni lo activa', () => {
    for (const [rel, src] of sources) {
      assert.equal(
        /ENABLE_APOLLO_PHONE_CACHE/.test(src),
        false,
        `${rel} no debe mirar el flag de caché`,
      );
    }
  });

  it('el core es puro: sin reloj propio, sin env, sin console', () => {
    const src = readCode(MONITORING_CORE);
    assert.equal(/Date\.now\(/.test(src), false);
    assert.equal(/process\.env/.test(src), false);
    assert.equal(/console\./.test(src), false);
  });

  it('la consulta y la tarjeta no imprimen nada', () => {
    for (const rel of [MONITORING_QUERIES, MONITORING_CARD]) {
      assert.equal(/console\./.test(readCode(rel)), false, `${rel} no debe loguear`);
    }
  });

  it('la consulta lee de provider_usage_logs con la allowlist de estados', () => {
    const src = readRepo(MONITORING_QUERIES);
    assert.match(src, /from\('provider_usage_logs'\)/);
    assert.match(src, /metadata->>suppression_state/);
    assert.match(src, /isCurrentUserAdmin/);
  });
});
