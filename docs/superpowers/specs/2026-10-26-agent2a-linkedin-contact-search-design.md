# Diseño — Agente 2A: buscar un contacto por su perfil de LinkedIn (F2)

**Fecha:** 2026-10-26
**Hito:** AGENT2A-LINKEDIN-CONTACT-SEARCH
**Rama:** `feat/agent2a-linkedin-contact-search` (apilada sobre `fix/agent2a-search-mode-icons-and-reset`, F1)
**Bandera:** `CONTACT_ENRICHMENT_LINKEDIN_SEARCH_ENABLED` (apagada por defecto)
**Estado:** implementado en la rama. Aprobado por Bryan Castro el 2026-10-26, con un cambio: la
deduplicación en HubSpot por la URL queda como trabajo futuro (§ 9).

## 1. Problema

Ventas a menudo ya tiene el perfil de LinkedIn de la persona a la que quiere llegar. Hoy el
Agente 2A sólo busca contactos **por empresa**, así que hay que buscar la empresa, esperar a
que Apollo/Lusha devuelvan a alguien y esperar que esa persona esté en la lista.

## 2. Flujo

El modo se abre con el botón de LinkedIn del panel (F1). El usuario pega el enlace del perfil.

| # | Paso | Gasto | Si falla / coincide |
|---|---|---|---|
| 1 | Validar y normalizar la URL (`linkedin-profile-url.ts`) | 0 | URL inválida o de empresa → mensaje claro, nada más |
| 2 | ¿Ya está en SellUp **por su LinkedIn**? (`contacts` y candidatos `pending_review`, en todas las cuentas) | 0 | Muestra el contacto y su empresa; **no se cobra nada** |
| 3 | Enriquecer: **Apollo** `people/match` con `linkedin_url` (sin teléfono) | 1 crédito Apollo | — |
| 4 | Si Apollo no trae datos (sin persona o sin correo): **Lusha** `v3/contacts/search` por `linkedinUrl` y `v3/contacts/enrich` sólo emails | Lo que reporte Lusha | — |
| 5 | Ninguno encontró a la persona | — | «No encontramos datos para este perfil». No se crea nada |
| 5b | Error del proveedor (o ninguno disponible) | — | Mensaje distinto de «no encontrado», con «Reintentar» |
| 6 | ¿El **correo encontrado** ya existe? SellUp (`contacts.email`) y luego HubSpot (`findHubSpotContactByEmail`, el mismo de #362) | 0 | Se avisa (con el gasto ya hecho) y **no** se crea candidato |
| 7 | Vista previa: nombre, cargo, empresa actual según el proveedor y datos (correo). El teléfono sigue el flujo de reveal | 0 | — |
| 8 | «Asociar a una empresa» (obligatorio) | 0 | Sin empresa no hay candidato |
| 9 | Crear request (crea/vincula la cuenta, #587) → run **con `account_id`** → candidato `pending_review` | 0 | Sin cuenta resuelta no se crea el run |
| 10 | Al aprobar: el camino de siempre. El POST de creación en HubSpot ya envía `hs_linkedin_url` con el reintento sin él ante un 400 (#651) | — | — |

HubSpot caído en el paso 6 no bloquea: la vista previa lo dice y, al aprobar, la sincronización
vuelve a buscar por correo y vincula en vez de duplicar (#362).

### 2.1 Normalización de la URL

`normalizeLinkedinProfileUrl()`:

* sólo perfiles `/in/<slug>`; `/company/`, `/school/` y `/showcase/` → «es una página de empresa»;
  `/pub/…`, `/sales/…` y `/in/ACoAA…` → «no podemos leer ese formato»;
* quita protocolo, cualquier subdominio (`www.`, `es.`, `cl.`, `m.`…), parámetros, ancla, barra
  final y lo que siga al slug (`/es`, `/details/…`);
* decodifica el slug (`%C3%A9` → `é`) y lo pasa a minúsculas: esa es la **clave** de comparación;
* URL canónica (la que se guarda y va a los proveedores y a HubSpot):
  `https://www.linkedin.com/in/<slug codificado>`.

La deduplicación en SellUp preselecciona con `ilike '%/in/<slug>%'` (y la forma codificada) y
confirma cada fila con la misma clave, así que `https://es.linkedin.com/in/Ana/` y
`linkedin.com/in/ana?trk=x` son la misma persona.

### 2.2 Entre la búsqueda y la creación: vista previa firmada

El enriquecimiento ocurre antes de saber la empresa, y el run debe nacer con su `account_id`.
Para no crear el run sin cuenta ni guardar la vista previa en una tabla nueva, el resultado del
proveedor viaja al navegador y vuelve **firmado con HMAC-SHA256** (`linkedin-preview-token.ts`):

* clave derivada de `SUPABASE_SERVICE_ROLE_KEY` con una etiqueta propia (sólo servidor);
* válida 30 minutos y sólo para el usuario que buscó;
* cualquier cambio en el contenido invalida la firma;
* crear el candidato **no vuelve a llamar** a ningún proveedor.

### 2.3 El run

`contact_enrichment_runs` no admite un tipo `linkedin_single` sin migración (CHECK de
`routing_mode`, `intended_provider` y la tupla de la migración 088). Se usa el modelo que ya
existe: **una request + el intento 1** con `intended_provider` = el proveedor que trajo los datos,
creado con el RPC `create_contact_enrichment_attempt`, que copia el `account_id` de la request.
La entrada se marca en `summary.entry_mode = 'linkedin_single'` y en
`enrichment_metadata.entry_mode` del candidato. El run termina en `ready_for_review`.

Como el run tiene su cuenta desde el inicio, reveal, privacy gate, supresión y webhook leen la
cuenta correcta (lo que B1b arregla para los candidatos reasignados no aplica aquí).

### 2.4 Empresa y consistencia

Un mismo diálogo con dos caminos, los dos sobre el buscador de «Reasignar empresa» (#602),
ahora separado en `company-search-picker.tsx`:

* **Por Company ID de HubSpot**: entrada `{ hubspotCompanyId }`, lectura por ID de #587;
* **Buscar empresa**: nombre o dominio, precargado con el dominio (o el nombre) del proveedor.

Al elegir, se recalcula `company_consistency` con `checkCompanyConsistency()` (el mismo
verificador de Apollo, Lusha y #602). Si da `possible_mismatch`, se avisa «La empresa no coincide
con la del proveedor… puede haber cambiado de trabajo». El servidor lo recalcula al crear y lo
guarda en `enrichment_metadata.company_consistency`.

## 3. Costo en créditos por búsqueda

| Caso | Apollo | Lusha | Total |
|---|---|---|---|
| URL inválida | 0 | 0 | **0** |
| Ya está en SellUp por su LinkedIn | 0 | 0 | **0** |
| Apollo trae correo | 1 | 0 | **1 crédito** |
| Apollo sin datos → Lusha encuentra | 1 | búsqueda: costo no mapeado (se registra como desconocido) + enrich: lo que reporte Lusha por el contacto revelado | **1 + Lusha** |
| Apollo sin datos → Lusha no encuentra | 1 | búsqueda: desconocido; no se paga enrich | **1 + búsqueda Lusha** |
| El correo encontrado ya existe | lo gastado hasta ahí | lo gastado hasta ahí | se avisa |
| Crear el candidato | 0 | 0 | **0** |

* Apollo `people/match` con `reveal_personal_emails: true` y sin `reveal_phone_number`: los mismos
  parámetros que la completion de #589, 1 crédito por llamada respondida. Una respuesta de error
  se registra con costo desconocido (`null`).
* Lusha: `lusha_contact_search` no tiene costo mapeado en el repo (igual que en el runner de
  Lusha, `search_credit_cost_not_mapped`) y queda como desconocido; `lusha_contact_enrich` usa
  `creditsCharged` de la respuesta o desconocido. **Nunca se inventa un 0.**
* Se registra con el mecanismo actual: una fila en `provider_usage_logs` por llamada, con
  `agent_key = 'agent2a'`, `agent_step = 'identificar_contacto'`, `triggered_by` y
  `metadata.entry_mode = 'linkedin_single'`. **Sin la URL.** El costo en USD queda `NULL`
  (esta ruta no lo calcula; los créditos sí se registran).
* No agrega reglas de presupuesto y **no hace preflight de presupuesto** antes de llamar: el
  consumo queda en `provider_usage_logs` y cuenta para los topes que se administran como en
  BUDGET § 8. Si se quiere bloquear por presupuesto antes de gastar, es un cambio aparte.
  Ver [BUDGET_AND_BILLING.md](../../agent2a/BUDGET_AND_BILLING.md) § 10.

## 4. Migración

**No hace falta.** La vista previa viaja firmada (§ 2.2), el run usa request + intento 1 (§ 2.3)
y las marcas van en `summary` y `enrichment_metadata` (jsonb). `duplicate_status` usa
`no_match`, que ya existe.

## 5. Datos personales

* La URL no aparece en el chat: el mensaje del usuario se muestra como «Perfil de LinkedIn
  enviado.» y la vista previa no la incluye.
* No va en logs ni en `provider_usage_logs` (prueba estática). Un error inesperado devuelve un
  mensaje genérico, nunca el texto crudo.
* Sólo se guarda en el candidato (`linkedin_url`), igual que los candidatos de Apollo y Lusha.
* La deduplicación es global (cualquier cuenta) pero sólo dice nombre y empresa del contacto que
  ya existe; no abre su ficha.
* Los tests usan URLs, nombres y correos ficticios.

## 6. Criterios de aceptación

1. Con la bandera apagada no aparece el botón y las acciones responden «no activada» sin leer ni
   llamar a nadie.
2. Una URL de empresa muestra «es una página de empresa…» y no gasta.
3. Un perfil que ya es contacto o candidato pendiente en SellUp no llama a Apollo ni a Lusha.
4. Apollo con correo no llama a Lusha; Apollo sin datos llama a Lusha; los dos registran su gasto.
5. «No encontramos datos para este perfil» ≠ error del proveedor (con «Reintentar»).
6. El correo encontrado que ya existe en SellUp o HubSpot no crea candidato.
7. No se crea un candidato sin empresa elegida (ni con una empresa «manual»).
8. El run nace con `account_id`; sin cuenta resuelta no se crea el run.
9. Si la empresa elegida no coincide con la del proveedor, se avisa y se guarda `possible_mismatch`.
10. Al aprobar, el POST a HubSpot lleva `hs_linkedin_url` y reintenta sin él ante un 400.
11. La URL no aparece en el chat, en los logs ni en el uso de proveedores.

## 7. Tests (gate `test:agent2a:linkedin-contact-search`)

| Archivo | Cubre |
|---|---|
| `linkedin-profile-url.test.ts` | Normalización (subdominio, parámetros, barra, tildes) y rechazos |
| `linkedin-preview-token.test.ts` | Firma, manipulación, otro usuario, caducidad |
| `linkedin-contact-search-core.test.ts` | Duplicado sin proveedores; Apollo→Lusha; no encontrado vs error; correo existente; sin empresa no hay candidato; run con `account_id`; consistencia |
| `linkedin-contact-search-providers.test.ts` | Parámetros exactos de Apollo y Lusha, sin teléfono; gasto por llamada |
| `linkedin-contact-hubspot-create.test.ts` | Candidato → contacto → `hs_linkedin_url` en el POST y reintento ante 400 |
| `linkedin-contact-search-privacy-static.test.ts` | Sin `console.*`; el uso de proveedores no lleva la URL |
| `contact-enrichment-linkedin-search-runtime.test.tsx` | El chat no repite la URL; vista previa; empresa obligatoria; «Reintentar» |

## 8. Fuera de alcance / riesgos

* **C2 / decisión 1:** un candidato sin correo se puede aprobar pero no llega a HubSpot
  (`blocked_no_email`), como cualquier otro.
* El correo se compara contra HubSpot **después** de gastar: el gasto de ese caso queda.
* La empresa del contacto que ya existe en HubSpot por correo no se muestra (haría falta leer
  sus asociaciones).

## 9. Pendiente (BACKLOG F2-b)

* **Deduplicar en HubSpot por la URL antes de gastar.** `hs_linkedin_url` es la única propiedad
  de contacto que sirve y HubSpot guarda la URL en formatos distintos, así que hay que
  normalizarla en los dos lados (la misma `linkedinProfileKey`). La búsqueda del CRM no
  normaliza: opciones evaluadas en la conversación del 2026-10-26 (`IN` con variantes exactas en
  minúsculas, `CONTAINS_TOKEN` con el slug —su tokenización no está documentada y hay que
  probarla con HubSpot real, con autorización—, y verificación de cada resultado con la clave).
* **Decisión 2:** asociar un contacto existente a otra empresa. Hoy sólo se muestra.
