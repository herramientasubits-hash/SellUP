# HubSpot Auto-Sync en Aprobación de Contacto — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Al aprobar un contacto en SellUp, crearlo e inyectarlo automáticamente en HubSpot —creando la empresa primero si no existe, con revisión humana cuando la coincidencia es dudosa—, sin flag ni botón, mandando los dos números de teléfono, y marcando "Creado por SellUp" en ambos objetos.

**Architecture:** Se reutilizan tal cual los dos motores ya probados en producción (`checkHubSpotCompanyCommercialStatus`/`createHubSpotCompany` para empresas, `runSyncContactToHubSpot` para contactos); no se construye una tercera implementación de ninguno de los dos. Se corrige primero una función compartida de detección de cambios que hoy colapsa dos campos de teléfono en uno (necesario para que el segundo número no quede invisible), luego se engancha la resolución de empresa delante del punto donde el auto-sync de contacto hoy se bloquea, se añade el flujo de revisión humana para el caso dudoso, y se retiran los dos flags que hoy mantienen todo esto apagado.

**Tech Stack:** Next.js server actions, Supabase (Postgres + `metadata` JSONB para estado durable, sin migraciones nuevas), HubSpot REST API v3 (`crm/v3/objects/*`, `crm/v3/properties/*`), Node `--test` para unit tests.

**Spec:** `docs/superpowers/specs/2026-08-27-hubspot-contact-approval-autosync-design.md`

**Corrección respecto al spec:** § 3 del spec decía "la creación de empresas para prospectos no tiene flag". Es inexacto — `attemptHubSpotSync` en `prospect-batches/actions.ts` sí lee `HUBSPOT_COMPANY_AUTO_CREATE_ENABLED`. No cambia ninguna decisión de este plan: el nuevo camino de este hito NO reutiliza `attemptHubSpotSync` (tiene reglas específicas de prospección, como la exigencia de NIT, que el spec ya excluye para contactos) — reutiliza sus piezas de más bajo nivel (`checkHubSpotCompanyCommercialStatus`, `createHubSpotCompany`) directamente, así que no hereda ese flag y el resultado sigue siendo "siempre activo, sin interruptor" tal como se acordó.

---

## Orden de ejecución

Los grupos están ordenados por dependencia. A y D no dependen de nada más y son útiles por sí solos. B/C forman el flujo de revisión de empresa. E conecta todo en el punto de aprobación. F es regresión final.

```
A. Corrección de dos campos de teléfono (base, corrige un bug latente)
D. Campo "Creado por SellUp" (independiente)
B. Resolución/creación de empresa + revisión humana (núcleo)
C. UI de revisión en la ficha de cuenta
E. Enganche en la aprobación + retiro de los dos flags
F. Regresión completa
```

---

## GRUPO A — Dos campos de teléfono, no uno

### Task A1: Corregir la detección de cambio para que compare el PAR, no un valor colapsado

**Por qué primero:** `resolveOutboundHubSpotPhone` colapsa `mobile_phone`/`phone` en un solo valor con prioridad (móvil gana). Si sólo se extiende el ENVÍO a dos campos sin tocar esto, un número nuevo en el campo que NO tiene prioridad (`phone`) nunca dispara un re-sync mientras el otro (`mobile_phone`) no cambie — el segundo número quedaría invisible para HubSpot indefinidamente. Se corrige aquí, antes de tocar nada que dependa de ella.

**Files:**
- Modify: `src/modules/contacts/contact-hubspot-sync-state.ts:392-397` (mantener `resolveOutboundHubSpotPhone` intacta — se sigue usando para clasificar `phone_changed` vs `phone_removed`), añadir función nueva cerca de ella.
- Modify: `src/modules/contacts/contact-hubspot-sync-state.ts:514-516` (el `if (before === after)` dentro de `markContactHubSpotSyncStaleForPhoneChange`).
- Test: `src/modules/contacts/__tests__/contact-hubspot-sync-state.test.ts` (si no existe un archivo con ese nombre exacto, créalo; si `markContactHubSpotSyncStaleForPhoneChange` ya tiene pruebas en otro archivo del listado de abajo, añade ahí en su lugar — comprueba primero con `grep -rln "markContactHubSpotSyncStaleForPhoneChange" src/modules/contacts/__tests__/`).

- [ ] **Step 1: Escribir la prueba que falla — cambio en el campo SIN prioridad debe marcar pendiente**

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  haveOutboundHubSpotPhonesChanged,
  markContactHubSpotSyncStaleForPhoneChange,
  readHubSpotSyncState,
} from '../contact-hubspot-sync-state';

describe('haveOutboundHubSpotPhonesChanged — compara el PAR, no un valor colapsado', () => {
  it('detecta un cambio en `phone` aunque `mobile_phone` no haya cambiado', () => {
    const previous = { phone: null, mobile_phone: '+57 300 000 0000' };
    const next = { phone: '+57 1 555 0000', mobile_phone: '+57 300 000 0000' };
    // ANTES de esta corrección, resolveOutboundHubSpotPhone(previous) === resolveOutboundHubSpotPhone(next)
    // porque el móvil (con prioridad) es idéntico en los dos — el número nuevo en `phone` sería invisible.
    assert.equal(haveOutboundHubSpotPhonesChanged(previous, next), true);
  });

  it('detecta un cambio en `mobile_phone` aunque `phone` no haya cambiado', () => {
    const previous = { phone: '+57 1 555 0000', mobile_phone: null };
    const next = { phone: '+57 1 555 0000', mobile_phone: '+57 300 000 0000' };
    assert.equal(haveOutboundHubSpotPhonesChanged(previous, next), true);
  });

  it('sin cambios en ninguno de los dos campos, no hay cambio', () => {
    const source = { phone: '+57 1 555 0000', mobile_phone: '+57 300 000 0000' };
    assert.equal(haveOutboundHubSpotPhonesChanged(source, { ...source }), false);
  });

  it('trata espacios en blanco y cadena vacía como ausencia, igual que antes', () => {
    const previous = { phone: '  ', mobile_phone: null };
    const next = { phone: '', mobile_phone: undefined };
    assert.equal(haveOutboundHubSpotPhonesChanged(previous, next), false);
  });
});

