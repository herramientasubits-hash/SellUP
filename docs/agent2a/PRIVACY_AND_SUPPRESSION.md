# Agente 2A — Privacidad, DSAR y supresión

> Fuente: `phone-reveal-privacy-gate.ts`, `provider-suppression-core.ts`,
> `provider-suppression-store.ts`, `phone-reveal-suppression-guard.ts`,
> `phone-reveal-suppression-audit.ts`, migraciones 112, 113, 115, 120.

---

## 1. La filosofía: fail-closed, y una frase que lo resume

> **«No pude confirmar que NO está suprimido» nunca equivale a «no está suprimido».**

Todo el endurecimiento de privacidad de este subsistema es una consecuencia de esa frase. Antes
del PR #289 una comprobación no evaluable se traducía a `clear` y la llamada al proveedor salía
igual. Hoy bloquea.

---

## 2. Las tres respuestas, y por qué no se colapsan

| Estado | Qué afirma | Efecto |
|---|---|---|
| `blocked_suppressed` | Hay un **tombstone confirmado** para esta persona/número | Bloquea |
| `do_not_contact` | La persona está marcada DNC (detectable por email o LinkedIn) | Bloquea |
| `suppression_check_unavailable` | **No se pudo evaluar.** No se sabe nada | Bloquea |

Las tres bloquean igual, con 0 créditos. Lo que cambia no es el efecto: es **lo que se afirma en
el registro**. Convertir «no pude verificar» en «esta persona está suprimida» sería registrar un
hecho que nadie comprobó, y la auditoría no puede convertir lo primero en lo segundo.

### Precedencia (determinista y documentada)

```
check_unavailable   ⟵ cualquier fallo de lectura, en cualquier punto
do_not_contact      ⟵ se evalúa ANTES que la supresión
blocked_suppressed
clear
```

El orden `do_not_contact` → supresión se conserva a propósito: cambiarlo alteraría la etiqueta
que la corrida registra hoy sin cambiar ni una decisión. Lo que importa del orden no es cuál
gana, sino que sea **siempre el mismo**: dos actores que evalúan al mismo candidato obtienen la
misma razón.

### `not_evaluable` → `check_unavailable`

Sin clave no hay tombstone que emparejar, y eso **nunca** se resuelve por inferencia ni por
matching difuso (teléfono, email, nombre, LinkedIn). Un candidato sin clave Apollo resoluble es,
en la práctica, el caso típico de **un candidato de origen Lusha** — exactamente el que un
tombstone real no podía alcanzar por falta de clave. Antes de #289 ese candidato pasaba como
`clear` y Lusha se llamaba igual.

---

## 3. Supresión nativa del proveedor (Fase 1 — migración 120)

### 3.1 La clave vieja, y sus tres consecuencias equivocadas

Hasta la Fase 1 la privacidad se evaluaba con la clave de la **caché**:

```
(provider = 'apollo', provider_person_id, account_id)
```

Esa clave nunca se diseñó para privacidad. Es la clave de **reutilización**: la cuenta está
dentro porque un teléfono pagado por una cuenta no debe servirse a otra, y el proveedor está
fijado a `apollo` por un CHECK porque la caché sólo guardó reveals de Apollo. La privacidad
heredó esa forma por historia, no por diseño, y con ella heredó:

* **sin cuenta no había clave** ⇒ desde #289 el reveal se bloquea fail-closed y desde #291 el
  botón se deshabilita con honestidad. Correcto, pero convertía en inalcanzable todo el producto
  de pre-aprobación;
* **un candidato de origen Lusha no podía llevar clave alguna** ⇒ la supresión de un titular de
  Lusha no era «no soportada»: era **inexpresable**;
* **la supresión moría con la cuenta** (`ON DELETE CASCADE`) ⇒ borrar una cuenta borraba la
  propia constancia del borrado.

### 3.2 El modelo nuevo

