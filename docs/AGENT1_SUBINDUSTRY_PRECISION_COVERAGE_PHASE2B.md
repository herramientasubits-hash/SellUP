# AGENT1-SUBINDUSTRY-PRECISION-COVERAGE-1 · PHASE 2B

**Typed precision rule-set registry.**
Estado: arquitectura entregada. **0 subindustrias nuevas. Cobertura de precisión: 2 de 73, igual que antes.**

Fase previa: [PHASE 2A](AGENT1_SUBINDUSTRY_PRECISION_COVERAGE_PHASE2A.md) (PR #265, `8bb51c45`) — identidad por igualdad exacta, fail-closed.

---

## 1. Qué hace esta fase

Extrae los datos de precisión de las dos subindustrias mapeadas a un contrato
tipado y un registry validado, **sin mover ninguna decisión**.

Antes, `apollo-subindustry-precision.ts` mezclaba en un archivo la máquina de
evaluación y seis literales `Record<string, string[]>` indexados por clave
normalizada:

```
SUBINDUSTRY_ANCHOR_FAMILIES
SUBINDUSTRY_ANCHOR_TERMS
SUBINDUSTRY_EXCLUSIVE_BUSINESS_MODEL_TERMS
SUBINDUSTRY_CONFLICTING_BUSINESS_MODEL_TERMS
SUBINDUSTRY_BROAD_INDUSTRY_TERMS
SUBINDUSTRY_CONTRADICTORY_INDUSTRY_TERMS
```

Con dos subindustrias eso se sostiene. Con once —Ola 1 son nueve más— añadir una
obliga a tocar seis literales en seis sitios del mismo archivo, y nada impide que
una quede a medias: con anclas pero sin contradicciones, o al revés. Un mapeo
incompleto **no falla ruidosamente**: confirma o rechaza de menos, y eso decide
gasto y admisión (PR #251).

Ahora es un objeto por subindustria, en
`src/server/agents/prospecting-toolkit/apollo-subindustry-precision-rule-sets.ts`.

## 2. Lo que NO hace

- No registra ninguna subindustria nueva. No hay Ola 1 aquí.
- No aumenta la cobertura de precisión (sigue 2/73).
- No promueve ningún alias del catálogo a identidad de precisión.
- No lee `subindustry_rules` en runtime, no publica reglas, no toca
  `execution_layer`, no edita el catálogo `1.0.0` y no añade migraciones.
- No toca los topes de la corrida (search ≤ 2, resultados/ronda ≤ 10, crudos ≤ 20,
  enrichments ≤ 5, créditos ≤ 25).
- No registra «Formación Corporativa y Corporate Training».

---

## 3. El contrato

```ts
type SubindustryPrecisionRuleSet = {
  key: string;                     // clave de indexación, ya normalizada
  canonicalName: string;
  subindustryId: string | null;    // null en C1: ningún consumidor lo trae
  precisionAliases: readonly string[];   // vacío en las dos reglas (§ 8)
  mode: 'full' | 'confirm_only';
  catalogVersionId: string | null;       // null en C1 (§ 15)
  anchors: readonly string[];
  anchorFamilies: Readonly<Record<string, SubindustryMatchFamily>> | null;
  exclusiveBusinessModels: readonly string[];
  conflictingBusinessModels: readonly string[];
  broadProviderIndustries: readonly string[];
  contradictoryProviderIndustries: readonly string[];
  metadata?: { rationale?: string };
};
```

### Mapeo del vocabulario del encargo a la semántica real

| Encargo | Campo | Nota |
|---|---|---|
| anchors / positive signals | `anchors` | — |
| broad signals | `broadProviderIndustries` | sólo sobre la industria DECLARADA |
| negative signals | `exclusiveBusinessModels` | ⇒ `rejected` |
| conflict signals | `conflictingBusinessModels` | con ancla ⇒ `ambiguous`; sin ancla ⇒ `rejected` |
| contradictory signals | `contradictoryProviderIndustries` | sólo industria declarada, se evalúa primero |
| provider industry matches | **`anchors`** | no hay lista aparte: el evaluador reutiliza las anclas sobre los campos de industria declarada. Duplicarlas crearía dos verdades |
| provider industry exclusions | **`contradictoryProviderIndustries`** | es la misma lista |

`match keys`, `source authority`, `thresholds` y `precedence` **no** están en el
rule-set: son de la máquina.

### Lo que se quedó en el evaluador (§ 2, § 6)

`TOKEN_PATTERN` / `tokensContainSequence` / `matchesCatalogTerm`,
`CLASSIFYING_FIELDS`, `DECLARED_INDUSTRY_FIELDS`, `SOURCE_AUTHORITY`,
`AMBIGUOUS_CONFIDENCE_CAP`, `VERDICT_PRECEDENCE`, `verdictScore`.

Hay **un solo evaluador genérico**. No existe `evaluateApolloSupermarket`,
`evaluateApolloBanking` ni un evaluador por proveedor, y la suite lo demuestra
haciendo pasar una subindustria que el módulo no conocía por los seis
`verdictReason` del contrato sin una línea específica para ella.

---

## 4. `mode` — `full` y `confirm_only` (§ 9)

Las dos reglas vigentes están en **`full`**. `confirm_only` está implementado,
probado y **sin usar en producción**.

El problema que `confirm_only` previene antes de que exista: hasta aquí el
veredicto de precisión es UNO, y lo leen dos consumidores que deciden dinero —el
pliegue sectorial del runner y el contrato de completitud—. Registrar una
subindustria nueva con reglas sin calibrar significaría, hoy, que sus ramas
negativas empiezan a degradar estados, a convocar enrichments y a impedir
persistencias desde el primer despliegue.

`confirm_only` separa las dos lecturas:

| rama | diagnóstico | operativo |
|---|---|---|
| `confirmed` | `confirmed` | `confirmed` — puede contar si el resto del contrato pasa |
| `ambiguous` | `ambiguous` | **no contribuye** — no mueve el estado sectorial, no crea prioridad de enrichment |
| `rejected` | `rejected` | **no contribuye** — no contradice el sector, no impide persistir |
| `unmapped` | `unmapped` | comportamiento base/fail-closed existente |

En `full`, operativo ≡ diagnóstico, término por término.

**Diagnóstico y operativo son distinguibles**, y esa es la mitad que hace
`confirm_only` útil: la ficha sigue viendo `subindustry_ambiguous` /
`subindustry_rejected`, que es con lo que se decide si la regla se promueve a
`full`. Si el diagnóstico se colapsara a `unmapped`, la regla nueva sería
inobservable.

### Dónde se lee cada uno

```
projectOperationalSubindustryVerdict(assessment, options?)   ← el veredicto operativo

foldSubindustryPrecisionIntoSectorState()      lee el OPERATIVO
resolveCandidateSubindustryRequirement()       lee el OPERATIVO para contar,
                                               el DIAGNÓSTICO para reportar
```

La proyección no se almacena en el assessment: se **deriva** de
`perRequestedSubindustryEvaluations` (o del agregado, cuando la lista viene vacía
—un candidato restaurado de un checkpoint antiguo, o una fixture sintética—). Por
eso `ApolloSubindustryPrecisionAssessment` no cambió de forma y no hubo que editar
ninguna fixture existente.

Si una etiqueta MAPEADA no resuelve en el registro recibido, el modo se asume
`full`: es el más estricto y es el comportamiento histórico. Suponer
`confirm_only` ahí desactivaría rechazos que hoy sí aplican.

---

## 5. Alias de catálogo ≠ alias de precisión (§ 8)

`precisionAliases` está **vacío** en las dos reglas, y eso no es un pendiente: es
la declaración de que hoy sólo el nombre canónico resuelve.

Los 127 alias publicados viven en `subindustry_aliases`, viajan con un
`catalog_version_id` y pueden cambiar sin despliegue. La precisión recibe una
etiqueta de texto y nada más: no sabe qué versión resolvió la selección del
wizard. Conectarlos sin esa versión crearía una segunda fuente de verdad.

Y no sería gratis: `Banca Tradicional` declara `banco` y `bank`, y
`Fintech: Infraestructura y Pagos` declara `fintech`. Admitirlos como identidad es
admitir etiquetas de una sola palabra genérica.

El mecanismo funciona (la suite lo ejercita con un alias inyectado). La decisión de
cuáles se promueven es alias por alias, con la auditoría de colisiones delante.

---

## 6. Colisiones (§ 14)

`buildSubindustryPrecisionRuleSetRegistry` **lanza** —no degrada a «gana la
primera»— ante:

- `key` duplicada
- `canonicalName` duplicado tras normalizar
- `subindustryId` duplicado
- el mismo alias declarado por dos reglas (`alias_alias`)
- un alias que normaliza igual que el canónico de otra regla (`alias_canonical`)
- una regla mapeada sin anclas
- un ancla sin familia en una regla compuesta

Se llama en el import del evaluador, así que el fallo llega en cada suite, en el
typecheck y en el build — nunca en una corrida con crédito ya reservado.

Un alias que repite el canónico de su **propia** regla es redundancia inofensiva,
no colisión.

Colisiones en el registro vigente: **0**.

---

## 7. Paridad (§ 11)

La paridad BEFORE/AFTER se midió con un volcado exhaustivo fuera de la suite:

- 23.104 comprobaciones del matcher puro (todo el vocabulario × todo el vocabulario)
- 17.024 assessments (8 etiquetas × 14 campos del proveedor × 152 términos), cada
  uno con su metadata persistida, su estado sectorial plegado sobre los 4 estados
  base, su `resolveCandidateSubindustryRequirement` y su elegibilidad hacia el
  objetivo
- 9.264 evaluaciones ANY-OF (579 combinaciones y permutaciones × 16 fixtures)
- 579 saneamientos de la lista pedida
- registro de identidad y claves de anclas

**49.973 registros. SHA-256 idéntico antes y después: `b49e8912…`. Cero fixtures
editadas para conseguirlo.**

El invariante que ese volcado demostró queda fijado en la suite de forma
permanente: con las dos reglas en `full`, el veredicto operativo es el
diagnóstico. Si alguien pone una en `confirm_only` sin decirlo, la suite falla.

---

## 8. Límite declarado: empates en el ANY-OF

El **veredicto** es invariante al orden: `[A,B]` y `[B,A]` dan el mismo
`subindustryMatch`, el mismo `subindustryMapped` y el mismo `countsTowardTarget`.

La **atribución** no lo es, y no puede serlo: cuando dos subindustrias pedidas
empatan en precedencia, gana la que el usuario pidió primero. Eso ya valía para
`matchedRequestedSubindustry` desde #241/#251, y `precisionMode` lo hereda porque
nombra a la regla ganadora, no al veredicto.

Está declarado con su propia prueba en vez de esconderse tras un `deepEqual`.

El orden del **registro** tampoco decide nada: la suite evalúa con el registro
directo y con el invertido y exige el mismo resultado.

---

## 9. Cómo añadir una subindustria (Phase 2C)

Sin editar el evaluador. Sin editar el resolver. Sin migración.

1. **Un rule-set** en `SUBINDUSTRY_PRECISION_RULE_SETS`:
   - `key` = `normalizeSubindustryIdentity(canonicalName)`
   - `canonicalName` = el nombre exacto del catálogo activo
   - `mode: 'confirm_only'` para la primera vuelta; promover a `'full'` sólo con
     evidencia de calibración
   - `precisionAliases: []` salvo aprobación alias por alias
   - `subindustryId: null` y `catalogVersionId: null` mientras C2 no exista
   - `anchors` que nombren la **operación**, nunca la categoría de producto ni la
     industria contenedora. Si un ancla es substring de una frase que NO es la
     subindustria, no es ancla: va a `broadProviderIndustries`
   - `anchorFamilies` sólo si la etiqueta es compuesta — y entonces **todas** las
     anclas necesitan familia, o el registry aborta
2. **Fixtures** en la suite: los seis `verdictReason` del contrato más los casos
   adversariales de substring propios de ese vocabulario.
3. **Actualizar el ratchet de cobertura** (§ 12) de 2 a 3, deliberadamente. Es la
   única línea que obliga a declarar la ampliación.
4. **DoD**: `npm run test:a1-subindustry-precision-ruleset-registry` verde, más las
   suites de regresión del check obligatorio; `typecheck`, `lint` y `build` sin
   nuevos errores; 0 migraciones; 0 escrituras en Producción; 0 créditos.

El § 18 se probó con una regla TEST-ONLY (`Venta Minorista de Bicicletas`,
`confirm_only`) inyectada vía `{ ruleSets }`. **No está en el registro de
producción** y el ratchet del § 12 falla si alguien la registra.

---

## 10. Phase C2 — lo que queda fuera

`catalogVersionId` existe en el tipo y es `null`. El hueco está para que C2 pueda
adjuntar la versión publicada sin reescribir el evaluador; ponerle un valor hoy
afirmaría una coherencia con el catálogo que nadie comprobó, y en particular **no**
se ha hardcodeado `e4675daf-65a2-5e26-8640-58f1aeaee5ed` en ninguna regla.

C2 —cargar `subindustry_rules.configuration` en runtime, cambiar
`execution_layer`, publicar reglas— va **después** de validar Ola 1 code-owned.
Nada de eso está aquí.

---

## 11. Archivos

| Archivo | Cambio |
|---|---|
| `src/server/agents/prospecting-toolkit/apollo-subindustry-precision-rule-sets.ts` | **nuevo** — tipo, registry, validador de colisiones |
| `src/server/agents/prospecting-toolkit/apollo-subindustry-precision.ts` | consume el registry; añade `projectOperationalSubindustryVerdict` y la inyección `{ ruleSets }`; re-exporta `SubindustryMatchFamily` |
| `src/server/agents/prospecting-toolkit/apollo-two-round/production-runner.server.ts` | el pliegue sectorial lee el veredicto operativo |
| `src/server/agents/prospecting-toolkit/candidate-completeness-contract.ts` | el conteo lee el operativo; el reporte, el diagnóstico |
| `src/server/agents/prospecting-toolkit/__tests__/agent1-subindustry-precision-ruleset-registry-1.test.ts` | **nuevo** — 58 pruebas |
| `package.json` | `test:a1-subindustry-precision-ruleset-registry` |
| `.github/workflows/automatic-routing-tests.yml` | el paso entra al check obligatorio |

Sin tocar: `record_origin`, el candidate writer, LinkedIn/`employee_count`,
presupuesto, provider routing, HubSpot, Agente 2A.

---

## 12. Seguridad

Llamadas a Apollo: 0. Tavily: 0. Lusha: 0.
Escrituras en Producción: 0. HubSpot: 0. Cambios de presupuesto: 0. Créditos: 0.
Migraciones: 0. QA live: ninguna.

Todo el módulo es puro: sin I/O, sin env, sin reloj.
