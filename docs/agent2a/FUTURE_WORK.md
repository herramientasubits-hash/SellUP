# Agente 2A — Lo que NO está implementado

> Separado deliberadamente en **tres** categorías. Confundirlas es lo que convierte una decisión
> de alcance en un «bug» fantasma que alguien intenta arreglar seis meses después.
>
> * **Alcance deliberado** — se decidió no hacerlo, y hay una razón registrada. **No es deuda.**
> * **Deuda / trabajo pendiente** — se quiere, no se ha hecho.
> * **Riesgo de infraestructura** — no es código.

---

## 1. Alcance deliberado (NO son defectos)

### 1.1 «Buscar más números» vía Apollo

**No existe, y no por prudencia: porque la operación no existe.**

El payload terminal de Apollo trae **todos** los teléfonos que Apollo tiene —en hasta tres
ubicaciones— y desde 4O-C se persisten **todos**. Apollo no expone ninguna operación de «más
teléfonos» ni pagina su respuesta. **Repetir Apollo cobraría otra vez por el payload que ya está
guardado.**

Consecuencia concreta que conviene entender: un candidato **legacy o manual de origen Lusha** —es
decir, uno cuya identidad nativa es de Lusha y cuyo teléfono vino de Lusha— **no tiene Search More
disponible**, porque el proveedor que le falta sería Apollo y esa pata no existe. El planificador
devuelve `no_additional_provider`.

**Si algún día se quiere cubrir ese caso**, requiere primero que Apollo ofrezca una operación
genuina de «más números» *o* una vía de identidad Apollo para un candidato Lusha. Sin una de las
dos, añadir `apollo` a `SEARCH_MORE_PROVIDERS` autorizaría un gasto que ninguna rama puede cobrar
— y por eso el mapa de topes es exhaustivo sobre el tipo: **añadirlo rompe la compilación**.

### 1.2 Búsqueda general de personas de Lusha desde Search More

**Prohibida por contrato.** La entrada es el id nativo `source_contact_id` y sólo cuando
`source = 'lusha'`. No hay nombre, ni email, ni empresa, ni LinkedIn, ni enlace difuso.

Abrirla convertiría una operación acotada y auditable en una búsqueda de personas de coste no
acotado y procedencia no atribuible.

### 1.3 Reintento pagado automático

**Prohibido.** Una corrida `search_more` terminal agota al proveedor **para cualquier desenlace,
incluido el error**. Un reintento es una **decisión humana nueva**, no una recuperación
automática.

### 1.4 Aprobación automática de candidatos

**No existe y no debe existir.** Todo candidato pasa por revisión humana explícita.

### 1.5 Escritura automática en HubSpot

**No existe.** Agente 2A **lee** HubSpot (resolución de empresa, detección de duplicados) y
**nunca escribe automáticamente**.

### 1.6 Bulk de operaciones de teléfono

**No existe.** El enriquecimiento sí tiene modalidad bulk; el reveal, «Ver más» y «Buscar más» son
**escalares por diseño**: la entrada es un `candidate_id`, así que no hay forma de pedir un batch.

---

## 2. Deuda y trabajo pendiente

### 2.1 Privacidad Fase 2 — identidad global entre proveedores

**Estado: NO implementado.** Es la limitación más importante del subsistema y está declarada
explícitamente en el propio código (`provider-suppression-core.ts`).

Hoy: una supresión de Apollo garantiza bloqueo **en Apollo**; una de Lusha, **en Lusha**. Nada
deduce que la persona Apollo X y el contacto Lusha Y sean el mismo humano.

Lo que falta: `privacy_subjects` + alias por proveedor + hash de LinkedIn — un **sujeto de
privacidad compartido**.

**Riesgo real mientras no exista:** una DSAR ejercida sobre la identidad de Apollo **no** bloquea
un reveal posterior contra la identidad de Lusha de la misma persona. El código es honesto sobre
esto y no promete lo contrario. Es la razón por la que ese límite está escrito en mayúsculas en la
cabecera del módulo:

