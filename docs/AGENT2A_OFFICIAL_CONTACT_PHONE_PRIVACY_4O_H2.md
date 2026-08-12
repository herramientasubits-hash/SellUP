# AGENT2A-PHONE-REVEAL-4O-H2 — Privacidad del modelo oficial de múltiples teléfonos

**Estado:** implementado, PR abierto. Migración **115 NO aplicada en Producción**.
**Base:** `origin/main` incluyendo #261 (4O-H1, migración 114 aplicada).
**Alcance:** borrado por proveedor sobre `contact_phones` / `contact_phone_sources`, ANTES de que
H3 permita que la aprobación escriba en ellas.

---

## 1. Por qué la privacidad va antes que la escritura

H1 creó el par de tablas oficiales y no cableó nada. Dejó deliberadamente para H2 la única
operación que las borra. El orden no es cosmético: **una colección que se puede escribir pero no
borrar es una colección que no puede honrar una DSAR.** H3 va a abrir la escritura; si la
privacidad llegara después, existiría una ventana en la que un número pagado sobre una persona
que pidió su borrado no tendría forma de desaparecer.

## 2. El contrato

```text
Apollo y Lusha justifican el MISMO número
  → borrado de Apollo
      → se retira SÓLO la procedencia de Apollo
      → la de Lusha sigue viva
      → el número canónico sigue vivo, y NADA se borra
  → más tarde, borrado de Lusha
      → cae la última procedencia viva
      → el canónico pasa a TOMBSTONE
      → si era el principal, se reelige uno determinista
      → la proyección heredada `contacts.phone` se re-sincroniza en la MISMA transacción
```

## 3. Las tres decisiones que definen el hito

### 3.1 La suprimibilidad se **deriva**, no se inventa

La procedencia oficial es un **par** `(provider, acquisition_mode)`. El escalar heredado
`contacts.phone_source` es una sola cadena fusionada, y 4O-E4 ya decidió y fijó en pruebas qué
valores de esa cadena puede destruir un borrado: `SUPPRESSIBLE_CONTACT_PHONE_SOURCES` =
`{apollo_reveal, apollo_cache, lusha_reveal}`. La migración 112 ya posee la traducción exhaustiva
y sin pérdida del par a la cadena. H2 **no escribe una segunda autoridad**; compone las dos:

```text
suprimible(par) ⇔ deriveLegacyPhoneSource(par) ∈ SUPPRESSIBLE_CONTACT_PHONE_SOURCES
```

Aplicado a los 25 pares representables:

| par | escalar derivado | ¿suprimible? |
|---|---|---|
| `(apollo, reveal)` | `apollo_reveal` | ✅ |
| `(apollo, waterfall)` | `apollo_reveal` | ✅ |
| `(apollo_cache, *)` | `apollo_cache` | ✅ |
| `(lusha, *)` | `lusha_reveal` | ✅ |
| `(apollo, search)` | `apollo_search` | ❌ protegido |
| `(apollo, cache \| manual)` | `unknown` | ❌ protegido |
| `(manual, *)` | `manual` | ❌ protegido |
| `(unknown, *)` | `unknown` | ❌ protegido |

Tres consecuencias **declaradas** y fijadas por pruebas:

- **`manual` sobrevive** a un borrado de Apollo Y a uno de Lusha. Una DSAR dirigida a un proveedor
  no tiene autoridad sobre evidencia que escribió una persona («FIX M1» de 4O-E4).
- **`unknown` sobrevive.** Una supresión por proveedor no puede *afirmar* que una procedencia sin
  atribuir era de Apollo. Para una autoridad de borrado, fail-closed es borrar **menos**.
- **`(apollo, search)` sobrevive a un borrado de Apollo.** El contrato heredado nunca autorizó
  destruir un escalar `apollo_search`; ensanchar el radio de camino al modelo oficial sería
  inventarse una autoridad que nadie concedió. Si se revisa, se revisa en **un** sitio.

### 3.2 La DSAR cableada tiene alcance de **persona**, no de proveedor

