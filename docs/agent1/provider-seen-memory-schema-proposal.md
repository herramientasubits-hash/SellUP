# Memoria provider-seen — arqueología de esquema y propuesta mínima

**Hito:** AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 · ADDENDUM PROVIDER-SEEN
· **AGENT1-PROVIDER-SEEN-MEMORY-2**
**Estado:** **1 migración ESCRITA (`123_provider_seen_entities.sql`) · 0 migraciones
aplicadas · runtime todavía NO-OP.**
**Fecha de la auditoría:** 2026-08-20, Producción `lrdruowtadwbdulndlph`, **sólo lectura**.

§ 13 del addendum ordenó parar y reportar antes de improvisar una migración. Ese reporte
—las secciones 1 y 2 de este documento, sin un cambio— se entregó, y la dueña autorizó
**escribirla**. Sigue prohibido aplicarla y sigue prohibido encender el runtime.

> **Qué cambió respecto de la versión anterior de este documento.** La propuesta decía
> «unicidad por señal, dos índices parciales» sin resolver qué pasa en los casos límite.
> La sección 3.1 los resuelve uno a uno, y **dos de las respuestas obligaron a cambiar el
> código que ya existía**: el dominio ahora AVANZA en vez de congelarse en el primero, y
> una identidad repetida dentro de una misma página completa el dominio en vez de
> descartarse entera. Ambos cambios se hicieron ANTES de congelar el SQL, que es el orden
> que § 2 del encargo exige.

---

## 1. La pregunta

¿Existe hoy en el esquema una autoridad capaz de responder *«este proveedor de pago
ya me mostró esta empresa»* para una empresa que **no** llegó a persistirse como
`prospect_candidate`?

**No.** Y la forma del agujero es la peor posible: recordamos exactamente lo que no
hacía falta recordar.

---

## 2. Lo que se auditó, y por qué cada candidato queda descartado