> «Afirmar lo contrario sería el peor error posible en un subsistema de privacidad: prometer una
> garantía que el esquema no puede cumplir.»

**Prioridad sugerida: la más alta de esta lista**, por exposición regulatoria.

### 2.2 Badge «Nuevo» para candidatos recién descubiertos — PR #288

**Estado: PR abierto y congelado** (`agent2a/contact-new-badge-1`). No mergeado.
Es trabajo de producto pendiente, no un defecto.

### 2.3 QA real de un reveal de Apollo con 2 o más teléfonos

**Estado: sin evidencia de Producción.**

Toda la maquinaria multi-teléfono existe y está probada, pero **ningún candidato en Producción
tiene hoy más de un teléfono de origen Apollo**. El único caso con dos números
(§ KATIA en [QA_ACCEPTANCE.md](QA_ACCEPTANCE.md)) los tiene de **dos proveedores distintos**, no de
Apollo dos veces.

La capacidad que justificó la migración 109 —que Apollo devuelve N números y se perdían N−1— **no
tiene todavía una demostración con dinero real**.

Con la política de presupuesto vigente (§ 8.1 de [BUDGET_AND_BILLING.md](BUDGET_AND_BILLING.md))
esta QA **no está bloqueada por presupuesto**; sigue exigiendo autorización explícita de gasto.

### 2.4 Waterfall que caiga realmente a la pata de Lusha

**Estado: sin evidencia de Producción.** La única corrida `full_waterfall` terminó en
`completed_apollo` con `lusha_attempted_at = NULL`. La pata automática Apollo→Lusha nunca se ha
ejercitado end-to-end con dinero real: falta ver un Apollo `no_phone_found` seguido de una
aceptación real de Lusha.

Con la política de presupuesto vigente (§ 8.1 de [BUDGET_AND_BILLING.md](BUDGET_AND_BILLING.md))
las **dos** patas tienen pozo resoluble, así que esta QA **no está bloqueada por presupuesto**;
sigue exigiendo autorización explícita de gasto.

### 2.5 DSAR ejercida en Producción

**Estado: sin evidencia.** `provider_suppressions`, `provider_suppression_audit` y
`phone_reveal_suppression_audit` están **vacías**. Todo el camino de borrado está implementado y
probado contra PostgreSQL real, pero nunca se ha ejecutado sobre datos reales.

### 2.6 Correlación de procedencia en las filas de origen Apollo

**Estado: pregunta abierta, no defecto confirmado.**

Las filas de `contact_enrichment_candidate_phone_sources` de origen **Apollo** presentes hoy en
Producción tienen `waterfall_run_id`, `reservation_id` y `provider_usage_log_id` en `NULL`,
mientras que la fila de origen **Lusha** escrita por Search More lleva los tres.

No se investigó la causa porque excede el alcance READ-ONLY de este hito. **Antes de tratarlo como
defecto**, hay que descartar que esos números se escribieran por un camino anterior al cableado de
la correlación.

### 2.7 Presupuesto operativo de Apollo y Lusha — **RESUELTO** (2026-08-20)

**Ya no es trabajo pendiente.** La dueña autorizó la política operativa final y Producción fue
actualizada: Apollo tiene una regla `global` mensual **activa** y Lusha una regla de `role` =
`admin` mensual **activa**. El reveal normal (`full_waterfall` / `apollo_only`) y «Buscar más
números» tienen presupuesto **resoluble**.

El presupuesto **no** es un interruptor de QA: la disponibilidad operativa de las acciones pagadas
la gobiernan esas reglas más los gates fail-closed del runtime. Política completa en
[BUDGET_AND_BILLING.md](BUDGET_AND_BILLING.md) § 8.1.

**Sigue vigente el ratchet:** cambiar una regla de presupuesto en Producción exige autorización
explícita de la dueña.

### 2.8 Cabeceras de migración desactualizadas

