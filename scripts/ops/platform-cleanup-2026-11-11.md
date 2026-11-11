# Limpieza «en ceros» — 11-11-2026 (registro)

Autorización de la dueña en el chat del 11-11: «limpiemos la plataforma de nuevo, que quede en ceros, todo a los bancos gratuitos». Plan confirmado: México · Seguros al banco, Monex y Banorte archivadas, Rumbo y árboles borrados.

**Los líderes ya habían entrado (11-11 13:00Z).** Por eso el alcance se cerró a las pruebas de egarcia de hoy, por id. Lo de jcuberos (SoEnergy International) y el contacto de brcastro no se tocaron.

| Paso | Cómo | Resultado |
|---|---|---|
| Respaldo | `platform-cleanup-2026-11-11.mts --export` (sólo lectura) | `~/Documents/SellUp-data/cleanup-2026-11-11/export/` |
| Plan | `--plan` (sólo lectura) | 7 empresas al banco; fuera: Monex y Banorte (convertidas) y Gentera (ya en HubSpot) |
| Depósito | `--deposit` (`agent1_bank_deposit`) | 11 reclamos liberados; 4 nuevas al banco (Mifel, Macropay, Monterrey NYL, Quálitas) y 3 ya estaban (Intercam, Profuturo, Prudential) |
| Limpieza | `platform-cleanup-2026-11-11.sql` por el MCP, rol postgres, un bloque (ensayado con `RAISE`) | ver abajo |

Resultado:
- **Banco:** 3 filas `assigned` borradas (ya se habían redepositado); 7 filas desenlazadas del lote. El guardia se apagó sólo durante ese UPDATE y se volvió a encender (verificado `O`). Banco activo: 2.054.
- **Búsqueda:** 3 lotes borrados (México · Seguros, Árbol · fallabella, Árbol · grupo exito), con 17 reclamos. El lote archivado de brcastro (CL Retail, con reserva) sigue igual.
- **Rumbo:** 18 preparaciones y 3 investigaciones borradas.
- **Fichas:** Monex y Banorte archivadas. Su contacto (Miguel Ángel Vega) queda en el banco de contactos.
- **Se conservan:** `provider_usage_logs` (1.415 filas) y la reserva de presupuesto.

Queda una ficha activa: SoEnergy International (jcuberos, líder, 15:39Z).
