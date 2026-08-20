# Memoria provider-seen — arqueología de esquema y propuesta mínima

**Hito:** AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 · ADDENDUM PROVIDER-SEEN
**Estado:** propuesta. **0 migraciones escritas · 0 migraciones aplicadas.**
**Fecha de la auditoría:** 2026-08-20, Producción `lrdruowtadwbdulndlph`, **sólo lectura**.

§ 13 del addendum ordena parar y reportar antes de improvisar una migración, y § 0
prohíbe aplicarla. Este documento es ese reporte.

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

## 3. Propuesta mínima (NO aplicada)

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

**Invariantes que la tabla debe hacer cumplir, no confiar:**

1. `CHECK (provider_entity_id IS NOT NULL OR normalized_domain IS NOT NULL)` — una
   fila sin ninguna de las dos señales no recuerda nada.
2. Unicidad **por señal, nunca combinada**: un índice único parcial sobre
   `(provider, provider_entity_type, provider_entity_id)` cuando el id no es nulo, y
   otro sobre `(provider, provider_entity_type, normalized_domain)` cuando el id es
   nulo. 🔴 Una única clave `(id, dominio)` supondría semántica combinada, que § 5
   prohíbe mientras el contrato humano de Lusha no llegue.
3. `first_seen_at` / `first_seen_correlation` **inmutables**: el upsert sólo reescribe
   `last_seen_*` y completa un `normalized_domain` que antes era nulo.
4. RLS: `service_role` únicamente. Es memoria de servidor; ningún cliente de sesión
   tiene por qué leerla. (Precedente exacto: `wizard_monthly_budget_periods`, #287.)

**Lo que la tabla NO lleva, a propósito:** nombre de empresa, tamaño, industria,
teléfono, dirección ni ningún campo del perfil comprado. Recordar *«ya vi este id»*
no es conservar el dato que se pagó, y esa distinción es la que mantiene la memoria
fuera del alcance de una cláusula de redistribución.

**Retención:** la carga siempre viaja acotada (`PROVIDER_SEEN_LOAD_LIMIT = 500`). Una
política de purga por antigüedad es trabajo posterior y depende de la respuesta
escrita de Lusha sobre estabilidad de ids (§ 5): purgar antes de saber cuánto dura un
id sería elegir un número al azar.

---

## 4. Qué hace el código de este PR mientras tanto

- El puerto `ProviderSeenStore` existe, con dos implementaciones: el **no-op** que usa
  Producción y un **doble en memoria** que sólo usan las pruebas.
- `resolveProviderSeenStore()` devuelve el no-op. Consecuencia deliberada y
  comprobada: memoria vacía ⇒ 0 aciertos ⇒ 0 exclusiones nuevas ⇒ **la corrida gasta
  exactamente lo mismo que antes de este PR**.
- 🔴 El no-op **no** se sustituye por el doble en memoria «mientras tanto»: una
  memoria por proceso mentiría entre despliegues e instancias, y una memoria que a
  veces recuerda es peor que una que nunca lo hace, porque nadie sabría cuál de las
  dos cosas estaba pasando cuando una corrida costó de más.

Cuando la migración se autorice, lo único que cambia es qué devuelve
`resolveProviderSeenStore()`.

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
