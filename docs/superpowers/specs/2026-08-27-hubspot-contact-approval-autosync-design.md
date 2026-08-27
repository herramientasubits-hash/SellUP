# Diseño — Sincronización automática a HubSpot al aprobar un contacto

**Fecha:** 2026-08-27
**Hito:** AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC
**Rama:** `agent2a/hubspot-contact-approval-autosync-1`
**Estado:** Aprobado en conversación, pendiente de plan de implementación

## 1. Problema

Hoy, cuando se aprueba un candidato en SellUp, **nada** lo lleva a HubSpot automáticamente:

- Sincronizar un contacto a HubSpot es una acción MANUAL (botón "Sincronizar con HubSpot" en la ficha del contacto).
- Aunque existe un motor de auto-sync (`runContactHubSpotAutoSync`, gateado por el flag
  `HUBSPOT_CONTACT_AUTO_SYNC_ENABLED`), ese motor **exige que la cuenta ya tenga
  `hubspot_company_id`** — nunca crea la empresa. Si la cuenta no está vinculada a HubSpot,
  el sync falla con `MISSING_HUBSPOT_COMPANY` y ahí muere.
- El flag está apagado en todas partes hoy (verificado: ni Leidy Jurado Gómez ni Gilberto
  Saldaña Bernal, ambos aprobados el 27-08-2026, tienen `hubspot_contact_id` ni
  `metadata.hubspot_sync` — cero intentos de sync).

Separadamente, SÍ existe un motor de auto-creación de EMPRESAS en HubSpot
(`attemptHubSpotSync` / `checkHubSpotCompanyCommercialStatus` / `createHubSpotCompany`), pero
está enganchado únicamente al flujo de conversión de prospecto→cuenta, no al de aprobación de
contacto.

**Objetivo:** que aprobar un contacto en SellUp cree y llene automáticamente su ficha en
HubSpot — creando la empresa si hace falta —, sin ningún clic adicional, reutilizando los dos
motores que ya existen y están probados en vez de construir una tercera implementación.

## 2. Disparadores

Dos momentos, ambos automáticos, sin botón ni flag que el operador tenga que encender:

1. **Al aprobar el contacto.** Si ya hay teléfono en ese instante, se manda de una vez.
2. **Cuando el teléfono llega después.** El reveal es asíncrono (Apollo/Lusha, la continuación
   a Lusha, "buscar más números"); en cuanto el número queda proyectado sobre un contacto YA
   aprobado, HubSpot se actualiza solo — sin ningún clic.