El único punto de entrada cableado (`suppressPhoneCacheEntryAction`) está indexado por un
`apollo_person_id`, y es tentador leerlo como «un borrado de Apollo». **No lo es.** El id de
Apollo es la *clave de caché* — identifica **qué persona** — y lo que la operación borra ya cruza
proveedores hoy: tombstonea la colección entera del candidato (`all_candidate_phones`) y limpia un
`contacts` cuya procedencia es `lusha_reveal`.

Así que el llamador pasa `all_suppressible_providers`. Cablearlo a `single_provider = apollo`
habría sido una **regresión de privacidad disfrazada de precisión**: la procedencia de Lusha
seguiría viva, el número canónico seguiría vivo, y el escalar heredado quedaría limpio a su lado.

`single_provider` está implementado, concedido y probado, pero **sin llamador cableado** — igual
que el alcance `exact_phone` de la 112. Es la forma correcta de las dos operaciones que vienen
después: una retractación de proveedor y una petición de borrado por proveedor.

### 3.3 La proyección del escalar está **acotada** a colecciones existentes

`contacts.phone` **no** se deriva hoy de `contact_phones`: H1 es inerte y ambas tablas están
vacías en todos los entornos. Una función que reproyectara el escalar sin condición calcularía
«no hay principal vivo» para **todo** contacto y nularía un teléfono heredado sobre el que el
modelo oficial nunca tuvo opinión — convirtiendo privacidad en **pérdida de datos** y saltándose
la allowlist que 4O-E4 existe para imponer.

Por eso la función **rechaza la operación entera, sin escribir nada**, cuando el contacto no tiene
ninguna fila en `contact_phones` (`status = 'no_official_collection'`). En Producción hoy eso es
**todo** contacto, y es exactamente lo que hace de este hito un no-op demostrable.

Además, dentro de la transacción, si `contacts.phone_source` está fuera de la allowlist heredada
la tupla se deja **enteramente** intacta: ni limpiada, ni sobrescrita con el número del proveedor.
Sobrescribir un número manual lo destruiría igual de bien que nularlo.

## 4. La RPC

`public.suppress_official_contact_phone_sources(uuid, text, text, text, text, uuid, timestamptz)`

Una transacción, siete pasos:

| # | paso |
|---|---|
| 0 | validar — fail closed antes de CUALQUIER escritura (9 rechazos mecánicos) |
| 1 | bloquear el contacto, luego sus filas canónicas en orden de `id` |
| 2 | rechazar si no hay colección oficial (el no-op de Producción) |
| 3 | retirar las procedencias VIVAS y SUPRIMIBLES en alcance |
| 4 | tombstonear cada canónico que se quedó sin procedencia viva (`NOT EXISTS`) |
| 5 | reelegir principal **sólo** si el titular dejó de estar vivo |
| 6 | reproyectar la tupla escalar heredada, bajo la allowlist |
| 7 | devolver un sobre PII-free de conteos, banderas y estado |

### `SECURITY INVOKER`, y por qué es el argumento de seguridad entero

La función corre bajo el techo de privilegios de la 114, así que **no puede**:

- borrar una fila de `contact_phones` — nadie tiene DELETE, y borrar un tombstone desbloquearía el
  número: la siguiente observación lo reinsertaría como si nada;
- borrar una fila de `contact_phone_sources` — evidencia destruida en la operación que más
  necesita ser auditable después;
- reescribir procedencia — `service_role` tiene UPDATE sobre **exactamente tres columnas**
  (`suppressed_at`, `suppression_reason`, `suppressed_by`), así que `provider`,
  `acquisition_mode`, las etiquetas crudas, los tres punteros de contabilidad,
  `candidate_phone_id`, `source_event_key`, `observed_at` y `created_at` son inmutables
  **por privilegio**, no por intención.

Un `SECURITY DEFINER` propiedad de `postgres` se regalaría las tres cosas, en la única operación
cuyo propósito entero es el borrado.

