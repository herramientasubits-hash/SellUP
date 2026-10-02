'use client';

/**
 * Estado de la calculadora de ROI (solo proyeccion).
 *
 * Vive en el navegador (localStorage), igual que en la calculadora original:
 * no hay tablas en Supabase. Por eso lo que un admin edite en los parametros
 * solo aplica en SU navegador; el resto de usuarios ve los valores por
 * defecto del codigo.
 *
 * El resultado no se guarda: se deriva (ver `useResultado`).
 *
 * `skipHydration`: la pagina se renderiza primero en el servidor, donde no hay
 * localStorage. El cliente rehidrata al montar (`useHidratarROI`) para que el
 * primer render coincida con el del servidor.
 */

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { crearEngineLMS } from './domain/lms/engine';
import { crearParamsLMS } from './domain/lms/params';
import { casoEjemploProspecto, inputPorDefecto } from './domain/lms/schema';
import type { LMSInput } from './domain/lms/types';
import {
  aplicarFuente,
  aplicarValor,
  exportarParams,
  fusionarParams,
  importarParams,
  restaurarParam,
  restaurarTodo,
} from './domain/params-core';
import type { ParamValue, ParamsBundle, ProductROIEngine, ROIResultado } from './domain/types';

const anioActual = () => new Date().getFullYear();

/** Escribe una ruta con puntos sin mutar el objeto original. */
function setEnRuta<T extends object>(objeto: T, ruta: string, valor: unknown): T {
  const [clave, ...resto] = ruta.split('.');
  if (!clave) return objeto;
  const actual = (objeto as Record<string, unknown>)[clave];
  return {
    ...objeto,
    [clave]:
      resto.length === 0 ? valor : setEnRuta((actual ?? {}) as object, resto.join('.'), valor),
  };
}

/** Un input guardado por una version vieja no debe tumbar la pantalla. */
const esInputValido = (v: unknown): v is LMSInput => {
  const c = (v as Partial<LMSInput> | undefined)?.capacidad;
  return typeof c === 'object' && c !== null && typeof c.poblacion === 'object';
};

export type VistaROI = 'datos' | 'reporte';

export interface EstadoROI {
  input: LMSInput;
  params: ParamsBundle;
  vista: VistaROI;

  setVista: (vista: VistaROI) => void;
  /** Ruta con puntos sobre el input. */
  setCampo: (ruta: string, valor: unknown) => void;
  /** Para ediciones que tocan varios campos a la vez, en una sola escritura. */
  aplicarAlInput: (fn: (input: LMSInput) => LMSInput) => void;
  cargarEjemplo: () => void;
  limpiar: () => void;

  setParamValor: (id: string, valor: ParamValue) => void;
  setParamFuente: (id: string, fuente: string) => void;
  restaurarUnParam: (id: string) => void;
  restaurarTodosLosParams: () => void;
  exportarConfiguracion: () => string;
  importarConfiguracion: (crudo: unknown) => { ok: boolean; errores: string[]; avisos: string[] };
}

export const useROIStore = create<EstadoROI>()(
  persist(
    (set, get) => ({
      input: inputPorDefecto(anioActual()),
      params: crearParamsLMS(),
      vista: 'datos',

      setVista: (vista) => set({ vista }),
      setCampo: (ruta, valor) => set((s) => ({ input: setEnRuta(s.input, ruta, valor) })),
      aplicarAlInput: (fn) => set((s) => ({ input: fn(s.input) })),
      cargarEjemplo: () => set({ input: casoEjemploProspecto(), vista: 'datos' }),
      limpiar: () => set({ input: inputPorDefecto(anioActual()) }),

      setParamValor: (id, valor) => set({ params: aplicarValor(get().params, id, valor) }),
      setParamFuente: (id, fuente) => set({ params: aplicarFuente(get().params, id, fuente) }),
      restaurarUnParam: (id) => set({ params: restaurarParam(get().params, id, crearParamsLMS()) }),
      restaurarTodosLosParams: () => set({ params: restaurarTodo(crearParamsLMS()) }),
      exportarConfiguracion: () => exportarParams(get().params),
      importarConfiguracion: (crudo) => {
        const resultado = importarParams(crudo, crearParamsLMS());
        if (resultado.ok) set({ params: resultado.bundle });
        return { ok: resultado.ok, errores: resultado.errores, avisos: resultado.avisos };
      },
    }),
    {
      name: 'sellup-roi-proyeccion',
      version: 1,
      skipHydration: true,
      partialize: (s) => ({ input: s.input, params: s.params }),
      merge: (persistido, actual) => {
        const guardado = persistido as Partial<EstadoROI> | undefined;
        return {
          ...actual,
          input: esInputValido(guardado?.input) ? guardado.input : actual.input,
          // Un localStorage viejo nunca deja la app sin un supuesto.
          params: fusionarParams(guardado?.params ?? null, crearParamsLMS()),
        };
      },
    },
  ),
);

/** Rehidrata desde localStorage al montar. Devuelve true cuando ya termino. */
export function useHidratarROI(): boolean {
  const listo = useSyncExternalStore(
    (avisar) => useROIStore.persist.onFinishHydration(avisar),
    () => useROIStore.persist.hasHydrated(),
    // En el servidor no hay localStorage: siempre "sin hidratar".
    () => false,
  );
  useEffect(() => {
    void useROIStore.persist.rehydrate();
  }, []);
  return listo;
}

export function useEngine(): ProductROIEngine<LMSInput> {
  const params = useROIStore((s) => s.params);
  return useMemo(() => crearEngineLMS({ params }), [params]);
}

/** Se deriva en vivo: cualquier cambio en el formulario o en un parametro recalcula. */
export function useResultado(): ROIResultado<LMSInput> {
  const engine = useEngine();
  const input = useROIStore((s) => s.input);
  return useMemo(() => engine.calcular(input), [engine, input]);
}

/** true cuando ya hay datos suficientes para que el reporte signifique algo. */
export function useTieneDatos(): boolean {
  return useROIStore(
    (s) => s.input.capacidad.poblacion.poblacionTotal > 0 && s.input.capacidad.inversionAnualUSD > 0,
  );
}