describe('markContactHubSpotSyncStaleForPhoneChange — con la comparación por par', () => {
  it('marca pendiente cuando sólo cambia el campo `phone` (antes era invisible)', () => {
    const metadata = {
      hubspot_sync: { status: 'synced', method: 'auto', hubspot_contact_id: 'hs-1' },
    };
    const decision = markContactHubSpotSyncStaleForPhoneChange({
      metadata,
      hubspotContactId: 'hs-1',
      previous: { phone: null, mobile_phone: '+57 300 000 0000' },
      next: { phone: '+57 1 555 0000', mobile_phone: '+57 300 000 0000' },
      nowIso: '2026-08-27T00:00:00.000Z',
      source: 'user_edit',
    });
    assert.equal(decision.marked, true);
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `node --import tsx --test src/modules/contacts/__tests__/contact-hubspot-sync-state.test.ts`
Expected: FAIL — `haveOutboundHubSpotPhonesChanged` no existe (`TypeError` o `is not a function`), y el segundo `describe` falla porque la marca no ocurre con la lógica actual (el valor colapsado no cambia).

- [ ] **Step 3: Implementar `haveOutboundHubSpotPhonesChanged` y usarla en la comparación**

En `src/modules/contacts/contact-hubspot-sync-state.ts`, justo después de `resolveOutboundHubSpotPhone` (línea 397):

```typescript
function normalizedOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * ¿Cambió CUALQUIERA de los dos campos salientes? A diferencia de `resolveOutboundHubSpotPhone`
 * —que colapsa los dos en uno con prioridad para decidir QUÉ enviar cuando sólo hay un campo de
 * destino—, esta comparación mira los DOS de forma independiente. Es la que decide SI hay que
 * re-sincronizar, y colapsar aquí escondería un cambio en el campo sin prioridad mientras el
 * otro no se mueva — exactamente el defecto que motivó esta función.
 */
export function haveOutboundHubSpotPhonesChanged(
  previous: HubSpotPhoneSource,
  next: HubSpotPhoneSource,
): boolean {
  return (
    normalizedOrNull(previous.phone) !== normalizedOrNull(next.phone) ||
    normalizedOrNull(previous.mobile_phone) !== normalizedOrNull(next.mobile_phone)
  );
}
```

Después, en `markContactHubSpotSyncStaleForPhoneChange` (línea 514-516), reemplazar:

```typescript
  const before = resolveOutboundHubSpotPhone(args.previous);
  const after = resolveOutboundHubSpotPhone(args.next);
  if (before === after) return { marked: false, reason: 'no_outbound_change' };
```

por:

```typescript
  if (!haveOutboundHubSpotPhonesChanged(args.previous, args.next)) {
    return { marked: false, reason: 'no_outbound_change' };
  }
  const after = resolveOutboundHubSpotPhone(args.next);
```

(`after` se conserva porque las líneas siguientes de la función, sin cambios, la usan para `resolveHubSpotStaleReasonForOutbound(after)`.)

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `node --import tsx --test src/modules/contacts/__tests__/contact-hubspot-sync-state.test.ts`
Expected: PASS, todos los casos.

- [ ] **Step 5: Regresión de los llamadores existentes de `markContactHubSpotSyncStaleForPhoneChange`**

Run: `npm run test:agent2:hubspot-stale-completeness-cut3a && npm run test:agent2a:contacts-phone-privacy-erasure && npm run test:agent2a:mobile-phone-provenance-erasure`
Expected: PASS — estos dos llamadores (`contacts/actions.ts`, `phone-cache-suppression-core.ts`) ya pasan structs completos con los dos campos; no deberían verse afectados por el cambio de comparación interna.

- [ ] **Step 6: Commit**

```bash
git add src/modules/contacts/contact-hubspot-sync-state.ts src/modules/contacts/__tests__/contact-hubspot-sync-state.test.ts
git commit -m "fix(agent2a): compare both outbound phone fields, not a collapsed single value"
```

---

### Task A2: Extender los tipos y los HTTP calls para llevar `mobilephone`

**Files:**
- Modify: `src/modules/contacts/contact-hubspot-sync-core.ts:80-83` (interfaces `HubSpotContactCreateInput`/`HubSpotContactUpdateInput` — usa `grep -n "interface HubSpotContactCreateInput\|interface HubSpotContactUpdateInput"` para confirmar el rango exacto antes de editar, puede haber cambiado de línea tras Task A1).
- Modify: `src/server/integrations/hubspot-contact-sync.ts:283-360` (`createHubSpotContact`, `updateHubSpotContact`).
- Test: `src/modules/contacts/__tests__/contact-hubspot-sync-core.test.ts`

- [ ] **Step 1: Escribir la prueba que falla**

```typescript
test('HubSpotContactCreateInput y HubSpotContactUpdateInput aceptan mobilePhone', () => {
  const createInput: import('../contact-hubspot-sync-core').HubSpotContactCreateInput = {
    email: 'a@b.com',
    firstname: 'Ana',
    lastname: 'Pérez',
    jobtitle: null,
    phone: '+57 1 555 0000',
    mobilePhone: '+57 300 000 0000',
  };
  const updateInput: import('../contact-hubspot-sync-core').HubSpotContactUpdateInput = {
    phone: '+57 1 555 0000',
    mobilePhone: '+57 300 000 0000',
  };
  assert.equal(createInput.mobilePhone, '+57 300 000 0000');
  assert.equal(updateInput.mobilePhone, '+57 300 000 0000');
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npx tsc --noEmit`
Expected: FAIL — `Object literal may only specify known properties, and 'mobilePhone' does not exist in type 'HubSpotContactCreateInput'`.

- [ ] **Step 3: Implementar — extender las dos interfaces**

En `contact-hubspot-sync-core.ts`:

```typescript
export interface HubSpotContactCreateInput {
  email: string;
  firstname: string | null;
  lastname: string | null;
  jobtitle: string | null;
  phone: string | null;
  mobilePhone: string | null;
}
```

```typescript
export interface HubSpotContactUpdateInput {
  phone: string | null;
  mobilePhone: string | null;
}
```

- [ ] **Step 4: Extender `buildHubSpotContactUpdateProperties` (contrato del PATCH)**

```typescript
export function buildHubSpotContactUpdateProperties(
  input: HubSpotContactUpdateInput,
): { phone: string; mobilephone: string } {
  return { phone: input.phone ?? '', mobilephone: input.mobilePhone ?? '' };
}
```

- [ ] **Step 5: Extender `createHubSpotContact` en `hubspot-contact-sync.ts`**

Reemplazar:

```typescript
  if (input.phone) properties.phone = input.phone;
```

por:

```typescript
  if (input.phone) properties.phone = input.phone;
  if (input.mobilePhone) properties.mobilephone = input.mobilePhone;
```

- [ ] **Step 6: `updateHubSpotContact` ya usa `buildHubSpotContactUpdateProperties` — no requiere cambio propio.** Confirmar leyendo `hubspot-contact-sync.ts:332-365` que el `body` del PATCH sigue siendo `JSON.stringify({ properties: buildHubSpotContactUpdateProperties(input) })` (sin cambios de código, sólo verificación).

- [ ] **Step 7: Ejecutar y verificar que pasa**

Run: `npx tsc --noEmit && node --import tsx --test src/modules/contacts/__tests__/contact-hubspot-sync-core.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/modules/contacts/contact-hubspot-sync-core.ts src/server/integrations/hubspot-contact-sync.ts src/modules/contacts/__tests__/contact-hubspot-sync-core.test.ts
git commit -m "feat(agent2a): extend HubSpot contact create/update payloads with mobilephone"
```

---

### Task A3: `buildHubSpotContactProperties` manda los DOS campos, ya no prioriza uno

**Files:**
- Modify: `src/modules/contacts/contact-hubspot-sync-core.ts:198-212` (`buildHubSpotContactProperties`).
- Modify (test existente, corregir premisa obsoleta): `src/modules/contacts/__tests__/contact-hubspot-sync-core.test.ts:135-143`.

- [ ] **Step 1: Corregir la prueba existente que documenta el comportamiento VIEJO**

Reemplazar el test `'buildHubSpotContactProperties omite LinkedIn y prioriza mobile_phone'`:

```typescript
test('buildHubSpotContactProperties omite LinkedIn y manda los DOS teléfonos', () => {
  const props = buildHubSpotContactProperties(makeContact(), 'ana@empresa.com');
  assert.equal(props.email, 'ana@empresa.com');
  assert.equal(props.jobtitle, 'Gerente de RRHH');
  // makeContact(): phone='+57 1 555 0000', mobile_phone='+57 300 555 0000' — los DOS viajan,
  // cada uno a su propio campo. Antes se colapsaban en uno solo con prioridad al móvil.
  assert.equal(props.phone, '+57 1 555 0000');
  assert.equal(props.mobilePhone, '+57 300 555 0000');
  assert.ok(!('linkedin_url' in props));
  assert.ok(!('hs_linkedin_url' in props));
});

test('buildHubSpotContactProperties manda solo el que exista cuando falta uno', () => {
  const propsNoMobile = buildHubSpotContactProperties(
    makeContact({ mobile_phone: null }),
    'ana@empresa.com',
  );
  assert.equal(propsNoMobile.phone, '+57 1 555 0000');
  assert.equal(propsNoMobile.mobilePhone, null);

  const propsNoPhone = buildHubSpotContactProperties(
    makeContact({ phone: null }),
    'ana@empresa.com',
  );
  assert.equal(propsNoPhone.phone, null);
  assert.equal(propsNoPhone.mobilePhone, '+57 300 555 0000');
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `node --import tsx --test src/modules/contacts/__tests__/contact-hubspot-sync-core.test.ts`
Expected: FAIL — `props.mobilePhone` es `undefined`, y `props.phone` sigue siendo el valor colapsado (móvil) en vez del propio.

- [ ] **Step 3: Implementar**

```typescript
export function buildHubSpotContactProperties(
  contact: ContactForSync,
  email: string,
): HubSpotContactCreateInput {
  const { firstname, lastname } = splitContactName(contact);
  const phone = typeof contact.phone === 'string' && contact.phone.trim().length > 0
    ? contact.phone.trim()
    : null;
  const mobilePhone =
    typeof contact.mobile_phone === 'string' && contact.mobile_phone.trim().length > 0
      ? contact.mobile_phone.trim()
      : null;
  return {
    email,
    firstname,
    lastname,
    jobtitle: cleanString(contact.job_title),
    phone,
    mobilePhone,
  };
}
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `node --import tsx --test src/modules/contacts/__tests__/contact-hubspot-sync-core.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/contacts/contact-hubspot-sync-core.ts src/modules/contacts/__tests__/contact-hubspot-sync-core.test.ts
git commit -m "feat(agent2a): send both phone scalars to HubSpot on contact creation, no priority collapse"
```

---

### Task A4: La rama PATCH de `runSyncContactToHubSpot` también manda los dos campos

**Files:**
- Modify: `src/modules/contacts/contact-hubspot-sync-core.ts` (la rama de actualización dentro de `runSyncContactToHubSpot`, hoy alrededor de la línea 517 — confirma con `grep -n "outboundPhone" src/modules/contacts/contact-hubspot-sync-core.ts`).
- Test: `src/modules/contacts/__tests__/contact-hubspot-sync-update-cut2.test.ts` (archivo ya existente que cubre esta rama).

- [ ] **Step 1: Leer el test existente para el patrón de espía usado en esta rama**

Run: `grep -n "updateHubSpotContact\|phone:" src/modules/contacts/__tests__/contact-hubspot-sync-update-cut2.test.ts | head -20`

Usa el mismo patrón de espía (`spyUpdate`/similar) que ya exista ahí para escribir la aserción del Step 2 — no inventes un arnés nuevo.

- [ ] **Step 2: Añadir la aserción que falla**

Añade, en el test que ejercita el PATCH sobre un contacto ya vinculado con cambio pendiente (busca el `it`/`test` que arma un contacto con `hubspot_contact_id` no nulo y un teléfono distinto al último sincronizado), la comprobación de que la llamada a `updateHubSpotContact` recibió AMBOS campos:

```typescript
// Tras el `await runSyncContactToHubSpot(...)` ya existente en este test:
assert.equal(updateCalls[0].input.mobilePhone, contact.mobile_phone);
```

(Ajusta `updateCalls[0].input` al nombre real del espía capturado en el test — confírmalo leyendo el archivo antes de escribir la línea.)

- [ ] **Step 3: Ejecutar y verificar que falla**

Run: `npm run test:agent2:hubspot-sync-update-cut2`
Expected: FAIL — `updateCalls[0].input.mobilePhone` es `undefined`.

- [ ] **Step 4: Implementar — mandar el par en la rama PATCH**

Localiza (con `grep -n "const outboundPhone = resolveOutboundHubSpotPhone(contact);" src/modules/contacts/contact-hubspot-sync-core.ts`) el bloque:

```typescript
      const outboundPhone = resolveOutboundHubSpotPhone(contact);

      const updateResult = await deps.updateHubSpotContact(hubspotContactId, {
        phone: outboundPhone,
      });
```

Reemplázalo por:

```typescript
      const outboundPhone = resolveOutboundHubSpotPhone(contact);
      const outboundMobilePhone =
        typeof contact.mobile_phone === 'string' && contact.mobile_phone.trim().length > 0
          ? contact.mobile_phone.trim()
          : null;

      const updateResult = await deps.updateHubSpotContact(hubspotContactId, {
        phone: outboundPhone,
        mobilePhone: outboundMobilePhone,
      });
```

(`outboundPhone` se conserva TAL CUAL —sigue siendo el valor con prioridad, usado más abajo por `resolveHubSpotStaleReasonForOutbound`/lógica de reason— y se añade `outboundMobilePhone` como lectura directa del campo, sin colapsar.)

- [ ] **Step 5: Ejecutar y verificar que pasa**

Run: `npm run test:agent2:hubspot-sync-update-cut2`
Expected: PASS.

- [ ] **Step 6: Regresión del grupo completo A**

Run: `npm run test:agent2:hubspot-sync-core && npm run test:agent2:hubspot-sync-update-cut2 && npm run test:agent2:hubspot-stale-completeness-cut3a && npm run test:agent2:hubspot-autosync-cut3b && npm run test:agent2:hubspot-auto-phone-update-cut3c && npm run test:agent2:hubspot-legacy-sync-backfill`
Expected: PASS en las seis.

- [ ] **Step 7: Commit**

```bash
git add src/modules/contacts/contact-hubspot-sync-core.ts src/modules/contacts/__tests__/contact-hubspot-sync-update-cut2.test.ts
git commit -m "fix(agent2a): PATCH branch sends mobilephone alongside phone, not instead of it"
```

---

## GRUPO D — Campo "Creado por SellUp"

### Task D1: Función pura — verificar/crear la propiedad checkbox, idempotente

**Files:**
- Create: `src/server/integrations/hubspot-property-ensure.ts`
- Test: `src/server/integrations/__tests__/hubspot-property-ensure.test.ts`

- [ ] **Step 1: Escribir la prueba que falla**

```typescript
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ensureHubSpotSellUpCreatedProperty } from '../hubspot-property-ensure';

describe('ensureHubSpotSellUpCreatedProperty — idempotente, fail-closed', () => {
  it('si la propiedad YA existe (GET 200), no llama a POST', async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      return { ok: true, status: 200, json: async () => ({ name: 'sellup_created' }) } as Response;
    };
    const result = await ensureHubSpotSellUpCreatedProperty('contacts', {
      token: 'tok',
      fetchImpl,
    });
    assert.equal(result.ok, true);
    assert.equal(result.created, false);
    assert.deepEqual(calls, ['GET https://api.hubapi.com/crm/v3/properties/contacts/sellup_created']);
  });

  it('si NO existe (GET 404), la crea con POST', async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if ((init?.method ?? 'GET') === 'GET') {
        return { ok: false, status: 404, json: async () => ({}) } as Response;
      }
      return { ok: true, status: 201, json: async () => ({ name: 'sellup_created' }) } as Response;
    };
    const result = await ensureHubSpotSellUpCreatedProperty('companies', {
      token: 'tok',
      fetchImpl,
    });
    assert.equal(result.ok, true);
    assert.equal(result.created, true);
    assert.deepEqual(calls, [
      'GET https://api.hubapi.com/crm/v3/properties/companies/sellup_created',
      'POST https://api.hubapi.com/crm/v3/properties/companies',
    ]);
  });

  it('sin permiso de esquema (POST 403), no lanza y reporta el motivo', async () => {
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') {
        return { ok: false, status: 404, json: async () => ({}) } as Response;
      }
      return { ok: false, status: 403, json: async () => ({ message: 'missing scope' }) } as Response;
    };
    const result = await ensureHubSpotSellUpCreatedProperty('contacts', { token: 'tok', fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'HUBSPOT_PROPERTY_CREATE_HTTP_403');
  });

  it('sin token, falla cerrado sin llamar a fetch', async () => {
    let called = false;
    const fetchImpl = async () => {
      called = true;
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    };
    const result = await ensureHubSpotSellUpCreatedProperty('contacts', {
      token: null,
      fetchImpl,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'TOKEN_UNAVAILABLE');
    assert.equal(called, false);
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `node --import tsx --test src/server/integrations/__tests__/hubspot-property-ensure.test.ts`
Expected: FAIL — el módulo `../hubspot-property-ensure` no existe.

- [ ] **Step 3: Implementar**

```typescript
// Agente 2A — Verificación/creación idempotente de una propiedad custom en HubSpot
// (AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC)
//
// Primera vez que este código base MODIFICA EL ESQUEMA de un objeto en HubSpot, en vez de sólo
// llenar campos existentes. Es una operación distinta y más sensible: crea algo que queda
// visible para todo el que use HubSpot en la organización, y no se revierte solo.
//
// Por eso: se comprueba SIEMPRE antes de crear (GET), se crea como MUCHO una vez (POST sólo si
// el GET dice 404), y un permiso insuficiente para crear ESQUEMA —distinto del permiso para
// escribir VALORES, que es el que ya usa el resto de la integración— nunca lanza ni bloquea
// nada: se reporta y el llamador sigue sin el campo.

const HUBSPOT_BASE = 'https://api.hubapi.com';

export const SELLUP_CREATED_PROPERTY_NAME = 'sellup_created' as const;

export type HubSpotSchemaObjectType = 'contacts' | 'companies';

export type EnsureHubSpotPropertyResult =
  | { ok: true; created: boolean }
  | { ok: false; reason: string };

export interface EnsureHubSpotPropertyDeps {
  token: string | null;
  /** Inyectado para poder probar sin red. En producción: `fetch` global. */
  fetchImpl: typeof fetch;
}

/**
 * Verifica si `sellup_created` existe en el objeto dado y la crea si falta. Nunca lanza.
 *
 * `created: false` con `ok: true` significa "ya existía, no hizo falta tocar nada" — el caso
 * normal a partir del segundo contacto/empresa que se sincroniza.
 */
export async function ensureHubSpotSellUpCreatedProperty(
  objectType: HubSpotSchemaObjectType,
  deps: EnsureHubSpotPropertyDeps,
): Promise<EnsureHubSpotPropertyResult> {
  if (!deps.token) return { ok: false, reason: 'TOKEN_UNAVAILABLE' };

  try {
    const getResponse = await deps.fetchImpl(
      `${HUBSPOT_BASE}/crm/v3/properties/${objectType}/${SELLUP_CREATED_PROPERTY_NAME}`,
      { headers: { Authorization: `Bearer ${deps.token}` } },
    );
    if (getResponse.ok) return { ok: true, created: false };
    if (getResponse.status !== 404) {
      return { ok: false, reason: `HUBSPOT_PROPERTY_GET_HTTP_${getResponse.status}` };
    }

    const createResponse = await deps.fetchImpl(
      `${HUBSPOT_BASE}/crm/v3/properties/${objectType}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${deps.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: SELLUP_CREATED_PROPERTY_NAME,
          label: 'Creado por SellUp',
          type: 'bool',
          fieldType: 'booleancheckbox',
          groupName: objectType === 'contacts' ? 'contactinformation' : 'companyinformation',
          options: [
            { label: 'Sí', value: 'true', displayOrder: 0 },
            { label: 'No', value: 'false', displayOrder: 1 },
          ],
        }),
      },
    );
    if (!createResponse.ok) {
      return { ok: false, reason: `HUBSPOT_PROPERTY_CREATE_HTTP_${createResponse.status}` };
    }
    return { ok: true, created: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message.slice(0, 120) : 'HUBSPOT_PROPERTY_ENSURE_ERROR',
    };
  }
}
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `node --import tsx --test src/server/integrations/__tests__/hubspot-property-ensure.test.ts`
Expected: PASS, las cuatro pruebas.

- [ ] **Step 5: Commit**

```bash
git add src/server/integrations/hubspot-property-ensure.ts src/server/integrations/__tests__/hubspot-property-ensure.test.ts
git commit -m "feat(agent2a): idempotent HubSpot custom-property creation, fail-closed on missing schema scope"
```

---

### Task D2: Cablear el token real y marcar `sellup_created: true` al crear contacto/empresa

**Files:**
- Modify: `src/server/integrations/hubspot-contact-sync.ts` (dentro de `createHubSpotContact`).
- Modify: `src/server/integrations/hubspot-company-create.ts` (dentro de `createHubSpotCompany`).
- Test: `src/modules/contacts/__tests__/contact-hubspot-sync-core.test.ts` (o el archivo de integración de `hubspot-contact-sync.ts` si existe uno separado — confirma con `grep -rln "createHubSpotContact" src/server/integrations/__tests__/` antes de elegir dónde).

- [ ] **Step 1: Escribir la prueba que falla, para `createHubSpotContact`**

Si existe `src/server/integrations/__tests__/hubspot-contact-sync.test.ts`, añade ahí; si no, créalo:

```typescript
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

describe('createHubSpotContact — incluye sellup_created', () => {
  it('el payload de creación lleva sellup_created: "true"', async () => {
    // Este test requiere mockear fetch global y el vault de Supabase. Sigue el patrón de
    // arnés ya usado en `src/server/integrations/__tests__/` para esta misma función (revisa
    // con `grep -rln "createHubSpotContact" src/server/integrations/__tests__/` el archivo
    // hermano más cercano y copia su forma de stubear `getHubSpotToken`/`fetch` antes de escribir
    // esta prueba — no inventes un segundo patrón de mocking para el mismo módulo).
  });
});
```

**Nota para quien ejecute esta tarea:** si no existe NINGÚN test existente para `createHubSpotContact`/`createHubSpotCompany` en `src/server/integrations/__tests__/`, escribe el arnés completo mockeando `fetch` global (`global.fetch = mock.fn(...)`) y el RPC de vault (`createClient` de `@supabase/supabase-js` vía `mock.module`), replicando el patrón que SÍ existe para `hubspot-property-ensure.test.ts` (Task D1) pero con inyección de dependencias en vez de mockear módulos globales si el archivo permite refactorizar la firma — si no, usa `node --experimental-test-module-mocks` como hacen los tests de `post-approval-reveal-durable-resume-ui.test.tsx` de este mismo repo.

- [ ] **Step 2: Ejecutar y verificar que falla**

Run el comando de test que hayas elegido en el Step 1.
Expected: FAIL — el payload capturado no incluye `sellup_created`.

- [ ] **Step 3: Implementar en `createHubSpotContact`**

En `src/server/integrations/hubspot-contact-sync.ts`, dentro de `createHubSpotContact`, ANTES de construir `properties`, añade la llamada a `ensureHubSpotSellUpCreatedProperty` (best-effort, nunca bloquea):

```typescript
import { ensureHubSpotSellUpCreatedProperty } from './hubspot-property-ensure';

// dentro de createHubSpotContact, después de resolver `token`:
  const propertyEnsure = await ensureHubSpotSellUpCreatedProperty('contacts', {
    token,
    fetchImpl: fetch,
  });

  const properties: Record<string, string> = { email: input.email };
  if (input.firstname) properties.firstname = input.firstname;
  if (input.lastname) properties.lastname = input.lastname;
  if (input.jobtitle) properties.jobtitle = input.jobtitle;
  if (input.phone) properties.phone = input.phone;
  if (input.mobilePhone) properties.mobilephone = input.mobilePhone;
  // Sólo se manda el campo si la verificación/creación tuvo éxito: sin permiso de esquema, el
  // contacto se crea igual, simplemente sin esta marca.
  if (propertyEnsure.ok) properties.sellup_created = 'true';
```

- [ ] **Step 4: Implementar en `createHubSpotCompany`, mismo patrón**

En `src/server/integrations/hubspot-company-create.ts`, dentro de `createHubSpotCompany`, tras resolver `token` y antes de construir el cuerpo de propiedades:

```typescript
import { ensureHubSpotSellUpCreatedProperty } from './hubspot-property-ensure';

  const propertyEnsure = await ensureHubSpotSellUpCreatedProperty('companies', {
    token,
    fetchImpl: fetch,
  });
```

Y donde se arma el objeto de propiedades a enviar (busca `const properties` o el objeto que se pasa al `fetch` de creación), añade condicionalmente:

```typescript
  if (propertyEnsure.ok) properties.sellup_created = 'true';
```

(Ajusta el nombre exacto de la variable de propiedades leyendo el cuerpo real de la función — el spec confirmó que usa `SAFE_STANDARD_PROPERTIES` como allowlist para otros campos; `sellup_created` es NUEVO y no pasa por esa allowlist porque no es un campo existente que haya que resolver por nombre, es el que este hito acaba de crear.)

- [ ] **Step 5: Ejecutar y verificar que pasa**

Run el comando de test elegido en Step 1, más:
Run: `npm run test:agent2:hubspot-sync-core`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/integrations/hubspot-contact-sync.ts src/server/integrations/hubspot-company-create.ts
git commit -m "feat(agent2a): stamp sellup_created on newly created HubSpot contacts and companies"
```

---

## GRUPO B — Resolución de empresa + revisión humana

### Task B1: Núcleo puro — clasificar qué hacer con la empresa

**Files:**
- Create: `src/modules/accounts/hubspot-company-resolution-core.ts`
- Test: `src/modules/accounts/__tests__/hubspot-company-resolution-core.test.ts`

- [ ] **Step 1: Escribir la prueba que falla**

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyHubSpotCompanyResolution } from '../hubspot-company-resolution-core';

describe('classifyHubSpotCompanyResolution — tres desenlaces, sin la exigencia de NIT de prospección', () => {
  it('no_match → crear', () => {
    const result = classifyHubSpotCompanyResolution({ hubspotMatchStatus: 'no_match' });
    assert.equal(result.action, 'create');
  });

  it('coincidencia confiable con cliente → bloquear en silencio, igual que prospectos', () => {
    const result = classifyHubSpotCompanyResolution({
      hubspotMatchStatus: 'exact_match_customer',
    });
    assert.equal(result.action, 'block_silent');
  });

  for (const status of [
    'exact_match_ex_customer',
    'exact_match_prospect_active',
    'exact_match_prospect_recyclable',
  ] as const) {
    it(`${status} → bloquear en silencio`, () => {
      assert.equal(
        classifyHubSpotCompanyResolution({ hubspotMatchStatus: status }).action,
        'block_silent',
      );
    });
  }

  it('possible_match_requires_review → pausar para revisión humana', () => {
    const result = classifyHubSpotCompanyResolution({
      hubspotMatchStatus: 'possible_match_requires_review',
    });
    assert.equal(result.action, 'pending_review');
  });

  it('not_attempted (sin conexión) → bloquear en silencio, nunca crear a ciegas', () => {
    assert.equal(
      classifyHubSpotCompanyResolution({ hubspotMatchStatus: 'not_attempted' }).action,
      'block_silent',
    );
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `node --import tsx --test src/modules/accounts/__tests__/hubspot-company-resolution-core.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar**

Antes de escribir, confirma el vocabulario exacto de `HubspotMatchStatus` (importado por `hubspot-commercial-checker.ts` desde `structured-candidate-types.ts`):

Run: `grep -n "export type HubspotMatchStatus" -A 15 src/server/agents/prospecting-toolkit/structured-candidate-types.ts`

```typescript
// Agente 2A — Qué hacer con la empresa de una cuenta, dado el resultado de la búsqueda en
// HubSpot (AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC)
//
// Núcleo PURO: no llama a HubSpot, no llama a Supabase. Recibe el veredicto YA calculado por
// `checkHubSpotCompanyCommercialStatus` (que sigue siendo la única autoridad sobre CÓMO se
// decide una coincidencia) y sólo traduce ESE veredicto a una acción para el flujo de
// aprobación de contacto — que es una pregunta distinta de la que resuelve el checker.
//
// Deliberadamente NO reutiliza `attemptHubSpotSync` (prospect-batches/actions.ts): esa función
// tiene reglas propias de prospección masiva (NIT obligatorio en Colombia, guardas de
// liquidación) que no aplican a una cuenta que YA es cliente activo de SellUp con un contacto
// recién aprobado.

import type { HubspotMatchStatus } from '@/server/agents/prospecting-toolkit/structured-candidate-types';

export type HubSpotCompanyResolutionAction = 'create' | 'block_silent' | 'pending_review';

export interface HubSpotCompanyResolutionResult {
  action: HubSpotCompanyResolutionAction;
}

/**
 * `possible_match_requires_review` es el ÚNICO estado que pausa a esperar una decisión humana.
 * Todo lo demás que no sea `no_match` se bloquea en silencio, exactamente igual que hoy en el
 * flujo de prospectos — este hito no amplía esa parte.
 */
export function classifyHubSpotCompanyResolution(input: {
  hubspotMatchStatus: HubspotMatchStatus;
}): HubSpotCompanyResolutionResult {
  if (input.hubspotMatchStatus === 'no_match') return { action: 'create' };
  if (input.hubspotMatchStatus === 'possible_match_requires_review') {
    return { action: 'pending_review' };
  }
  return { action: 'block_silent' };
}
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `node --import tsx --test src/modules/accounts/__tests__/hubspot-company-resolution-core.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/accounts/hubspot-company-resolution-core.ts src/modules/accounts/__tests__/hubspot-company-resolution-core.test.ts
git commit -m "feat(agent2a): pure classifier for what to do with an account's HubSpot company match"
```

---

### Task B2: Estado durable — escribir `pending_match_review` / `synced` en `accounts.metadata`

**Files:**
- Create: `src/modules/accounts/hubspot-company-resolution-state.ts`
- Test: `src/modules/accounts/__tests__/hubspot-company-resolution-state.test.ts`

- [ ] **Step 1: Escribir la prueba que falla**

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPendingMatchReviewMetadata,
  buildResolvedCompanyMetadata,
  readPendingHubSpotMatch,
} from '../hubspot-company-resolution-state';

describe('buildPendingMatchReviewMetadata', () => {
  it('escribe el bloque pending_match_review preservando el resto de metadata', () => {
    const result = buildPendingMatchReviewMetadata({
      existing: { keep: 'this' },
      match: {
        hubspotCompanyId: '12345',
        name: 'Autotransportes El Bisonte SA',
        domain: 'bisonte.com.mx',
        matchMethod: 'name',
        confidence: 65,
        reason: 'Match por nombre con confianza baja (65%)',
      },
      nowIso: '2026-08-27T21:30:00.000Z',
    });
    assert.equal(result.keep, 'this');
    assert.equal(result.hubspot_sync_status, 'pending_match_review');
    const pending = readPendingHubSpotMatch(result);
    assert.ok(pending);
    assert.equal(pending?.hubspotCompanyId, '12345');
    assert.equal(pending?.confidence, 65);
  });
});

describe('buildResolvedCompanyMetadata', () => {
  it('limpia hubspot_pending_match y marca synced', () => {
    const withPending = buildPendingMatchReviewMetadata({
      existing: {},
      match: {
        hubspotCompanyId: '12345',
        name: 'X',
        domain: null,
        matchMethod: 'name',
        confidence: 65,
        reason: 'r',
      },
      nowIso: '2026-08-27T21:30:00.000Z',
    });
    const resolved = buildResolvedCompanyMetadata({
      existing: withPending,
      nowIso: '2026-08-27T21:35:00.000Z',
    });
    assert.equal(resolved.hubspot_sync_status, 'synced');
    assert.equal(readPendingHubSpotMatch(resolved), null);
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `node --import tsx --test src/modules/accounts/__tests__/hubspot-company-resolution-state.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

```typescript
// Agente 2A — Estado durable de la revisión de coincidencia de empresa
// (AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC)
//
// Misma convención de auditoría en `metadata` que ya usa `attemptHubSpotSync`
// (`hubspot_sync_status`, etc.) en `prospect-batches/actions.ts`. No se crea ninguna tabla ni
// columna nueva.

export interface PendingHubSpotCompanyMatch {
  hubspotCompanyId: string;
  name: string | null;
  domain: string | null;
  matchMethod: string;
  confidence: number;
  reason: string;
  detectedAt: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Lee el bloque `hubspot_pending_match`, si existe y tiene forma válida. `null` si no. */
export function readPendingHubSpotMatch(
  metadata: Record<string, unknown> | null | undefined,
): PendingHubSpotCompanyMatch | null {
  const raw = asRecord(metadata).hubspot_pending_match;
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const hubspotCompanyId = typeof row.hubspot_company_id === 'string' ? row.hubspot_company_id : null;
  if (!hubspotCompanyId) return null;
  return {
    hubspotCompanyId,
    name: typeof row.name === 'string' ? row.name : null,
    domain: typeof row.domain === 'string' ? row.domain : null,
    matchMethod: typeof row.match_method === 'string' ? row.match_method : 'unknown',
    confidence: typeof row.confidence === 'number' ? row.confidence : 0,
    reason: typeof row.reason === 'string' ? row.reason : '',
    detectedAt: typeof row.detected_at === 'string' ? row.detected_at : '',
  };
}

export function buildPendingMatchReviewMetadata(args: {
  existing: Record<string, unknown> | null | undefined;
  match: {
    hubspotCompanyId: string;
    name: string | null;
    domain: string | null;
    matchMethod: string;
    confidence: number;
    reason: string;
  };
  nowIso: string;
}): Record<string, unknown> {
  return {
    ...asRecord(args.existing),
    hubspot_sync_status: 'pending_match_review',
    hubspot_pending_match: {
      hubspot_company_id: args.match.hubspotCompanyId,
      name: args.match.name,
      domain: args.match.domain,
      match_method: args.match.matchMethod,
      confidence: args.match.confidence,
      reason: args.match.reason,
      detected_at: args.nowIso,
    },
  };
}

/** Tras resolver (cualquiera de las dos respuestas): limpia el pendiente, marca `synced`. */
export function buildResolvedCompanyMetadata(args: {
  existing: Record<string, unknown> | null | undefined;
  nowIso: string;
}): Record<string, unknown> {
  const { hubspot_pending_match: _drop, ...rest } = asRecord(args.existing);
  return {
    ...rest,
    hubspot_sync_status: 'synced',
    hubspot_synced_at: args.nowIso,
  };
}
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `node --import tsx --test src/modules/accounts/__tests__/hubspot-company-resolution-state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/accounts/hubspot-company-resolution-state.ts src/modules/accounts/__tests__/hubspot-company-resolution-state.test.ts
git commit -m "feat(agent2a): durable metadata state for pending HubSpot company match review"
```

---

### Task B3: Orquestación — resolver la empresa de una cuenta (con deps inyectadas)

**Files:**
- Create: `src/modules/accounts/hubspot-company-resolution-runtime.ts`
- Test: `src/modules/accounts/__tests__/hubspot-company-resolution-runtime.test.ts`

- [ ] **Step 1: Escribir la prueba que falla**

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAccountHubSpotCompany } from '../hubspot-company-resolution-runtime';
import type { HubSpotCompanyResolutionDeps } from '../hubspot-company-resolution-runtime';

const ACCOUNT_ID = 'account-1';

function harness(
  over: {
    hubspotCompanyId?: string | null;
    matchStatus?: string;
    createOk?: boolean;
  } = {},
): { deps: HubSpotCompanyResolutionDeps; createCalls: unknown[]; updateCalls: unknown[] } {
  const createCalls: unknown[] = [];
  const updateCalls: unknown[] = [];
  const deps: HubSpotCompanyResolutionDeps = {
    loadAccount: async () => ({
      id: ACCOUNT_ID,
      name: 'Empresa S.A.',
      domain: 'empresa.com',
      country: 'México',
      countryCode: 'MX',
      city: null,
      region: null,
      taxIdentifier: null,
      legalName: null,
      companySize: null,
      hubspotCompanyId: over.hubspotCompanyId ?? null,
      metadata: {},
    }),
    checkCompanyMatch: async () => ({
      hubspotMatchStatus: (over.matchStatus ?? 'no_match') as never,
      match: over.matchStatus === 'possible_match_requires_review'
        ? {
            hubspotCompanyId: 'hs-999',
            name: 'Empresa parecida SA',
            domain: null,
            matchMethod: 'name',
            confidence: 65,
            reason: 'Match por nombre con confianza baja (65%)',
          }
        : null,
    }),
    createCompany: async (input) => {
      createCalls.push(input);
      return over.createOk === false
        ? { ok: false, error: 'HUBSPOT_CREATE_ERROR' }
        : { ok: true, hubspotCompanyId: 'hs-new-1' };
    },
    updateAccount: async (accountId, patch) => {
      updateCalls.push({ accountId, patch });
    },
    nowIso: '2026-08-27T21:30:00.000Z',
  };
  return { deps, createCalls, updateCalls };
}

describe('resolveAccountHubSpotCompany', () => {
  it('ya tiene hubspot_company_id: no busca ni crea nada', async () => {
    const { deps, createCalls } = harness({ hubspotCompanyId: 'hs-existing' });
    const result = await resolveAccountHubSpotCompany(ACCOUNT_ID, deps);
    assert.equal(result.status, 'ready');
    assert.equal(result.hubspotCompanyId, 'hs-existing');
    assert.equal(createCalls.length, 0);
  });

  it('no_match: crea la empresa y actualiza la cuenta', async () => {
    const { deps, createCalls, updateCalls } = harness({ matchStatus: 'no_match' });
    const result = await resolveAccountHubSpotCompany(ACCOUNT_ID, deps);
    assert.equal(result.status, 'ready');
    assert.equal(result.hubspotCompanyId, 'hs-new-1');
    assert.equal(createCalls.length, 1);
    assert.equal(updateCalls.length, 1);
  });

  it('coincidencia confiable (cliente existente): bloquea, NO crea', async () => {
    const { deps, createCalls } = harness({ matchStatus: 'exact_match_customer' });
    const result = await resolveAccountHubSpotCompany(ACCOUNT_ID, deps);
    assert.equal(result.status, 'blocked');
    assert.equal(createCalls.length, 0);
  });

  it('coincidencia dudosa: pausa y escribe el pendiente, NO crea', async () => {
    const { deps, createCalls, updateCalls } = harness({
      matchStatus: 'possible_match_requires_review',
    });
    const result = await resolveAccountHubSpotCompany(ACCOUNT_ID, deps);
    assert.equal(result.status, 'pending_review');
    assert.equal(createCalls.length, 0);
    assert.equal(updateCalls.length, 1);
    const patch = (updateCalls[0] as { patch: Record<string, unknown> }).patch;
    assert.equal(patch.metadata && (patch.metadata as Record<string, unknown>).hubspot_sync_status, 'pending_match_review');
  });

  it('la creación falla: reporta fallo, no lanza', async () => {
    const { deps } = harness({ matchStatus: 'no_match', createOk: false });
    const result = await resolveAccountHubSpotCompany(ACCOUNT_ID, deps);
    assert.equal(result.status, 'failed');
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `node --import tsx --test src/modules/accounts/__tests__/hubspot-company-resolution-runtime.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

```typescript
// Agente 2A — Orquestación: resolver la empresa HubSpot de una cuenta
// (AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC)
//
// Sin red propia: todo lo que toca HubSpot o Supabase entra por `deps`. Delega la DECISIÓN en
// `classifyHubSpotCompanyResolution` (núcleo puro) y el ESTADO durable en
// `buildPendingMatchReviewMetadata`/`buildResolvedCompanyMetadata`. No busca por su cuenta: usa
// `deps.checkCompanyMatch`, que en producción ES `checkHubSpotCompanyCommercialStatus` sin
// cambios — la MISMA función que ya usa el flujo de prospectos.

import { classifyHubSpotCompanyResolution } from './hubspot-company-resolution-core';
import { buildPendingMatchReviewMetadata } from './hubspot-company-resolution-state';
import type { HubspotMatchStatus } from '@/server/agents/prospecting-toolkit/structured-candidate-types';

export interface AccountForHubSpotResolution {
  id: string;
  name: string;
  domain: string | null;
  country: string | null;
  countryCode: string | null;
  city: string | null;
  region: string | null;
  taxIdentifier: string | null;
  legalName: string | null;
  companySize: string | null;
  hubspotCompanyId: string | null;
  metadata: Record<string, unknown> | null;
}

export interface HubSpotCompanyMatchCheck {
  hubspotMatchStatus: HubspotMatchStatus;
  match: {
    hubspotCompanyId: string;
    name: string | null;
    domain: string | null;
    matchMethod: string;
    confidence: number;
    reason: string;
  } | null;
}

export interface HubSpotCompanyResolutionDeps {
  loadAccount: (accountId: string) => Promise<AccountForHubSpotResolution | null>;
  checkCompanyMatch: (account: AccountForHubSpotResolution) => Promise<HubSpotCompanyMatchCheck>;
  createCompany: (
    account: AccountForHubSpotResolution,
  ) => Promise<{ ok: true; hubspotCompanyId: string } | { ok: false; error: string }>;
  updateAccount: (
    accountId: string,
    patch: { hubspot_company_id?: string; metadata: Record<string, unknown> },
  ) => Promise<void>;
  nowIso: string;
}

export type HubSpotCompanyResolutionOutcome =
  | { status: 'ready'; hubspotCompanyId: string }
  | { status: 'blocked' }
  | { status: 'pending_review' }
  | { status: 'failed' }
  | { status: 'account_unavailable' };

export async function resolveAccountHubSpotCompany(
  accountId: string,
  deps: HubSpotCompanyResolutionDeps,
): Promise<HubSpotCompanyResolutionOutcome> {
  const account = await deps.loadAccount(accountId);
  if (!account) return { status: 'account_unavailable' };

  if (account.hubspotCompanyId) {
    return { status: 'ready', hubspotCompanyId: account.hubspotCompanyId };
  }

  const check = await deps.checkCompanyMatch(account);
  const classification = classifyHubSpotCompanyResolution({
    hubspotMatchStatus: check.hubspotMatchStatus,
  });

  if (classification.action === 'block_silent') return { status: 'blocked' };

  if (classification.action === 'pending_review') {
    if (!check.match) return { status: 'blocked' };
    await deps.updateAccount(accountId, {
      metadata: buildPendingMatchReviewMetadata({
        existing: account.metadata,
        match: check.match,
        nowIso: deps.nowIso,
      }),
    });
    return { status: 'pending_review' };
  }

  // classification.action === 'create'
  const createResult = await deps.createCompany(account);
  if (!createResult.ok) return { status: 'failed' };

  await deps.updateAccount(accountId, {
    hubspot_company_id: createResult.hubspotCompanyId,
    metadata: {
      ...(account.metadata ?? {}),
      hubspot_sync_status: 'synced',
      hubspot_synced_at: deps.nowIso,
      hubspot_sync_source: 'contact_approval',
    },
  });
  return { status: 'ready', hubspotCompanyId: createResult.hubspotCompanyId };
}
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `node --import tsx --test src/modules/accounts/__tests__/hubspot-company-resolution-runtime.test.ts`
Expected: PASS, las cinco pruebas.

- [ ] **Step 5: Commit**

```bash
git add src/modules/accounts/hubspot-company-resolution-runtime.ts src/modules/accounts/__tests__/hubspot-company-resolution-runtime.test.ts
git commit -m "feat(agent2a): orchestrate account HubSpot company resolution with injected deps"
```

---

### Task B4: Cableado real — `checkCompanyMatch`/`createCompany`/`loadAccount`/`updateAccount`

**Files:**
- Create: `src/modules/accounts/hubspot-company-resolution-wiring.ts`
- Test: cubierto por regresión de integración en Task E1 (este archivo es cableado puro, sin lógica propia que testear en aislamiento más allá de lo que ya cubre Task B3 con deps falsas).

- [ ] **Step 1: Implementar directamente (sin TDD aislado — es cableado, la lógica ya está probada en B1-B3)**

```typescript
// Agente 2A — Cableado REAL de `resolveAccountHubSpotCompany`
// (AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC)
//
// Construye las dependencias sobre Supabase (service role — ver nota de admin client abajo) y
// sobre los DOS motores de HubSpot que ya existen y no se tocan:
// `checkHubSpotCompanyCommercialStatus` y `createHubSpotCompany`.

import { createClient as createAdminClient } from '@supabase/supabase-js';
import { checkHubSpotCompanyCommercialStatus } from '@/server/agents/prospecting-toolkit/hubspot-commercial-checker';
import { createHubSpotCompany } from '@/server/integrations/hubspot-company-create';
import {
  resolveAccountHubSpotCompany,
  type AccountForHubSpotResolution,
  type HubSpotCompanyResolutionDeps,
  type HubSpotCompanyResolutionOutcome,
} from './hubspot-company-resolution-runtime';

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

const ACCOUNT_SELECT =
  'id, name, domain, country, country_code, city, region, tax_identifier, legal_name, company_size, hubspot_company_id, metadata';

function buildDeps(nowIso: string): HubSpotCompanyResolutionDeps {
  const admin = getAdminClient();
  return {
    loadAccount: async (accountId): Promise<AccountForHubSpotResolution | null> => {
      const { data, error } = await admin
        .from('accounts')
        .select(ACCOUNT_SELECT)
        .eq('id', accountId)
        .maybeSingle();
      if (error || !data) return null;
      const row = data as Record<string, unknown>;
      return {
        id: row.id as string,
        name: row.name as string,
        domain: (row.domain as string | null) ?? null,
        country: (row.country as string | null) ?? null,
        countryCode: (row.country_code as string | null) ?? null,
        city: (row.city as string | null) ?? null,
        region: (row.region as string | null) ?? null,
        taxIdentifier: (row.tax_identifier as string | null) ?? null,
        legalName: (row.legal_name as string | null) ?? null,
        companySize: (row.company_size as string | null) ?? null,
        hubspotCompanyId: (row.hubspot_company_id as string | null) ?? null,
        metadata: (row.metadata as Record<string, unknown> | null) ?? {},
      };
    },
    checkCompanyMatch: async (account) =>
      checkHubSpotCompanyCommercialStatus({
        name: account.name,
        domain: account.domain,
        taxId: account.taxIdentifier,
        countryCode: account.countryCode,
      }),
    createCompany: async (account) => {
      const result = await createHubSpotCompany({
        name: account.name,
        country: account.country,
        countryCode: account.countryCode,
        taxIdentifier: account.taxIdentifier,
        domain: account.domain,
        city: account.city,
        region: account.region,
        legalName: account.legalName,
        numberOfEmployees: account.companySize,
      });
      return result.ok && result.hubspotCompanyId
        ? { ok: true, hubspotCompanyId: result.hubspotCompanyId }
        : { ok: false, error: 'error' in result ? String(result.error) : 'HUBSPOT_CREATE_FAILED' };
    },
    updateAccount: async (accountId, patch) => {
      await admin.from('accounts').update(patch).eq('id', accountId);
    },
    nowIso,
  };
}

/** Entrypoint real, invocado desde la aprobación de contacto (Task E1). */
export async function resolveAccountHubSpotCompanyWired(
  accountId: string,
  nowIso: string,
): Promise<HubSpotCompanyResolutionOutcome> {
  return resolveAccountHubSpotCompany(accountId, buildDeps(nowIso));
}
```

**Antes de dar esto por terminado:** confirma con `grep -n "export.*createHubSpotCompany\b" -A5 src/server/integrations/hubspot-company-create.ts | grep -i "interface.*Result\|hubspotCompanyId\|success"` la forma EXACTA del `CreateHubSpotCompanyResult` (el spec asume `ok`/`hubspotCompanyId`/`error`, pero el snippet ya leído durante el research usaba `success`/`error` — ajusta el mapeo de `createCompany` en el bloque de arriba a los nombres reales antes de continuar).

- [ ] **Step 2: `npx tsc --noEmit` debe pasar limpio**

Run: `npx tsc --noEmit`
Expected: sin errores en los archivos nuevos de este task.

- [ ] **Step 3: Commit**

```bash
git add src/modules/accounts/hubspot-company-resolution-wiring.ts
git commit -m "feat(agent2a): wire account HubSpot company resolution to real Supabase and HubSpot clients"
```

---

### Task B5: Server action para resolver la revisión humana (Sí / No)

**Files:**
- Create: `src/modules/accounts/hubspot-company-review-actions.ts` (`'use server'`)
- Test: `src/modules/accounts/__tests__/hubspot-company-review-actions-core.test.ts` (núcleo puro primero, sin `'use server'`)

- [ ] **Step 1: Escribir la prueba que falla, sobre el núcleo puro**

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runResolveHubSpotCompanyMatch } from '../hubspot-company-resolution-review-core';

describe('runResolveHubSpotCompanyMatch', () => {
  it('decisión "same": vincula el hubspot_company_id pendiente, no crea nada', async () => {
    const updateCalls: unknown[] = [];
    const createCalls: unknown[] = [];
    const result = await runResolveHubSpotCompanyMatch(
      { accountId: 'account-1', decision: 'same' },
      {
        loadAccount: async () => ({
          id: 'account-1',
          metadata: {
            hubspot_pending_match: { hubspot_company_id: 'hs-999', name: 'X' },
          },
        }),
        updateAccount: async (id, patch) => {
          updateCalls.push({ id, patch });
        },
        createCompany: async () => {
          createCalls.push(true);
          return { ok: true, hubspotCompanyId: 'hs-new' };
        },
        nowIso: '2026-08-27T22:00:00.000Z',
      },
    );
    assert.equal(result.ok, true);
    assert.equal(createCalls.length, 0);
    assert.equal(updateCalls.length, 1);
    const patch = (updateCalls[0] as { patch: Record<string, unknown> }).patch;
    assert.equal(patch.hubspot_company_id, 'hs-999');
  });

  it('decisión "different": crea empresa nueva, ignora el pendiente', async () => {
    const createCalls: unknown[] = [];
    const result = await runResolveHubSpotCompanyMatch(
      { accountId: 'account-1', decision: 'different' },
      {
        loadAccount: async () => ({
          id: 'account-1',
          metadata: { hubspot_pending_match: { hubspot_company_id: 'hs-999', name: 'X' } },
        }),
        updateAccount: async () => {},
        createCompany: async () => {
          createCalls.push(true);
          return { ok: true, hubspotCompanyId: 'hs-brand-new' };
        },
        nowIso: '2026-08-27T22:00:00.000Z',
      },
    );
    assert.equal(result.ok, true);
    assert.equal(createCalls.length, 1);
  });

  it('sin cuenta pendiente, no hace nada y reporta el motivo', async () => {
    const result = await runResolveHubSpotCompanyMatch(
      { accountId: 'account-1', decision: 'same' },
      {
        loadAccount: async () => null,
        updateAccount: async () => {},
        createCompany: async () => ({ ok: true, hubspotCompanyId: 'x' }),
        nowIso: '2026-08-27T22:00:00.000Z',
      },
    );
    assert.equal(result.ok, false);
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `node --import tsx --test src/modules/accounts/__tests__/hubspot-company-resolution-review-core.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar el núcleo**

Crea `src/modules/accounts/hubspot-company-resolution-review-core.ts`:

```typescript
import { readPendingHubSpotMatch } from './hubspot-company-resolution-state';

export interface ResolveHubSpotCompanyMatchDeps {
  loadAccount: (
    accountId: string,
  ) => Promise<{ id: string; metadata: Record<string, unknown> | null } | null>;
  updateAccount: (
    accountId: string,
    patch: { hubspot_company_id: string; metadata: Record<string, unknown> },
  ) => Promise<void>;
  createCompany: (
    accountId: string,
  ) => Promise<{ ok: true; hubspotCompanyId: string } | { ok: false; error: string }>;
  nowIso: string;
}

export type ResolveHubSpotCompanyMatchDecision = 'same' | 'different';

export interface ResolveHubSpotCompanyMatchResult {
  ok: boolean;
  hubspotCompanyId: string | null;
}

export async function runResolveHubSpotCompanyMatch(
  input: { accountId: string; decision: ResolveHubSpotCompanyMatchDecision },
  deps: ResolveHubSpotCompanyMatchDeps,
): Promise<ResolveHubSpotCompanyMatchResult> {
  const account = await deps.loadAccount(input.accountId);
  if (!account) return { ok: false, hubspotCompanyId: null };

  const pending = readPendingHubSpotMatch(account.metadata);
  if (!pending) return { ok: false, hubspotCompanyId: null };

  let hubspotCompanyId: string;
  if (input.decision === 'same') {
    hubspotCompanyId = pending.hubspotCompanyId;
  } else {
    const created = await deps.createCompany(input.accountId);
    if (!created.ok) return { ok: false, hubspotCompanyId: null };
    hubspotCompanyId = created.hubspotCompanyId;
  }

  const { hubspot_pending_match: _drop, ...rest } = account.metadata ?? {};
  await deps.updateAccount(input.accountId, {
    hubspot_company_id: hubspotCompanyId,
    metadata: {
      ...rest,
      hubspot_sync_status: 'synced',
      hubspot_synced_at: deps.nowIso,
      hubspot_sync_source: 'contact_approval_review',
    },
  });
  return { ok: true, hubspotCompanyId };
}
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `node --import tsx --test src/modules/accounts/__tests__/hubspot-company-resolution-review-core.test.ts`
Expected: PASS.

- [ ] **Step 5: Server action (`'use server'`), sin lógica propia — sólo cablea el core**

Crea `src/modules/accounts/hubspot-company-review-actions.ts`:

```typescript
'use server';

import { createClient as createAdminClient } from '@supabase/supabase-js';
import { requireActiveUserForEnrichment } from '@/modules/contact-enrichment/auth-helpers';
import { runResolveHubSpotCompanyMatch } from './hubspot-company-resolution-review-core';
import { resolveAccountHubSpotCompanyWired } from './hubspot-company-resolution-wiring';
// NOTA: confirma el import real de `requireActiveUserForEnrichment` — puede vivir en otro
// módulo de autorización de cuentas; búscalo con
// `grep -rln "requireActive" src/modules/accounts/` antes de asumir la ruta de arriba.

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

export async function resolveHubSpotCompanyMatchAction(input: {
  accountId: string;
  decision: 'same' | 'different';
}): Promise<{ ok: boolean }> {
  const { internalUserId } = await requireActiveUserForEnrichment();
  const admin = getAdminClient();
  const nowIso = new Date().toISOString();

  const result = await runResolveHubSpotCompanyMatch(input, {
    loadAccount: async (accountId) => {
      const { data } = await admin
        .from('accounts')
        .select('id, metadata')
        .eq('id', accountId)
        .maybeSingle();
      return data
        ? { id: data.id as string, metadata: (data.metadata as Record<string, unknown>) ?? {} }
        : null;
    },
    updateAccount: async (accountId, patch) => {
      await admin.from('accounts').update(patch).eq('id', accountId);
    },
    createCompany: async (accountId) => {
      const outcome = await resolveAccountHubSpotCompanyWired(accountId, nowIso);
      return outcome.status === 'ready'
        ? { ok: true, hubspotCompanyId: outcome.hubspotCompanyId }
        : { ok: false, error: outcome.status };
    },
    nowIso,
  });

  return { ok: result.ok };
}
```

**Cuidado P342 (ver `src/__tests__/use-server-type-reexport-runtime-p342.test.ts` de este mismo repo):** este archivo NO debe reexportar ningún tipo importado con `export type { X }` sin especificador — si necesitas exponer un tipo, usa `export type { X } from './y'` (con especificador) o decláralo en un módulo sin `'use server'`.

- [ ] **Step 6: Ejecutar el ratchet P342 sobre el archivo nuevo**

Run: `npm run test:agent2a:p342-contacts-runtime` (si el build está fresco) o al menos `node --import tsx --test src/__tests__/use-server-type-reexport-runtime-p342.test.ts` para la Capa A (AST, no requiere build).
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/accounts/hubspot-company-resolution-review-core.ts src/modules/accounts/__tests__/hubspot-company-resolution-review-core.test.ts src/modules/accounts/hubspot-company-review-actions.ts
git commit -m "feat(agent2a): server action to resolve a pending HubSpot company match (same/different)"
```

---

### Task B6: Barrido de contactos en espera tras resolver

**Files:**
- Modify: `src/modules/accounts/hubspot-company-resolution-review-core.ts` (añadir el paso de barrido) — o crear un módulo separado si prefieres mantener B5 enfocado; se documenta como extensión de B5 para no repetir la carga de cuenta.
- Test: `src/modules/accounts/__tests__/hubspot-company-resolution-review-core.test.ts` (añadir casos).

- [ ] **Step 1: Escribir la prueba que falla**

Añade al `describe` existente de Task B5:

```typescript
it('tras resolver, dispara el sync de los contactos en espera de esa cuenta', async () => {
  const syncedContactIds: string[] = [];
  const result = await runResolveHubSpotCompanyMatch(
    { accountId: 'account-1', decision: 'same' },
    {
      loadAccount: async () => ({
        id: 'account-1',
        metadata: { hubspot_pending_match: { hubspot_company_id: 'hs-999', name: 'X' } },
      }),
      updateAccount: async () => {},
      createCompany: async () => ({ ok: true, hubspotCompanyId: 'hs-new' }),
      nowIso: '2026-08-27T22:00:00.000Z',
      loadWaitingContacts: async (accountId) => {
        assert.equal(accountId, 'account-1');
        return ['contact-1', 'contact-2'];
      },
      syncContact: async (contactId) => {
        syncedContactIds.push(contactId);
      },
    },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(syncedContactIds, ['contact-1', 'contact-2']);
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `node --import tsx --test src/modules/accounts/__tests__/hubspot-company-resolution-review-core.test.ts`
Expected: FAIL — `loadWaitingContacts`/`syncContact` no existen en `ResolveHubSpotCompanyMatchDeps`, TS error o comportamiento no ejercido.

- [ ] **Step 3: Implementar — extender deps y el final de la función**

En `hubspot-company-resolution-review-core.ts`, extiende la interfaz:

```typescript
export interface ResolveHubSpotCompanyMatchDeps {
  loadAccount: (
    accountId: string,
  ) => Promise<{ id: string; metadata: Record<string, unknown> | null } | null>;
  updateAccount: (
    accountId: string,
    patch: { hubspot_company_id: string; metadata: Record<string, unknown> },
  ) => Promise<void>;
  createCompany: (
    accountId: string,
  ) => Promise<{ ok: true; hubspotCompanyId: string } | { ok: false; error: string }>;
  nowIso: string;
  /** Contactos `approved` de la cuenta cuyo sync a HubSpot esperaba esta resolución. */
  loadWaitingContacts: (accountId: string) => Promise<string[]>;
  /** Dispara el sync YA existente (Task E1) para un contacto — no reimplementa nada. */
  syncContact: (contactId: string) => Promise<void>;
}
```

Y al final de `runResolveHubSpotCompanyMatch`, después de escribir la cuenta como `synced`:

```typescript
  const waitingContactIds = await deps.loadWaitingContacts(input.accountId);
  for (const contactId of waitingContactIds) {
    // Secuencial y no en paralelo: cada sync es una llamada real a HubSpot, y el orden no
    // importa pero saturar la API sí. Un fallo individual NO detiene el resto — cada llamada
    // ya es best-effort por sí misma (Task E1 nunca lanza).
    await deps.syncContact(contactId);
  }

  return { ok: true, hubspotCompanyId };
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `node --import tsx --test src/modules/accounts/__tests__/hubspot-company-resolution-review-core.test.ts`
Expected: PASS.

**Nota:** los OTROS tests de este archivo (Task B5) también necesitan que su `deps` incluya `loadWaitingContacts`/`syncContact` ahora que son obligatorios en la interfaz — añade `loadWaitingContacts: async () => []` y `syncContact: async () => {}` a los harnesses de los tests "same"/"different"/"sin cuenta pendiente" para que sigan compilando.

- [ ] **Step 5: Actualizar la server action (Task B5) para cablear las dos deps nuevas**

En `hubspot-company-review-actions.ts`, añade a `runResolveHubSpotCompanyMatch(...)`:

```typescript
    loadWaitingContacts: async (accountId) => {
      const { data } = await admin
        .from('contacts')
        .select('id, metadata')
        .eq('account_id', accountId)
        .is('archived_at', null);
      return (data ?? [])
        .filter((row) => {
          const meta = (row.metadata as Record<string, unknown> | null) ?? {};
          return meta.hubspot_sync_status === 'waiting_company_review';
        })
        .map((row) => row.id as string);
    },
    syncContact: async (contactId) => {
      // Llama al MISMO punto de entrada que la aprobación (Task E1) — se define ahí y se
      // importa aquí; ver Task E1 para `triggerContactHubSpotSync`. Se atribuye a QUIEN
      // resolvió la revisión: es un UUID real de `internal_users`, nunca un valor de relleno
      // (viaja hasta `contact_audit.actor_user_id`, que tiene FK a esa tabla).
      const { triggerContactHubSpotSync } = await import(
        '@/modules/contact-enrichment/hubspot-contact-approval-sync'
      );
      await triggerContactHubSpotSync(contactId, internalUserId);
    },
```

(El import dinámico evita un ciclo de módulos entre `accounts` y `contact-enrichment`; confirma si el proyecto ya tiene un patrón de import estático seguro entre estos dos módulos antes de asumir que hace falta el `import()` dinámico — si no hay ciclo, usa `import` estático normal arriba del archivo.)

- [ ] **Step 6: Commit**

```bash
git add src/modules/accounts/hubspot-company-resolution-review-core.ts src/modules/accounts/__tests__/hubspot-company-resolution-review-core.test.ts src/modules/accounts/hubspot-company-review-actions.ts
git commit -m "feat(agent2a): sweep waiting contacts to HubSpot once their account's company match resolves"
```

---

## GRUPO C — UI de revisión en la ficha de cuenta

### Task C1: Componente de aviso + confirmar/rechazar

**Files:**
- Create: `src/components/accounts/hubspot-company-match-review-banner.tsx`
- Test: `src/components/accounts/__tests__/hubspot-company-match-review-banner.test.tsx`

- [ ] **Step 1: Escribir la prueba que falla**

Sigue el patrón de arnés jsdom + `@testing-library/react` + `mock.module` ya usado en este repo (ver `src/components/contacts/__tests__/post-approval-rescue-panel-ui.test.tsx` como plantilla más cercana: bootstrap de jsdom, mocks de `next/navigation` y `sonner`, mock del server action).

```typescript
// Cabecera jsdom idéntica a post-approval-rescue-panel-ui.test.tsx de este mismo repo — cópiala
// verbatim (JSDOM bootstrap, defineGlobal, ResizeObserver stub, matchMedia stub) antes de las
// siguientes líneas.

import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';

const mockResolve = mock.fn<() => Promise<{ ok: boolean }>>();
mock.module('@/modules/accounts/hubspot-company-review-actions', {
  namedExports: {
    resolveHubSpotCompanyMatchAction: (...a: unknown[]) => mockResolve(...(a as [])),
  },
});
mock.module('next/navigation', {
  namedExports: { useRouter: () => ({ refresh: () => {} }) },
});

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let act: (typeof import('@testing-library/react'))['act'];
let HubSpotCompanyMatchReviewBanner: (typeof import(
  '../hubspot-company-match-review-banner'
))['HubSpotCompanyMatchReviewBanner'];

before(async () => {
  const rtl = await import('@testing-library/react');
  ({ render, screen, fireEvent, waitFor, act } = rtl);
  ({ HubSpotCompanyMatchReviewBanner } = await import('../hubspot-company-match-review-banner'));
});

beforeEach(() => {
  mockResolve.mock.resetCalls();
  mockResolve.mock.mockImplementation(async () => ({ ok: true }));
});

describe('HubSpotCompanyMatchReviewBanner', () => {
  it('sin coincidencia pendiente, no pinta nada', () => {
    render(
      React.createElement(HubSpotCompanyMatchReviewBanner, {
        accountId: 'account-1',
        pendingMatch: null,
      }),
    );
    assert.equal(document.body.textContent, '');
  });

  it('muestra el nombre, dominio y confianza de la coincidencia', () => {
    render(
      React.createElement(HubSpotCompanyMatchReviewBanner, {
        accountId: 'account-1',
        pendingMatch: {
          hubspotCompanyId: 'hs-999',
          name: 'Autotransportes El Bisonte SA',
          domain: 'bisonte.com.mx',
          matchMethod: 'name',
          confidence: 65,
          reason: 'Match por nombre con confianza baja (65%)',
        },
      }),
    );
    assert.match(document.body.textContent ?? '', /Autotransportes El Bisonte SA/);
    assert.match(document.body.textContent ?? '', /65%/);
  });

  it('«Sí, es la misma» llama a la acción con decision: same', async () => {
    render(
      React.createElement(HubSpotCompanyMatchReviewBanner, {
        accountId: 'account-1',
        pendingMatch: {
          hubspotCompanyId: 'hs-999',
          name: 'X',
          domain: null,
          matchMethod: 'name',
          confidence: 65,
          reason: 'r',
        },
      }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Sí, es la misma/ }));
    });
    assert.equal(mockResolve.mock.callCount(), 1);
    assert.deepEqual(mockResolve.mock.calls[0].arguments[0], {
      accountId: 'account-1',
      decision: 'same',
    });
  });

  it('«No, es una empresa nueva» llama a la acción con decision: different', async () => {
    render(
      React.createElement(HubSpotCompanyMatchReviewBanner, {
        accountId: 'account-1',
        pendingMatch: {
          hubspotCompanyId: 'hs-999',
          name: 'X',
          domain: null,
          matchMethod: 'name',
          confidence: 65,
          reason: 'r',
        },
      }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /No, es una empresa nueva/ }));
    });
    assert.equal(mockResolve.mock.callCount(), 1);
    assert.deepEqual(mockResolve.mock.calls[0].arguments[0], {
      accountId: 'account-1',
      decision: 'different',
    });
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `node --experimental-test-module-mocks --import tsx --test src/components/accounts/__tests__/hubspot-company-match-review-banner.test.tsx`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar, mismo estilo que `rollback-banner.tsx` pero interactivo**

```typescript
'use client';

// Agente 2A — Aviso de coincidencia dudosa de empresa en HubSpot, en la ficha de la cuenta
// (AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC)
//
// Presentacional + una única acción de servidor. Mismo estilo visual que `rollback-banner.tsx`
// de este mismo directorio: banner con icono, sin modal.

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { resolveHubSpotCompanyMatchAction } from '@/modules/accounts/hubspot-company-review-actions';

export interface PendingHubSpotCompanyMatchView {
  hubspotCompanyId: string;
  name: string | null;
  domain: string | null;
  matchMethod: string;
  confidence: number;
  reason: string;
}

interface HubSpotCompanyMatchReviewBannerProps {
  accountId: string;
  pendingMatch: PendingHubSpotCompanyMatchView | null;
}

export function HubSpotCompanyMatchReviewBanner({
  accountId,
  pendingMatch,
}: HubSpotCompanyMatchReviewBannerProps) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<'same' | 'different' | null>(null);

  if (!pendingMatch) return null;

  async function resolve(decision: 'same' | 'different') {
    setBusy(decision);
    try {
      await resolveHubSpotCompanyMatchAction({ accountId, decision });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3.5">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
          Podría ya existir en HubSpot como &laquo;{pendingMatch.name ?? 'empresa sin nombre'}
          &raquo;
          {pendingMatch.domain ? ` (${pendingMatch.domain})` : ''} — coincidencia por{' '}
          {pendingMatch.matchMethod}, confianza {pendingMatch.confidence}%.
        </p>
        <p className="text-xs text-amber-700/80 dark:text-amber-300/80">¿Es la misma empresa?</p>
        <div className="flex gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            disabled={busy !== null}
            onClick={() => void resolve('same')}
          >
            {busy === 'same' && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Sí, es la misma
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => void resolve('different')}
          >
            {busy === 'different' && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            No, es una empresa nueva
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `node --experimental-test-module-mocks --import tsx --test src/components/accounts/__tests__/hubspot-company-match-review-banner.test.tsx`
Expected: PASS, las cuatro pruebas.

- [ ] **Step 5: Commit**

```bash
git add src/components/accounts/hubspot-company-match-review-banner.tsx src/components/accounts/__tests__/hubspot-company-match-review-banner.test.tsx
git commit -m "feat(agent2a): review banner for ambiguous HubSpot company matches on the account page"
```

---

### Task C2: Montar el banner en la ficha de cuenta

**Files:**
- Modify: `src/app/(sellup)/accounts/[accountId]/page.tsx` (junto a `<RollbackBanner ... />`, línea ~141).

- [ ] **Step 1: Localizar el punto de montaje exacto**

Run: `grep -n "RollbackBanner\|account.metadata" "src/app/(sellup)/accounts/[accountId]/page.tsx"`

- [ ] **Step 2: Implementar — leer `readPendingHubSpotMatch` y montar el banner**

Añade el import:

```typescript
import { readPendingHubSpotMatch } from '@/modules/accounts/hubspot-company-resolution-state';
import { HubSpotCompanyMatchReviewBanner } from '@/components/accounts/hubspot-company-match-review-banner';
```

Justo después de donde se resuelve `accountMetadata` (línea ~90-93, el bloque que castea `account.metadata`), añade:

```typescript
  const pendingHubSpotMatch = readPendingHubSpotMatch(accountMetadata);
```

Y en el JSX, junto a `<RollbackBanner ... />` (línea ~141):

```tsx
        <HubSpotCompanyMatchReviewBanner
          accountId={account.id}
          pendingMatch={
            pendingHubSpotMatch
              ? {
                  hubspotCompanyId: pendingHubSpotMatch.hubspotCompanyId,
                  name: pendingHubSpotMatch.name,
                  domain: pendingHubSpotMatch.domain,
                  matchMethod: pendingHubSpotMatch.matchMethod,
                  confidence: pendingHubSpotMatch.confidence,
                  reason: pendingHubSpotMatch.reason,
                }
              : null
          }
        />
```

- [ ] **Step 3: Verificación visual manual (no hay test de integración de página en este plan — se cubre en Task F con `npm run dev` si el usuario lo pide)**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(sellup)/accounts/[accountId]/page.tsx"
git commit -m "feat(agent2a): mount the HubSpot company match review banner on the account page"
```

---

## GRUPO E — Enganche en la aprobación + retiro de los dos flags

### Task E1: Módulo de disparo — `triggerContactHubSpotSync` (para reusar desde aprobación y desde el barrido de B6)

**Files:**
- Create: `src/modules/contact-enrichment/hubspot-contact-approval-sync.ts`
- Test: `src/modules/contact-enrichment/__tests__/hubspot-contact-approval-sync.test.ts`

- [ ] **Step 1: Escribir la prueba que falla**

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runContactHubSpotApprovalSync } from '../hubspot-contact-approval-sync-core';

describe('runContactHubSpotApprovalSync', () => {
  it('empresa "ready": procede a sincronizar el contacto', async () => {
    const syncCalls: string[] = [];
    const result = await runContactHubSpotApprovalSync('contact-1', {
      loadContactAccountId: async () => 'account-1',
      resolveCompany: async () => ({ status: 'ready', hubspotCompanyId: 'hs-1' }),
      syncContact: async (contactId) => {
        syncCalls.push(contactId);
        return { outcome: 'attempted_created', attempted: true, hubspotContactId: 'hs-c-1', syncResult: null, blockedReason: null };
      },
      markWaitingForCompanyReview: async () => {},
    });
    assert.equal(result.outcome, 'attempted_created');
    assert.deepEqual(syncCalls, ['contact-1']);
  });

  it('empresa "pending_review": NO sincroniza, marca el contacto en espera', async () => {
    const syncCalls: string[] = [];
    const waitCalls: string[] = [];
    const result = await runContactHubSpotApprovalSync('contact-1', {
      loadContactAccountId: async () => 'account-1',
      resolveCompany: async () => ({ status: 'pending_review' }),
      syncContact: async (contactId) => {
        syncCalls.push(contactId);
        throw new Error('no debe llamarse');
      },
      markWaitingForCompanyReview: async (contactId) => {
        waitCalls.push(contactId);
      },
    });
    assert.equal(result.outcome, 'waiting_company_review');
    assert.equal(syncCalls.length, 0);
    assert.deepEqual(waitCalls, ['contact-1']);
  });

  it('empresa "blocked" o "failed": no sincroniza, no marca espera (no va a resolverse solo)', async () => {
    for (const status of ['blocked', 'failed', 'account_unavailable'] as const) {
      const syncCalls: string[] = [];
      const result = await runContactHubSpotApprovalSync('contact-1', {
        loadContactAccountId: async () => 'account-1',
        resolveCompany: async () => ({ status }),
        syncContact: async (contactId) => {
          syncCalls.push(contactId);
          throw new Error('no debe llamarse');
        },
        markWaitingForCompanyReview: async () => {},
      });
      assert.equal(result.outcome, 'company_unavailable');
      assert.equal(syncCalls.length, 0);
    }
  });

  it('sin account_id en el contacto: no llama a nada', async () => {
    const result = await runContactHubSpotApprovalSync('contact-1', {
      loadContactAccountId: async () => null,
      resolveCompany: async () => {
        throw new Error('no debe llamarse');
      },
      syncContact: async () => {
        throw new Error('no debe llamarse');
      },
      markWaitingForCompanyReview: async () => {},
    });
    assert.equal(result.outcome, 'no_account');
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `node --import tsx --test src/modules/contact-enrichment/__tests__/hubspot-contact-approval-sync-core.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar el núcleo**

Crea `src/modules/contact-enrichment/hubspot-contact-approval-sync-core.ts`:

```typescript
// Agente 2A — Antesala del auto-sync: resuelve la empresa ANTES de delegar en el motor de
// contacto (AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC)
//
// Esto es lo que hace que `MISSING_HUBSPOT_COMPANY` deje de ser el desenlace normal: por el
// momento en que `deps.syncContact` (que ES `runContactHubSpotAutoSync`, sin cambios) se
// invoca, la empresa YA está resuelta —creada, ya existía, o vinculada tras revisión humana—, o
// no se invoca en absoluto.

export type ContactHubSpotApprovalSyncOutcome =
  | { outcome: 'no_account' }
  | { outcome: 'company_unavailable' }
  | { outcome: 'waiting_company_review' }
  | {
      outcome: string;
      attempted: boolean;
      hubspotContactId: string | null;
      syncResult: unknown;
      blockedReason: unknown;
    };

export interface ContactHubSpotApprovalSyncDeps {
  loadContactAccountId: (contactId: string) => Promise<string | null>;
  resolveCompany: (
    accountId: string,
  ) => Promise<{ status: string; hubspotCompanyId?: string }>;
  syncContact: (contactId: string) => Promise<{
    outcome: string;
    attempted: boolean;
    hubspotContactId: string | null;
    syncResult: unknown;
    blockedReason: unknown;
  }>;
  markWaitingForCompanyReview: (contactId: string) => Promise<void>;
}

export async function runContactHubSpotApprovalSync(
  contactId: string,
  deps: ContactHubSpotApprovalSyncDeps,
): Promise<ContactHubSpotApprovalSyncOutcome> {
  const accountId = await deps.loadContactAccountId(contactId);
  if (!accountId) return { outcome: 'no_account' };

  const company = await deps.resolveCompany(accountId);

  if (company.status === 'pending_review') {
    await deps.markWaitingForCompanyReview(contactId);
    return { outcome: 'waiting_company_review' };
  }

  if (company.status !== 'ready') {
    return { outcome: 'company_unavailable' };
  }

  return deps.syncContact(contactId);
}
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `node --import tsx --test src/modules/contact-enrichment/__tests__/hubspot-contact-approval-sync-core.test.ts`
Expected: PASS, las cuatro pruebas.

- [ ] **Step 5: Cableado real + el entrypoint que Task B6 importa**

Crea `src/modules/contact-enrichment/hubspot-contact-approval-sync.ts`:

```typescript
// Cableado REAL de `runContactHubSpotApprovalSync`. Vive fuera de `actions.ts` (que sí es
// `'use server'`) para poder ser importado desde el barrido de la revisión de empresa
// (Task B6) sin que ese módulo tenga que pasar por una server action.

import { createClient as createAdminClient } from '@supabase/supabase-js';
import { resolveAccountHubSpotCompanyWired } from '@/modules/accounts/hubspot-company-resolution-wiring';
import { isHubSpotContactAutoSyncEnabled as _unused_isHubSpotContactAutoSyncEnabled } from '@/lib/feature-flags.server';
import { runContactHubSpotAutoSync } from '@/modules/contacts/contact-hubspot-autosync-core';
import { runSyncContactToHubSpot } from '@/modules/contacts/contact-hubspot-sync-core';
import { buildContactHubSpotSyncDeps } from '@/modules/contacts/contact-hubspot-sync-runner';
import { runContactHubSpotApprovalSync } from './hubspot-contact-approval-sync-core';

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

/**
 * Punto de entrada ÚNICO para llevar un contacto ya aprobado a HubSpot. Lo usan:
 *   - el hook de aprobación (Task E2), con el `internalUserId` de quien aprobó;
 *   - el barrido tras resolver una revisión de empresa (Task B6), con el `internalUserId` de
 *     quien resolvió la revisión (`resolveHubSpotCompanyMatchAction` ya lo autentica).
 *
 * `actorId` es OBLIGATORIO y tiene que ser un UUID real de `internal_users`: viaja hasta
 * `contact_audit.actor_user_id`, que es `uuid` con FK a esa tabla — un valor de relleno como
 * `'system'` rompería esa escritura en cuanto `logAudit` se cablee (ver Task E2 § riesgo 4).
 * No hay valor por defecto a propósito: un llamador nuevo que lo olvide rompe la compilación
 * en vez de fallar en producción con una violación de FK.
 */
export async function triggerContactHubSpotSync(
  contactId: string,
  actorId: string,
): Promise<void> {
  const admin = getAdminClient();
  const nowIso = new Date().toISOString();

  await runContactHubSpotApprovalSync(contactId, {
    loadContactAccountId: async (id) => {
      const { data } = await admin.from('contacts').select('account_id').eq('id', id).maybeSingle();
      return (data?.account_id as string | null) ?? null;
    },
    resolveCompany: (accountId) => resolveAccountHubSpotCompanyWired(accountId, nowIso),
    syncContact: async (id) =>
      runContactHubSpotAutoSync(id, {
        // AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC: siempre activo, sin interruptor — decisión
        // explícita del usuario en el diseño. El flag histórico
        // (`isHubSpotContactAutoSyncEnabled`) queda sin consumir; no se borra su lector en este
        // corte (ver nota de scope en el plan).
        enabled: true,
        nowIso,
        loadSubject: async (subjectId) => {
          const { data } = await admin
            .from('contacts')
            .select('id, hubspot_contact_id, metadata')
            .eq('id', subjectId)
            .is('archived_at', null)
            .maybeSingle();
          if (!data) return null;
          return {
            id: data.id as string,
            hubspot_contact_id: (data.hubspot_contact_id as string | null) ?? null,
            metadata: (data.metadata as Record<string, unknown> | null) ?? {},
          };
        },
        runSync: async (subjectId) =>
          runSyncContactToHubSpot(
            subjectId,
            await buildContactHubSpotSyncDeps({
              actorId,
              nowIso,
              method: 'auto',
            }),
          ),
        persistAnnex: async (subjectId, metadata) => {
          const { error } = await admin.from('contacts').update({ metadata }).eq('id', subjectId);
          return { error: error?.message };
        },
      }),
    markWaitingForCompanyReview: async (id) => {
      const { data } = await admin.from('contacts').select('metadata').eq('id', id).maybeSingle();
      const existing = (data?.metadata as Record<string, unknown> | null) ?? {};
      await admin
        .from('contacts')
        .update({ metadata: { ...existing, hubspot_sync_status: 'waiting_company_review' } })
        .eq('id', id);
    },
  });
}
```

**Ya verificado (no hace falta reconfirmarlo al ejecutar):** `contact_audit.actor_user_id` es `uuid` con FK a `internal_users` — por eso `actorId` es obligatorio y nunca un literal como `'system'`. Los dos call sites (Task E2 y Task B6) pasan un `internalUserId` real; ver ahí.

- [ ] **Step 6: Ejecutar la regresión del grupo**

Run: `node --import tsx --test src/modules/contact-enrichment/__tests__/hubspot-contact-approval-sync-core.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/contact-enrichment/hubspot-contact-approval-sync-core.ts src/modules/contact-enrichment/hubspot-contact-approval-sync.ts src/modules/contact-enrichment/__tests__/hubspot-contact-approval-sync-core.test.ts
git commit -m "feat(agent2a): resolve the account's HubSpot company before delegating to contact autosync"
```

---

### Task E2: Enganchar en el hook de aprobación, retirar el flag del autosync

**Files:**
- Modify: `src/modules/contact-enrichment/actions.ts:963-1032` (la "SEGUNDA FASE" ya localizada).
- Test: `src/modules/contact-enrichment/__tests__/official-contact-approval-autosync-cut3b.test.ts` (existente — verifica que no rompe, y añade el caso nuevo).

- [ ] **Step 1: Leer el test existente para no romper su arnés**

Run: `sed -n '1,60p' src/modules/contact-enrichment/__tests__/official-contact-approval-autosync-cut3b.test.ts`

- [ ] **Step 2: Añadir la prueba que falla — el flag ya NO debe leerse**

Añade al archivo existente (ajusta el nombre del arnés al que ya use ese archivo):

```typescript
it('el autosync corre SIEMPRE, sin depender de isHubSpotContactAutoSyncEnabled', async () => {
  // Antes de esta tarea, `enabled` se resolvía llamando a `isHubSpotContactAutoSyncEnabled()`.
  // Esta prueba no puede mockear esa función sin tocar `process.env` — en su lugar, confirma
  // por INSPECCIÓN ESTÁTICA que `actions.ts` ya no la importa ni la llama en el bloque de la
  // SEGUNDA FASE.
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(
    new URL('../actions.ts', import.meta.url),
    'utf8',
  );
  assert.equal(
    /isHubSpotContactAutoSyncEnabled/.test(source),
    false,
    'el hook de aprobación no puede depender del flag: la decisión es "siempre activo"',
  );
});
```

- [ ] **Step 3: Ejecutar y verificar que falla**

Run: `node --import tsx --test src/modules/contact-enrichment/__tests__/official-contact-approval-autosync-cut3b.test.ts`
Expected: FAIL — el import todavía existe.

- [ ] **Step 4: Implementar — reemplazar el bloque de la SEGUNDA FASE**

Localiza el bloque exacto (confirmado en el research, `actions.ts:963-1032`) que empieza en:

```typescript
    // ── SEGUNDA FASE — autosync HubSpot (CUT-3B) ─────────────────
```

y termina en:

```typescript
    return { ...result, hubspotAutoSync };
```

Reemplázalo por:

```typescript
    // ── SEGUNDA FASE — HubSpot: empresa + contacto (AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC)
    //
    // Empieza aquí y no antes por la misma razón de siempre: la transacción de aprobación YA
    // confirmó, así que nada de lo que sigue puede revertirla. Un fallo de HubSpot nunca
    // convierte en fracaso algo que ya está escrito en la base de datos.
    //
    // Reemplaza el hook de CUT-3B: ya NO depende de `isHubSpotContactAutoSyncEnabled()` —
    // siempre activo, decisión explícita del usuario— y antepone la resolución de la empresa
    // (que antes nunca ocurría: el autosync exigía `hubspot_company_id` y ningún camino lo
    // creaba).
    if (!result.ok) return result;

    const { triggerContactHubSpotSync } = await import('./hubspot-contact-approval-sync');
    // `internalUserId` es el UUID real de quien aprobó — el mismo que ya resuelve
    // `requireActiveUserForEnrichment()` más arriba en esta función. Viaja hasta
    // `contact_audit.actor_user_id` (FK a `internal_users`), así que tiene que ser éste y no
    // un valor de relleno.
    await triggerContactHubSpotSync(result.contactId, internalUserId);

    return result;
```

**Nota importante:** el bloque viejo devolvía `{ ...result, hubspotAutoSync }`, y `ApproveResult` puede tener consumidores que leen `hubspotAutoSync` del resultado (UI que muestra el estado del intento). Antes de borrar ese campo:

Run: `grep -rln "hubspotAutoSync" src --include="*.ts" --include="*.tsx" | grep -v __tests__`

Si algo lo consume, en vez de descartarlo, ajusta el `triggerContactHubSpotSync` de Task E1 para que DEVUELVA el `ContactHubSpotApprovalSyncOutcome` y aquí se siga adjuntando como `hubspotAutoSync: outcome` — no elimines información que la UI ya muestra sin antes confirmar que nadie la lee.

- [ ] **Step 5: Quitar el import ya no usado**

Run: `grep -n "isHubSpotContactAutoSyncEnabled\|runContactHubSpotAutoSync\|buildContactHubSpotSyncDeps\|logContactAudit" src/modules/contact-enrichment/actions.ts`

Si `isHubSpotContactAutoSyncEnabled`, `runContactHubSpotAutoSync`, `buildContactHubSpotSyncDeps` ya no se usan en NINGÚN otro punto de `actions.ts`, quita sus imports. Si `logContactAudit` seguía usándose SÓLO por el bloque borrado, decide si mover su llamada de auditoría dentro de `triggerContactHubSpotSync` (Task E1) en vez de perderla — el spec no pedía quitar la auditoría del intento automático, así que confírmalo antes de decidir.

- [ ] **Step 6: Ejecutar y verificar que pasa**

Run: `node --import tsx --test src/modules/contact-enrichment/__tests__/official-contact-approval-autosync-cut3b.test.ts`
Expected: PASS.

- [ ] **Step 7: Regresión completa del área de aprobación**

Run: `npm run test:agent2:hubspot-autosync-cut3b && npm run test:agent2a:candidate-review`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/modules/contact-enrichment/actions.ts src/modules/contact-enrichment/__tests__/official-contact-approval-autosync-cut3b.test.ts
git commit -m "feat(agent2a): approval hook resolves the HubSpot company first, drops the auto-sync flag gate"
```

---

### Task E3: Retirar el flag del auto-update de teléfono (el segundo disparador)

**Files:**
- Modify: `src/modules/contacts/contact-hubspot-sync-runner.ts:184` (`runContactHubSpotAutoPhoneUpdateWired`).
- Test: `src/modules/contacts/__tests__/contact-hubspot-auto-phone-update-cut3c.test.ts`

- [ ] **Step 1: Añadir la prueba que falla**

```typescript
it('el auto-update de teléfono corre SIEMPRE, sin depender de isHubSpotContactAutoPhoneUpdateEnabled', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(
    new URL('../contact-hubspot-sync-runner.ts', import.meta.url),
    'utf8',
  );
  assert.equal(
    /isHubSpotContactAutoPhoneUpdateEnabled/.test(source),
    false,
    'el auto-update de teléfono no puede depender del flag: la decisión es "siempre activo"',
  );
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npm run test:agent2:hubspot-auto-phone-update-cut3c`
Expected: FAIL.

- [ ] **Step 3: Implementar**

En `contact-hubspot-sync-runner.ts:184`, cambiar:

```typescript
    enabled: isHubSpotContactAutoPhoneUpdateEnabled(),
```

por:

```typescript
    // AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC: siempre activo, sin interruptor. El teléfono
    // que llega DESPUÉS de aprobar (reveal asíncrono, continuación a Lusha, buscar más números)
    // debe llegar a HubSpot solo, sin ningún clic — es el segundo disparador del diseño.
    enabled: true,
```

Quitar el import de `isHubSpotContactAutoPhoneUpdateEnabled` si ya no se usa en ningún otro punto del archivo (confirma con `grep -n "isHubSpotContactAutoPhoneUpdateEnabled" src/modules/contacts/contact-hubspot-sync-runner.ts`).

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `npm run test:agent2:hubspot-auto-phone-update-cut3c`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/contacts/contact-hubspot-sync-runner.ts src/modules/contacts/__tests__/contact-hubspot-auto-phone-update-cut3c.test.ts
git commit -m "feat(agent2a): drop the flag gate on the post-approval phone auto-update trigger"
```

---

## GRUPO F — Regresión completa

### Task F1: Suite completa, typecheck, lint, build

- [ ] **Step 1: Regresión dirigida de todo lo tocado por este plan**

```bash
npm run test:agent2:hubspot-sync-state-cut1
npm run test:agent2:hubspot-sync-update-cut2
npm run test:agent2:hubspot-stale-completeness-cut3a
npm run test:agent2:hubspot-stale-completeness-cut3a:postgres
npm run test:agent2:hubspot-autosync-cut3b
npm run test:agent2:hubspot-auto-phone-update-cut3c
npm run test:agent2:hubspot-stale-source-cut3c:postgres
npm run test:agent2:hubspot-legacy-sync-backfill
npm run test:agent2:hubspot-legacy-sync-backfill:postgres
npm run test:agent2:hubspot-sync-ui-honesty
npm run test:agent2:hubspot-sync-core
npm run test:agent2a:candidate-review
npm run test:agent2a:final-local-integration
npm run test:agent2a:final-local-integration:postgres
```

Expected: PASS en las catorce.

- [ ] **Step 2: Correr los tests nuevos de este plan, todos juntos**

```bash
node --import tsx --test \
  src/modules/contacts/__tests__/contact-hubspot-sync-state.test.ts \
  src/modules/accounts/__tests__/hubspot-company-resolution-core.test.ts \
  src/modules/accounts/__tests__/hubspot-company-resolution-state.test.ts \
  src/modules/accounts/__tests__/hubspot-company-resolution-runtime.test.ts \
  src/modules/accounts/__tests__/hubspot-company-resolution-review-core.test.ts \
  src/modules/contact-enrichment/__tests__/hubspot-contact-approval-sync-core.test.ts \
  src/server/integrations/__tests__/hubspot-property-ensure.test.ts

node --experimental-test-module-mocks --import tsx --test \
  src/components/accounts/__tests__/hubspot-company-match-review-banner.test.tsx
```

Expected: PASS en todos.

- [ ] **Step 3: P342 (Capa A y, si el build está fresco, Capa B) sobre los archivos `'use server'` nuevos**

```bash
node --import tsx --test src/__tests__/use-server-type-reexport-runtime-p342.test.ts
npm run build
npm run test:agent2a:p342-contacts-runtime
```

Expected: PASS.

- [ ] **Step 4: typecheck, lint, build**

```bash
npx tsc --noEmit
npm run lint
npm run build
```

Expected: `tsc` limpio; `lint` con el MISMO número de problemas que el baseline de la rama (comprueba con `git stash` + `npm run lint` sobre `origin/main` si hay dudas de si algo nuevo se coló); `build` termina con "Compiled successfully".

- [ ] **Step 5: Registrar en `docs/superpowers/plans/2026-08-27-hubspot-contact-approval-autosync.md` (este archivo) cualquier desviación encontrada durante la ejecución**

Si algún Step de este plan resultó incorrecto al ejecutarlo (un nombre de función distinto al asumido, una interfaz con más campos de los documentados), anota la corrección real al lado del Step correspondiente antes de marcarlo como hecho — el plan debe quedar describiendo lo que REALMENTE se construyó, no lo que se planeó a ciegas.

- [ ] **Step 6: Commit final si quedó algo suelto**

```bash
git status --short
git add -A
git commit -m "chore(agent2a): final regression pass for HubSpot contact-approval autosync"
```

(Omitir si `git status --short` no muestra nada.)

---

## Riesgos y supuestos a verificar durante la ejecución (no bloquean escribir el plan, sí su ejecución)

1. ~~`CreateHubSpotCompanyResult`~~ — **YA VERIFICADO**: tiene `ok: boolean` y `hubspotCompanyId?: string` (además de los alias legados `success`/`company_id`). El mapeo de Task B4 es correcto tal como está escrito.
2. **`requireActiveUserForEnrichment`** en Task B5 — confirma la ruta de import real para autorización de acciones de cuentas; puede no ser la misma que en `contact-enrichment`. Lo que sí es fijo: tiene que devolver `{ internalUserId }`, un UUID real de `internal_users` — no una sesión sin ese dato, porque Task B6 lo necesita para atribuir el sync.
3. ~~`actorId` en `buildContactHubSpotSyncDeps`~~ — **YA VERIFICADO Y CORREGIDO EN EL PLAN**: `contact_audit.actor_user_id` es `uuid` con FK a `internal_users` (confirmado contra el esquema real de Producción, solo lectura). Por eso `triggerContactHubSpotSync` exige `actorId` sin valor por defecto, y los dos call sites (Task E2, Task B6) pasan el `internalUserId` real de quien disparó la acción — nunca un literal como `'system'`.
4. **`hubspotAutoSync` en `ApproveResult`** (Task E2) — confirma si algún componente de UI lo lee antes de decidir si se preserva o se descarta al reemplazar el hook.
5. **Ciclo de módulos `accounts` ↔ `contact-enrichment`** (Task B6) — confirma si hace falta el `import()` dinámico o si un import estático ya es seguro.

Ninguno de estos puntos cambia el DISEÑO acordado con el usuario — son detalles de implementación que se resuelven leyendo el código en el momento de ejecutar cada tarea, no decisiones de producto.