### Reelección determinista

```text
1. TIER MANUAL     — una procedencia `manual` viva gana de calle
2. mejor PhoneType — ranking de la 112, sin cambios
3. `valid` > `unknown`
4. procedencia más específica (reveal > cache > search)
5. `last_seen_at` DESC
6. `dedupe_key` ASC — NOT NULL y única por contacto ⇒ comparador TOTAL
```

`manual` es un **tier previo** y no una rung de la escalera: un `work` manual tiene que ganar a un
`personal_mobile` de proveedor, y ninguna reordenación de una sola escalera puede expresar eso.
El paso 6 es lo que impide que «reelección determinista» signifique «lo que devolviera el
planificador ese día».

**Estabilidad del titular:** H2 sólo cambia el principal cuando el titular deja de estar vivo. Un
borrado no debe reordenar una colección que no borró.

## 5. El orden del cableado, y por qué el hito es aditivo

```text
tombstone de caché → candidato → escalar heredado (2d) → colección OFICIAL (2e) → auditoría
```

Con 2d primero, el borrado heredado ocurre **exactamente como hoy** —mismo patch, mismo
predicado, mismos conteos— y la 115 encuentra `phone_source = NULL`, que no está en la allowlist,
así que su guarda lo deja intacto. **E1–E4.1 no cambian de comportamiento en una sola fila.**

Al revés, la reproyección oficial escribiría el escalar y el `.eq('phone_source', observado)` de
2d casaría 0 filas, dejando `contacts_cleared = 0` en la auditoría sobre un escalar que sí se
limpió — es decir, el modelo oficial pasaría a ser autoritativo sobre el escalar **antes** de que
H3 lo poblara y H4 lo leyera.

**Consecuencia declarada:** en el camino cableado la reproyección de la 115 casi siempre queda
guardada. La propiedad «un escalar nunca afirma una procedencia retirada» (Apollo → Lusha en la
misma transacción) vive en la RPC y se mide contra PostgreSQL real, no en la acción. Es
infraestructura para H3/H4.

### El alcance oficial es más ancho que el del escalar

`plan.officialContactTargets` filtra sólo por **cuenta + procedencia probada**
(`metadata.source_candidate_id`), sin consultar la allowlist de `phone_source`. Esa allowlist
protege el **escalar** y no autoriza la colección oficial: un contacto con `phone_source='manual'`
puede tener filas oficiales de Apollo ya pagadas, y excluirlo las dejaría vivas sobre el titular
de la DSAR sólo porque alguien había teclado además un número a mano. **Ese era el hueco.**

## 6. Auditoría

Dos columnas nuevas en `phone_reveal_suppression_audit` (aditivas, `NOT NULL DEFAULT 0`, CHECK
`>= 0`, bajo guarda de `pg_constraint`):

- `official_phone_sources_suppressed`
- `official_phone_rows_tombstoned`

Dos y no una porque **pueden discrepar legítimamente**, y esa desigualdad *es* la huella auditable
de la supervivencia cruzada: retirar tres procedencias que dejan viva una cuarta tombstonea cero
números. Más cuatro claves en `metadata`: `official_phone_contacts_targeted`,
`official_phone_survivor_count`, `official_phone_primary_changed` y
`official_phone_scalar_guarded` (esta última hace auditable la protección de «FIX M1»).

Los grants de la 107 **no** se restablecen: la tabla sigue siendo append-only.

## 7. Verificación

| suite | resultado |
|---|---|
| `test:agent2a:official-contact-phone-privacy` (core + static + runtime) | **120 pass / 0 fail** |
| `test:agent2a:official-contact-phone-privacy:postgres` (PostgreSQL 17.6 real) | **65 pass / 0 fail** |
| Barrido completo `test:agent2a:*` (73 suites) | **70 pass**, 3 fallos **pre-existentes en `origin/main`** |
| `typecheck` / `build` | limpios |
| `lint` | **idéntico al baseline** (573 problemas / 68 errores / 505 warnings) |