No hay interruptor nuevo para esto: el flag `HUBSPOT_CONTACT_AUTO_SYNC_ENABLED` deja de leerse
en el punto donde hoy bloquea el sync (decisión explícita del usuario en el diseño: "siempre
activo, sin interruptor", igual que ya funciona la creación de empresas para prospectos).

## 3. Resolución de la empresa en HubSpot

Reutiliza tal cual `checkHubSpotCompanyCommercialStatus` (búsqueda por NIT en Colombia →
dominio exacto → nombre normalizado, con `matchConfidence`) y `createHubSpotCompany`. Tres
desenlaces:

| Resultado del motor | Acción |
|---|---|
| `hubspotMatchStatus === 'no_match'` | Se crea la empresa en HubSpot con los datos de la cuenta (`createHubSpotCompany`), se guarda `accounts.hubspot_company_id`. |
| Coincidencia CONFIABLE con cliente/prospecto/ex-cliente (`exact_match_*`) | **Sin cambios respecto a hoy**: se bloquea en silencio (`hubspot_sync_status: 'blocked_duplicate'`), igual que en el flujo de prospectos. Fuera de alcance de este hito. |
| `hubspotMatchStatus === 'possible_match_requires_review'` | **Nuevo.** Pausa y pide confirmación humana — ver § 4. |

**Diferencia deliberada con el motor de prospectos:** la exigencia de NIT para Colombia
(`accountCountryCode === 'CO' && !accountTaxIdentifier` bloquea en `attemptHubSpotSync`) NO
aplica aquí. Esa regla tiene sentido para prospección masiva; una cuenta que ya es cliente
activo de SellUp con un contacto aprobado se sincroniza igual aunque le falte el NIT.

**Fuera de Colombia**, el campo de identificación fiscal que HubSpot compara hoy (`nit`) es
literalmente específico de Colombia — no existe un campo equivalente para RFC u otros
identificadores en el portal de HubSpot configurado hoy. Mientras ese campo no exista del lado
de HubSpot, la única señal fuera de Colombia es dominio y nombre — que es exactamente lo que
`checkHubSpotCompanyCommercialStatus` ya hace como fallback. Confirmado explícitamente por el
usuario: no se bloquea a esperar un campo fiscal nuevo en HubSpot.

## 4. Revisión humana de coincidencia dudosa (pieza NUEVA — no existe hoy en ningún lugar de la app)

El estado `possible_match_requires_review` ya existe en el tipo de retorno del motor
(`HubspotMatchStatus`), pero hoy **no lleva a ninguna acción**: `attemptHubSpotSync` lo trata
igual que cualquier match y bloquea en silencio. No hay ninguna pantalla en la aplicación donde
un operador vea "esto podría ser la misma empresa" y decida.

### 4.1 Estado durable

En `accounts.metadata`:

```json
{
  "hubspot_sync_status": "pending_match_review",
  "hubspot_pending_match": {
    "hubspot_company_id": "12345",
    "name": "Autotransportes El Bisonte SA",
    "domain": "bisonte.com.mx",
    "match_method": "name",
    "confidence": 65,
    "reason": "Match por nombre con confianza baja (65%)",
    "detected_at": "2026-08-27T21:30:00.000Z"
  }
}
```

No se crea ninguna tabla nueva: es la misma convención de auditoría en `metadata` que ya usa
`attemptHubSpotSync` (`hubspot_sync_status`, `hubspot_sync_blocked_reason`, etc.).

### 4.2 La pantalla

Ubicación: **ficha de la cuenta** en SellUp (no la del contacto — la cuenta es la entidad
ambigua, y puede haber varios contactos esperando la misma respuesta).

Contenido: un aviso — *"Podría ya existir en HubSpot como '{name}' ({domain}) — coincidencia
por {match_method}, confianza {confidence}%. ¿Es la misma empresa?"* — con dos botones:

- **"Sí, es la misma"** → vincula `accounts.hubspot_company_id = hubspot_pending_match.hubspot_company_id`,
  marca `hubspot_sync_status: 'synced'`, limpia `hubspot_pending_match`.
- **"No, es una empresa nueva"** → fuerza `createHubSpotCompany` (sin volver a pasar por el
  chequeo de duplicados — un humano ya lo resolvió), guarda el `hubspot_company_id` NUEVO,
  marca `synced`, limpia `hubspot_pending_match`.

### 4.3 Qué pasa con los contactos mientras tanto

La aprobación del contacto en SellUp **nunca se bloquea** por esto — el contacto queda
`approved` igual, con o sin HubSpot. Lo único que espera es la inyección a HubSpot: el
contacto entra a un estado `hubspot_sync_status: 'waiting_company_review'` en su propio
metadata (mismo patrón).

En el momento en que se resuelve la revisión (cualquiera de las dos respuestas), se buscan
TODOS los contactos `approved` de esa cuenta con `hubspot_sync_status: 'waiting_company_review'`
y se dispara su sync automáticamente, uno por uno — sin que el operador tenga que volver a cada
ficha.

## 5. Sincronización del contacto (motor YA EXISTENTE, sin cambios de lógica)

Una vez la empresa tiene `hubspot_company_id` (por cualquiera de los tres caminos de § 3-4):

1. `findHubSpotContactByEmail` — evita duplicar si el contacto ya existía en HubSpot por otra
   vía.
2. Si no aparece: `createHubSpotContact` — nombre, cargo, email, y el/los teléfono(s) que ya
   haya en ese instante.
3. `associateHubSpotContactWithCompany` — asocia contacto ↔ empresa.
4. Cuando el teléfono llegue después (§ 2, disparador 2): `updateHubSpotContact` sobre el
   contacto ya creado.

Esto es exactamente `runContactHubSpotAutoSync` / `runSyncContactToHubSpot` ya construidos —
sin cambios de lógica, solo se les quita el gate del flag y se resuelve la precondición que
hoy les falta (la empresa).

## 6. Teléfonos — dos campos, no uno

SellUp guarda hasta dos números por contacto: `phone` (fijo/trabajo) y `mobile_phone` (móvil).
HubSpot tiene los mismos dos campos nativos: `phone` y `mobilephone`.

**Cambio respecto al motor actual:** `buildHubSpotContactUpdateProperties` hoy envía
EXACTAMENTE un campo (`phone`). Se extiende a los dos:

```ts
// Antes (CUT-2/CUT-3A):
{ phone: input.phone ?? '' }

// Después:
{ phone: input.phone ?? '', mobilephone: input.mobilePhone ?? '' }
```

Mismo criterio de borrado que ya existe (`null` → `''`, nunca se omite el campo). Si solo se
encontró un número, se manda solo ese; el otro llega vacío igual que hoy.

`createHubSpotContact` recibe el mismo tratamiento en su payload inicial.

## 7. Campo nuevo "Creado por SellUp" (checkbox, en Contacto y en Empresa)

**Corrección a una premisa incorrecta planteada en la conversación:** el motor de empresas NO
crea campos nuevos en HubSpot hoy. Lo que hace (`getHubSpotCompanyPropertiesMetadata` +
`findPropertyInternalName`) es buscar si YA existe un campo con un nombre parecido dentro de
una lista fija (`SAFE_STANDARD_PROPERTIES`) y, si no lo encuentra, **se salta ese dato**. Nunca
inventa un campo. Este hito sí lo hace, por primera vez en el código base — es una operación
que modifica el ESQUEMA del HubSpot del cliente, no solo sus datos.

### 7.1 Especificación del campo

| | Contacto | Empresa |
|---|---|---|
| Nombre interno | `sellup_created` | `sellup_created` |
| Etiqueta | "Creado por SellUp" | "Creado por SellUp" |
| Tipo | `bool` (checkbox) | `bool` (checkbox) |
| Valor | `true`, una sola vez, al crear | `true`, una sola vez, al crear |

No se vuelve a tocar después de la creación — no se re-envía en actualizaciones de teléfono.

### 7.2 Mecánica de creación (idempotente, fail-closed)

Antes de la primera creación de contacto o empresa en cada objeto:

1. `GET /crm/v3/properties/{objectType}/sellup_created` — si existe (200), seguir.
2. Si no existe (404): `POST /crm/v3/properties/{objectType}` para crearlo.
3. Si la creación falla (permiso insuficiente — el scope de escritura de ESQUEMA
   `crm.schemas.{contacts|companies}.write` es distinto del de escritura de OBJETOS que ya se
   usa hoy, y puede no estar concedido): se registra el motivo, se sigue con la creación del
   contacto/empresa SIN el campo. Nunca bloquea la sincronización real.

Este chequeo se hace en cada llamada (una lectura barata), pero solo escribe una vez: en
cuanto existe, los siguientes intentos lo encuentran en el paso 1 y no vuelven a intentar
crearlo.

## 8. Manejo de errores — sin cambios de la convención ya establecida

Ningún fallo de HubSpot bloquea nada en SellUp: ni la aprobación del contacto, ni la creación
de la cuenta. Se registra el motivo exacto (reutilizando el vocabulario de estado que ya usa
`attemptHubSpotSync`: `skipped_no_connection`, `skipped_missing_write_scope`, `failed_lookup`,
etc.) y queda pendiente. **Sin reintento automático en esta versión** — un fallo se resuelve
manualmente después (vía el botón manual ya existente, que sigue funcionando igual).

## 9. Explícitamente fuera de alcance

- **Sin sincronización retroactiva.** Contactos ya aprobados antes de este despliegue (Leidy,
  Gilberto, y cualquier otro histórico) no se tocan. Esto aplica solo hacia adelante.
- **Coincidencia confiable con cliente/prospecto/ex-cliente existente** en HubSpot sigue
  bloqueándose en silencio, igual que en el flujo de prospectos hoy — no entra en el flujo de
  revisión humana de § 4, que es solo para el caso DUDOSO.
- **Un solo campo nuevo** ("Creado por SellUp"). No se construye un mecanismo genérico de
  "detectar cualquier dato de SellUp sin campo en HubSpot y crearlo" — cada campo adicional
  futuro es una decisión y una ronda de trabajo aparte.
- **No se crea ningún campo en HubSpot fuera de "Creado por SellUp".** En particular, no se
  crea un campo de identificación fiscal genérico para mejorar el match fuera de Colombia — eso
  requeriría antes una decisión de qué identificador usar por país, fuera del alcance actual.

## 10. Componentes a tocar (para el plan de implementación)

**Nuevo:**
- Server action + core para resolver/crear la empresa desde el flujo de aprobación (envolviendo
  `checkHubSpotCompanyCommercialStatus` + `createHubSpotCompany`, sin la exigencia de NIT de
  Colombia).
- Estado durable de "revisión pendiente" en `accounts.metadata` + acción para resolverlo (dos
  desenlaces, § 4.2).
- Componente de UI: aviso + botones en la ficha de la cuenta.
- Verificación/creación idempotente del campo `sellup_created` en Contacto y Empresa
  (`GET`/`POST /crm/v3/properties/{objectType}`).
- El disparo tras resolver la revisión: barrido de contactos `waiting_company_review` de esa
  cuenta.

**Modificado:**
- `buildHubSpotContactUpdateProperties` / `HubSpotContactUpdateInput` — de un campo a dos
  (`phone` + `mobilePhone`).
- `createHubSpotContact` / `HubSpotContactCreateInput` — añade `mobilephone` al payload inicial.
- El punto de enganche tras `runApproveCandidate` en `src/modules/contact-enrichment/actions.ts`
  (línea ~977 hoy) — se le antepone la resolución de empresa; se retira el gate de
  `isHubSpotContactAutoSyncEnabled()`.
- El punto de enganche del auto-update de teléfono tras un reveal post-aprobación
  (`post-approval-reveal-runtime.ts` / `contact-hubspot-auto-phone-update-core.ts`) — mismo
  criterio: se activa sin depender del flag que hoy lo mantiene apagado.

**Sin cambios (se reutilizan tal cual):**
- `checkHubSpotCompanyCommercialStatus`, `classifyHubSpotCommercialMatch`, `createHubSpotCompany`
- `findHubSpotContactByEmail`, `associateHubSpotContactWithCompany`
- Toda la lógica de resolución de estado durable de sync ya construida (`contact-hubspot-sync-state.ts`)

## 11. Plan de pruebas (nivel de diseño, se detalla en el plan de implementación)

- Los tres desenlaces de § 3 (no-match crea, match confiable bloquea igual que hoy, match dudoso
  pausa) — núcleo puro, sin red.
- Los dos desenlaces de § 4.2 (confirmar / rechazar) y que ambos disparan el barrido de
  contactos en espera.
- `buildHubSpotContactUpdateProperties`/`createHubSpotContact` con las combinaciones de
  cero/uno/dos números.
- La creación idempotente del campo: existe → no se recrea; no existe → se crea una vez; sin
  permiso → no bloquea, no se repite en cada intento de forma que sature la API.
- Cero llamadas a HubSpot cuando la aprobación falla antes de llegar a esta fase (el hook no se
  ejecuta si `runApproveCandidate` no tuvo éxito).
- Regresión completa de: aprobación de candidato, auto-sync de contacto existente, auto-update
  de teléfono, y toda la cadena de reveal (waterfall, rescate, durable resume) construida en
  esta misma sesión — nada de esto debería cambiar de comportamiento.
