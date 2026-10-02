import { isCurrentUserAdmin } from '@/modules/access/actions';
import { RoiCalculatorClient } from './roi-calculator-client';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Calculadora de ROI',
};

/**
 * Calculadora de ROI de UBITS, solo el ejercicio de proyección de venta.
 *
 * Todo el cálculo corre en el navegador y se guarda en localStorage. Lo único
 * que decide el servidor es si quien entra puede editar los supuestos del
 * modelo: solo los administradores.
 */
export default async function RoiCalculatorPage() {
  const canEditParams = await isCurrentUserAdmin();
  return <RoiCalculatorClient canEditParams={canEditParams} />;
}