Diez migraciones declaran en su cabecera «NOT APPLIED» / «APPLIED IN PRODUCTION: NO» cuando
**todas están aplicadas**. Documentado en [README.md](README.md) § 5 y en
[HISTORY_AND_INCIDENTS.md](HISTORY_AND_INCIDENTS.md) § 1.1.

Corregirlas es un cambio de runtime y **queda fuera del alcance de esta auditoría**. Es deuda
documental de bajo riesgo pero alta capacidad de confundir a un mantenedor nuevo.

---

## 3. Riesgo de infraestructura

### 3.1 Preview no está aislado de Producción

**Estado: no mitigado.**

La organización Supabase de SellUp tiene **exactamente un proyecto**
(`lrdruowtadwbdulndlph`). **No existe** un proyecto separado de preview o staging. Por tanto
**todo deployment de Preview de Vercel apunta a la base de datos de Producción.**

Un flujo pagado ejercitado desde una URL de Preview consume créditos **reales**, crea corridas
**reales** y escribe filas **reales**.

**Mitigación vigente:** los flags de proveedor son `type: sensitive` y se configuran por entorno,
así que un Preview sin el flag encendido no puede gastar. Eso es una mitigación **por
configuración**, no por aislamiento — depende de que nadie encienda un flag en Preview.

**Lo que resolvería el problema de verdad:** un proyecto Supabase separado para Preview, con su
propia cadena de migraciones. Es trabajo de infraestructura, no de este repositorio.

---

## 4. Reglas que no se pueden aflojar

Ratchets obligatorios. Cada uno existe porque su ausencia causó un incidente real o porque su
violación tendría consecuencias irreversibles.

### Dinero

1. **Ninguna llamada a proveedor antes de que exista una reserva.**
2. **Ningún costo desconocido se trata como 0.** La ausencia de dato es `unknown`.
3. **Ninguna modificación de presupuesto sin autorización explícita.**
4. **Ningún reintento pagado automático.**
5. **Ninguna llamada duplicada al proveedor.** Las tres barreras de idempotencia
   (`authorization_key`, índice único parcial, claim atómico) se mantienen; **no se añade una
   cuarta** ni se sustituye ninguna.

### Privacidad

6. **Ninguna llamada a proveedor antes de la puerta de privacidad.**
7. **Nunca se debilita la supresión nativa del proveedor.** Ni la allowlist cerrada, ni la
   independencia de la cuenta, ni la durabilidad.
8. **Nunca se traduce `check_unavailable` a `clear`.** Fue el P0 de #289.
9. **Nunca se borra ni se reescribe procedencia.** Se retira (marcándola suprimida) o se añade.
10. **Nunca se infiere identidad entre proveedores.** Ni por LinkedIn, ni por email, ni por
    nombre, ni por matching difuso.

### Producto

11. **Ninguna aprobación automática de candidatos.**
12. **Ninguna escritura automática en HubSpot.**
13. **Ninguna ruta a la búsqueda general de personas de Lusha desde Search More.**
14. **«Ver más números» no importa ningún cliente de proveedor.** Hay un test estático que falla
    si aparece una de esas importaciones — **no se relaja**.

### Esquema y despliegue

15. **Ninguna migración sin autorización explícita de Producción.**
16. **Ningún módulo `'use server'` exporta algo que no sea una función async.** El ratchet con AST
    recorre los 52 módulos del repo — **no se limita a un símbolo**. Fue el P0-R4 (#285), y la
    clase de error ya había ocurrido **dos veces**.

### Diagnóstico

17. **`configured` y `enabled_resolved` se publican por separado, siempre.** Fusionarlos vuelve
    indistinguibles «ausente» y «presente pero no `"true"`».
18. **Los códigos de bloqueo del preflight y del runtime son los mismos.** Vocabularios paralelos
    obligan a dos traducciones de copy, y la olvidada cae en el genérico — el síntoma que #309
    eliminó.