Los 3 fallos pre-existentes (`phone-reveal-scaffold`, `phone-reveal-schema`, `phone-cache`) se
verificaron con `git stash -u` sobre `origin/main` limpio: fallan igual sin este hito.

### Mutantes ejecutados (12), todos detectados

retirar `manual`; retirar `unknown`; quitar el `NOT EXISTS` del último origen; quitar la guarda de
colección vacía; quitar la guarda de procedencia del escalar; perder la estabilidad del titular;
dejar de filtrar fuentes vivas en la proyección; quitar el tier manual; quitar los locks; quitar
el `WHERE suppressed_at IS NULL` (idempotencia); escribir `mobile_phone` en SQL ejecutable;
ensanchar un GRANT de la 114.

> **Hallazgo sobre el propio diseño:** los dos `FOR UPDATE` (contacto y filas canónicas) son
> **redundantes entre sí** para la fuga «número vivo sin procedencia»: quitando sólo uno, la
> segunda transacción se bloquea en el otro. El mutante honesto tuvo que quitar **ambos**. Que
> sean redundantes no los hace superfluos — el del contacto serializa además la reproyección del
> escalar y cubre el camino sin colección oficial, donde no hay fila canónica que bloquear.

### Guardas RATCHET actualizadas

La migración 115 rompe las guardas de techo de **9 suites hermanas** (el mismo efecto que tuvo la
114). Todas se **estrecharon**, ninguna se borró: los máximos exactos y las listas enumeradas de
migraciones siguen siendo exactos. Dos merecen mención:

- **`ninguna migración escribe mobile_phone`** ahora lee SQL **estructural** (sin comentarios y
  sin los `COMMENT ON … IS '…'`), porque la 115 nombra la columna sólo para documentar que **no**
  la toca. Verificado por manipulación: una escritura ejecutable sigue fallando la guarda.
- **La inercia de H1** (`ningún archivo de producción nombra las tablas oficiales`) pasó de
  `[]` a una **allowlist explícita de 3 archivos**, todos del camino de privacidad y todos
  obligados a declarar `4O-H2`. La aprobación, `createContact`, `updateContact`, «Buscar más
  números» y la UI siguen sin poder nombrarlas — verificado por manipulación.

## 8. Seguridad de la ejecución

```text
escrituras en Producción       0     llamadas a Apollo      0
lecturas de Producción         0     llamadas a Lusha       0
DSAR reales                    0     créditos               0
migración aplicada en Prod    NO     escrituras HubSpot     0
backfill                       0     flags nuevos           0
filas insertadas por la 115    0     cambios de UI          0
PII impresa                    0
```

Todo se midió contra PostgreSQL 17.6 efímero y local con fixtures sintéticos `555`. No se insertó
ni una fila de fixture en Producción.

## 9. Fuera de alcance (sigue abierto)

| deuda | estado |
|---|---|
| **H3** — propagación de la aprobación a la colección oficial | no iniciado |
| **H4** — lectura oficial en la UI («Ver más números» oficial) | no iniciado |
| **H5** — convergencia del escritor manual | no iniciado |
| «Buscar más números» | no iniciado |
| `mobile_phone` sin columna de procedencia | `MOBILE_PHONE_PROVENANCE_PENDING`, intacto |
| `phone_confidence` columna muerta | H2 **no** la resucita; se limpia, nunca se fabrica |
| Procedencias `manual` históricas con `phone_source` NULL | sin backfill |
| Encabezados de migración obsoletos («APPLIED IN PRODUCTION: NO») | 113 y 114 siguen desfasados |

## 10. Lo que falta para cerrar

1. Merge del PR (exige `"MERGE APROBADO"`).
2. Aplicar la migración 115 en Producción — **autorización aparte y explícita**, posterior al
   merge. Mientras no se aplique, la RPC no existe en Prod y el camino de privacidad falla con
   `official_phone_suppression_failed` si alguna vez se invocara (hoy no tiene llamador de UI).
3. Sólo entonces, H3.