| Tabla | Qué guarda | Por qué NO sirve |
|---|---|---|
| `prospect_candidates` | 63 columnas; **ninguna** de id de proveedor | El id de Lusha vive en `source_trace->>'providerCompanyId'` y **sólo si el candidato se persistió**. Medido: **66/66** candidatos `source_primary='lusha'` lo llevan; **0/10** de Apollo llevan su Organization ID. La huella existe justo para las empresas que ya tenemos |
| `provider_suppressions` | única `(provider, provider_person_id)` | Autoridad de **privacidad** sobre **personas**. Reutilizarla para economía de empresas repetiría el defecto que corrigió #295: usar una clave de gasto como clave de privacidad |
| `provider_usage_logs` | **una fila agregada por corrida** (#307) | No tiene —ni debe tener— identidad por empresa. Es observabilidad de gasto |
| `source_company_snapshots` · `source_company_signals` | fuentes **oficiales** por país (`source_key`, `tax_id`, `raw_data`) | No modelan un registro de proveedor de pago. Meter Lusha ahí falsearía su semántica |
| `provider_industry_raw_label_observations` | `provider_key` + clave normalizada + `first/last_observed_at` + `first/last_observed_run_id`, upsert por observación | **Precedente de diseño, no autoridad**: guarda etiquetas de industria, no identidad de empresa. La tabla propuesta abajo copia deliberadamente su forma |

### 2.1 Lo que sí existe en runtime y hoy se tira

Los dos proveedores **ya traen** identidad nativa antes de cualquier filtro:

- Lusha — `LushaPreviewCompany.providerCompanyId` (forma observada: `v1.<token>`).
- Apollo — `ApolloProviderReference.providerOrganizationId`, en el normalizador de
  respuesta.

Es decir: la información existe en memoria en cada corrida y se descarta. No hace
falta pedir nada nuevo a ningún proveedor para poblar la memoria.

---

## 3. La tabla, tal como quedó escrita (NO aplicada)

Una tabla, provider-neutral, con las columnas que § 4 enumera y ni una más.

```
provider_seen_entities
  id                        uuid        PK
  provider                  text        NOT NULL   -- 'lusha' | 'apollo'
  provider_entity_type      text        NOT NULL   -- 'company' (hoy el único)
  provider_entity_id        text        NULL       -- id nativo, tal cual lo emitió
  normalized_domain         text        NULL       -- normalizado como la lista de exclusión
  first_seen_at             timestamptz NOT NULL
  last_seen_at              timestamptz NOT NULL
  first_seen_correlation    text        NULL       -- wizard_run_id de la primera vez
  last_seen_correlation     text        NULL       -- wizard_run_id de la más reciente
```

**Invariantes que la tabla hace cumplir, en vez de confiar:**

1. `CHECK (provider_entity_id IS NOT NULL OR normalized_domain IS NOT NULL)` — una
   fila sin ninguna de las dos señales no recuerda nada: ocuparía cupo sin poder
   coincidir jamás.
2. Unicidad **por señal, nunca combinada**: un índice único parcial sobre
   `(provider, provider_entity_type, provider_entity_id)` cuando el id no es nulo, y
   otro sobre `(provider, provider_entity_type, normalized_domain)` cuando el id es
   nulo. 🔴 Una única clave `(id, dominio)` supondría semántica combinada, que § 5
   prohíbe mientras el contrato humano de Lusha no llegue.
3. `first_seen_*` y las columnas de identidad, **inmutables por TRIGGER** — no por
   convenio del escritor. El trigger **fija** en vez de lanzar: una escritura de memoria
   no puede tumbar la corrida a la que pertenece.
4. Vocabulario **fail-closed** por CHECK: `provider IN ('lusha','apollo')` y
   `provider_entity_type IN ('company')`. Una fuente gratuita (`co_siis`, `co_rues`),
   HubSpot o un fixture no pueden entrar en la memoria de lo pagado.
5. El dominio se guarda **normalizado por `normalizeExclusionDomain`** —el mismo con el
   que viaja al proveedor— y un CHECK espeja ese formato (minúsculas, sin esquema, sin
   `www.`, con TLD). La autoridad de normalización sigue siendo el TypeScript; el CHECK
   sólo impide **deshacerla**, porque un dominio guardado con el normalizador laxo no
   coincidiría nunca con uno enviado y la memoria sería inerte **sin que nada fallara**.
6. RLS `service_role` únicamente **y REVOKE explícito**. 🔴 Habilitar RLS NO basta: en
   Supabase la tabla nace con los 8 privilegios para `anon`, `authenticated` y
   `service_role` por `ALTER DEFAULT PRIVILEGES`, y `GRANT` sólo SUMA. Se revoca todo y
   se enumera. `service_role` conserva SELECT, INSERT y UPDATE — **nunca DELETE**:
   borrar una fila de memoria vuelve a hacernos pagar esa empresa en silencio.
7. `CHECK (last_seen_at >= first_seen_at)`. No se puede violar por el camino sancionado
   —el upsert sólo mueve `last_seen_at` hacia delante con `GREATEST`— y sí atrapa un
   `UPDATE` directo.

### 3.1 Semántica de identidad: los cinco casos, resueltos

La escritura vive ENTERA en `record_provider_seen_entities`, y no en un `upsert()` de
cliente, por una razón que no es de estilo: con dos índices únicos parciales hay **dos
destinos de conflicto**, y PostgREST no sabe expresar ni un destino parcial ni la mezcla
ordenada de abajo. Partir esa lógica entre SQL y TypeScript es exactamente cómo un
esquema y su cliente acaban con dos ideas distintas de qué es la misma empresa.

**La clave de conflicto es la señal más fuerte disponible:** el id nativo cuando el
proveedor lo dio, el dominio sólo cuando no lo dio.

| Caso | Observaciones | Resultado | Por qué |
|---|---|---|---|
| **A** | `(null, acme.com)` → `(id-123, acme.com)` | **2 filas** | Fusionarlas exigiría afirmar que un dominio identifica una entidad — justo lo que el caso C prohíbe. No se pierde nada: la memoria une las dos señales en conjuntos independientes y `isProviderSeenKnown` acierta por cualquiera de ellas |
| **B** | `(id-123, old.com)` → `(id-123, new.com)` | **1 fila**; `first_seen_*` intacto; dominio → `new.com` | Congelar el primero haría que la fila afirmara un emparejamiento que el proveedor **dejó de emitir**, mientras `last_seen_at` la presenta como fresca |
| **C** | `(id-123, shared.com)` + `(id-456, shared.com)` | **2 filas** | Sí, dos ids nativos distintos pueden compartir dominio (un grupo y su filial). Una unicidad global por dominio colapsaría entidades legítimamente distintas y la memoria diría «ya la vi» de una empresa que nunca vio |
| **D** | `(id-123, null)` → `(id-123, acme.com)` | **1 fila**; dominio COMPLETADO; `first_seen_*` intacto | Completar donde no había nada no pierde nada. Y el simétrico: un nulo posterior **nunca borra** — la ausencia de observación no es observación de ausencia |
| **E** | la misma observación, concurrente | **1 fila**, sin excepción visible | `ON CONFLICT ... DO UPDATE` por rama, y el lote se **colapsa por clave de conflicto antes** del INSERT: sin eso, una identidad repetida en la misma página produce `cannot affect row a second time`, que es un error visible causado por algo completamente normal |

**La regla del dominio, dicha una sola vez** (y escrita dos veces —SQL y doble en
memoria— porque hay dos implementaciones del puerto, no dos reglas):

> un nulo nunca borra · un dominio que llega donde no había nada completa, aunque sea
> más viejo · entre dos no nulos gana el que no sea más viejo, y los empates de instante
> se rompen por orden de llegada.

**Determinismo bajo concurrencia.** `last_seen_at` se mezcla con `GREATEST` y la
correlación y el dominio siguen al instante que ganó. Eso hace que la fila final sea
función del **conjunto** de escrituras y no de su orden de llegada: con un
last-write-wins simple, dos escritores concurrentes dejarían filas distintas según cómo
los planificara el servidor.

**Lo que este diseño cuesta, dicho en voz alta:**

- **No hay historia de dominios.** Si una empresa cambia de web, el dominio anterior se
  pierde. La tabla no pretende ser un histórico y no lo insinúa.
- **`first_seen_at` significa «la primera escritura que procesamos»**, no «el instante
  más antiguo que existió». Una escritura que llega tarde con fecha anterior no lo mueve
  hacia atrás, porque § 2 exige que `first_seen_*` no se reescriba.
- **Los contadores de novedad son una foto previa a la escritura.** Bajo concurrencia,
  dos escritores pueden contar el mismo id como nuevo. Es imprecisión de telemetría, no
  de la fila: la convergencia de la fila sí está garantizada.
- **Excluir por dominio puede tapar a un vecino.** Si dos entidades comparten sitio y
  sólo vimos una, excluir el dominio esconde también la otra. Es comportamiento
  **preexistente del planificador de exclusión**, no de esta tabla, y este hito no lo
  toca: § 5 congela el comportamiento vivo de las exclusiones.

**Lo que la tabla NO lleva, a propósito:** nombre de empresa, tamaño, industria,
teléfono, dirección ni ningún campo del perfil comprado. Recordar *«ya vi este id»*
no es conservar el dato que se pagó, y esa distinción es la que mantiene la memoria
fuera del alcance de una cláusula de redistribución.

**Retención:** la carga siempre viaja acotada (`PROVIDER_SEEN_LOAD_LIMIT = 500`). Una
política de purga por antigüedad es trabajo posterior y depende de la respuesta
escrita de Lusha sobre estabilidad de ids (§ 5): purgar antes de saber cuánto dura un
id sería elegir un número al azar.

---

## 4. Qué hace el código mientras tanto (sigue siendo NO-OP)

- El puerto `ProviderSeenStore` existe, con dos implementaciones: el **no-op** que usa
  Producción y un **doble en memoria** que sólo usan las pruebas.
- `resolveProviderSeenStore()` devuelve el no-op. Consecuencia deliberada y
  comprobada: memoria vacía ⇒ 0 aciertos ⇒ 0 exclusiones nuevas ⇒ **la corrida gasta
  exactamente lo mismo que antes de este PR**.
- 🔴 El no-op **no** se sustituye por el doble en memoria «mientras tanto»: una
  memoria por proceso mentiría entre despliegues e instancias, y una memoria que a
  veces recuerda es peor que una que nunca lo hace, porque nadie sabría cuál de las
  dos cosas estaba pasando cuando una corrida costó de más.

- El adaptador **persistente** ya existe (`provider-seen-supabase-store.ts`), está
  probado contra un PostgreSQL real y **no lo importa ningún módulo de Producción**; una
  prueba estática recorre `src/` entero para comprobarlo.
- 🔴 Ni `load` ni `record` lanzan. Una lectura rota devuelve memoria VACÍA —0 aciertos, 0
  exclusiones nuevas, el gasto de hoy— y una escritura rota se reporta con su motivo. Una
  optimización que puede tumbar la operación deja de serlo.

**El orden para encenderla es: aplicar la migración en Producción, y RECIÉN ENTONCES
cambiar qué devuelve `resolveProviderSeenStore()`.** Al revés, cada corrida escribiría
contra una tabla que no existe.

---

## 5. Contrato de Lusha pendiente (§ 5) — separado a propósito

Está pendiente la respuesta **escrita** del soporte humano de Lusha (Sandeep) sobre
`POST /v3/companies/prospecting`. Hasta que llegue, **nada** en este PR depende de:

- `filters.companies.exclude.ids`
- la semántica de `ids` + `domains` combinados
- la estabilidad a largo plazo del id de empresa
- un máximo de elementos en el array de exclusión
- el orden entre exclusión y paginación
- si la exclusión rellena la página («backfill») o la deja corta

Lo que sí se hace es dejar el sitio construido: los ids se recogen, se cuentan y se
declaran `available`; una sola constante de capacidad decide si se envían. Cambiar
`LUSHA_EXCLUSION_CAPABILITY.supportsIdExclusion` a `true` —con sus pruebas— es todo lo
que hará falta el día que llegue el contrato. El núcleo no se reescribe.