`provider_suppressions (provider, provider_person_id, …)` — identidad **nativa del proveedor**,
**independiente de la cuenta** y **durable**.

* `provider` ∈ {`apollo`, `lusha`}: allowlist cerrada, espejo exacto del CHECK de la 120. Un
  tercer proveedor llega con su propia migración y su propio validador de identidad, nunca
  escribiendo un string nuevo.
* Las dos partes de la identidad van **siempre juntas**: `providerPersonId` no significa nada por
  sí solo, sólo tiene sentido dentro del espacio de nombres de su proveedor. Un id de Apollo y
  uno de Lusha nunca se comparan, ni se traducen, ni se normalizan a una forma común.
* `provider-suppression-core.ts` es **puro**; el acceso a la tabla vive en
  `provider-suppression-store.ts`; la composición con el modelo legacy en
  `phone-reveal-suppression-guard.ts`.

### 3.3 El límite que no se puede maquillar

> Esto **no** es un sujeto de privacidad **global** entre proveedores.

Una supresión de Apollo garantiza bloqueo en Apollo; una de Lusha, en Lusha. **Nada** deduce que
la persona Apollo X y el contacto Lusha Y sean el mismo humano: no se mira LinkedIn, ni email, ni
nombre, ni empresa, ni dominio, ni se hace matching difuso.

Ese sujeto compartido —`privacy_subjects` + alias por proveedor + hash de LinkedIn— es **Fase 2**
y está **deliberadamente ausente**. Afirmar lo contrario sería el peor error posible en un
subsistema de privacidad: prometer una garantía que el esquema no puede cumplir.

**Estado:** Fase 1 implementada (mig 120 aplicada en Producción, `20260818211334`).
Fase 2 **no implementada**. Ver [FUTURE_WORK.md](FUTURE_WORK.md).

---

## 4. Dónde se comprueba la privacidad — y por qué en más de un sitio

Hay **dos** comprobaciones y ninguna hace redundante a la otra.

### 4.1 Antes de la llamada — `checkPhoneRevealPrivacyGate`

Corre **antes** de la llamada al proveedor, así que su efecto es 0 llamadas y 0 créditos.

Existe como módulo propio porque antes vivía dentro de `phone-reveal-waterfall-deps.ts` y por
tanto **sólo la aplicaba el waterfall**. El disparo **manual** de Lusha llamaba al proveedor sin
consultar ninguna de las dos cosas: una persona con DSAR registrada, o marcada `do_not_contact`,
se podía revelar igualmente, pagando el crédito. Se extrajo **sin cambios de comportamiento**
para que los dos caminos ejecuten **la misma función**.

> No es una segunda puerta con las mismas reglas escritas dos veces: **es la misma puerta**. Esa
> es toda la diferencia entre «los dos caminos deberían coincidir» y «los dos caminos no pueden
> divergir».

No escribe nada: ni candidato, ni caché, ni contacto, ni HubSpot. No lee flags.

### 4.2 Dentro de la transacción — migración 113

Las migraciones 110 y 111 ya re-comprobaban, bajo el lock del candidato, los tombstones de los
**números** que trae el evento. Eso dejaba fuera el caso que importa: **una DSAR borra una
PERSONA**, y lo que tombstonea son los números que la colección **ya tenía**. Un número que el
proveedor no había devuelto nunca no tiene tombstone que emparejar, así que la comprobación por
número lo dejaba pasar y **la persona borrada volvía a tener teléfono visible minutos después de
la supresión**.

La comprobación **por persona** existía sólo en TypeScript, y allí se lee **antes** de la llamada
al proveedor — es decir, antes de la ventana de carrera real. La 113 la mete **dentro** de la
transacción de persistencia.

Una supresión que se registre **después** de la lectura del gate la para la **transacción**, no
el gate. Ambas son necesarias.

---

## 5. Borrado (DSAR)

### 5.1 Borrado del candidato

La DSAR (`phone-cache-suppression-actions.ts`) borra un teléfono de cinco sitios:

1. la fila de la caché (tombstone),
2. `contact_enrichment_candidates.phone`,
3. el bloque `phone` de `enrichment_metadata` de ese candidato,
4. las filas de `contacts` cuya procedencia prueba que salieron de uno de esos candidatos,
5. **la colección `contact_enrichment_candidate_phones`** — el quinto sitio que la migración 109
   creó y del que nada informaba a la DSAR, hasta la **migración 112**.

La 112 además **re-elige el principal atómicamente**: suprimir el `is_primary` no puede dejar al
candidato sin principal.

### 5.2 Borrado del contacto oficial — migración 115

Aquí la unidad de borrado es la **procedencia**, no el número.

Un número oficial puede estar sostenido por Apollo **y** por Lusha a la vez. Borrar «lo que
Apollo aportó» retira la **procedencia de Apollo**; el número sólo se tumba cuando **no le queda
ninguna procedencia viva**. Ése es exactamente el defecto que cerró el PR #269: borrar Apollo
mataba el número que Lusha sostenía legítimamente.

El PR #250 añadió el caso simétrico: un teléfono **móvil sin procedencia** no se destruye durante
un borrado por proveedor, porque no hay evidencia de que ese proveedor lo trajera.

La 115 llegó **antes** que la 116 a propósito: la 116 permite que la aprobación **escriba** esas
tablas, y una colección que se puede escribir pero no borrar es una colección que **no puede
honrar una DSAR**. Así que la privacidad aterrizó primero, mientras ambas tablas estaban vacías
en todos los entornos y la operación era demostrablemente inerte.

---

## 6. Protección de carreras en vuelo

| Carrera | Protección |
|---|---|
| DSAR registrada entre el preflight y el clic | El runtime **re-resuelve** la privacidad después de crear la corrida (paso 3 de la secuencia) |
| DSAR registrada entre el gate y la respuesta del proveedor | Recheck **por persona** dentro de la transacción (mig 113) |
| DSAR sobre un número que el proveedor acaba de devolver | Recheck **por número** dentro de la transacción (mig 110/111) |
| Supresión durante un `search_more` | `append_candidate_search_more_phones` re-comprueba bajo el lock; **el número se retiene y el costo se conserva entero** |

> El último punto es importante y contraintuitivo: si la privacidad bloquea **después** de que
> el proveedor cobró, el costo **no** se borra. Se pagó de verdad. El ledger dice la verdad
> aunque el dato no se guarde.

---

## 7. Auditoría

* `provider_suppression_audit` (mig 120): `provider`, `provider_person_id_hash`, `operation`,
  `result`, `reason_code`, `origin`, `actor_user_id`, `metadata`. **PII-free**: guarda el hash,
  nunca el id crudo.
* `phone_reveal_suppression_audit` (mig 099): auditoría de la DSAR legacy, con contadores de
  filas afectadas (`candidates_cleared`, `contacts_cleared`, `cache_rows_suppressed`,
  `candidate_phone_rows_suppressed`, `official_phone_sources_suppressed`,
  `official_phone_rows_tombstoned`).

Ningún log de este subsistema imprime teléfono, email, nombre, LinkedIn, id de contacto de
proveedor ni API key. Sólo códigos mecánicos y el mensaje recortado del driver
(`redactDriverMessage`).

---

## 8. Estado en Producción (2026-08-19)

| | |
|---|---|
| `provider_suppressions` | 0 filas |
| `provider_suppression_audit` | 0 filas |
| `phone_reveal_cache` | 5 filas |
| Teléfonos de candidato suprimidos | 0 de 6 |

Cero supresiones registradas significa que el camino de DSAR **no se ha ejercitado en
Producción**. El camino está implementado y probado (suites `*-suppression-postgres-*` contra
PostgreSQL real), pero no tiene evidencia de producción. Ver [QA_ACCEPTANCE.md](QA_ACCEPTANCE.md)
§ «Lo que NO tiene evidencia de Producción».
