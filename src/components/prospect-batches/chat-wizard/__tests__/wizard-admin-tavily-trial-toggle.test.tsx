/**
 * AGENT1-TAVILY-TRIAL-1 — la casilla dice lo que hace, en español, y refleja su
 * estado. Render estático: sin jsdom ni mocks de módulos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  ADMIN_TAVILY_TRIAL_HINT,
  ADMIN_TAVILY_TRIAL_LABEL,
  WizardAdminTavilyTrialToggle,
} from '../wizard-admin-tavily-trial-toggle';

describe('WizardAdminTavilyTrialToggle', () => {
  it('muestra la etiqueta y la advertencia completas', () => {
    const html = renderToStaticMarkup(<WizardAdminTavilyTrialToggle checked={false} onCheckedChange={() => {}} />);
    assert.ok(html.includes(ADMIN_TAVILY_TRIAL_LABEL));
    assert.ok(html.includes('no activa Lusha'));
    assert.ok(html.includes('Sólo para administradores'));
    assert.match(ADMIN_TAVILY_TRIAL_HINT, /vendedores siguen con el modo automático/);
  });

  it('refleja el estado marcado y desmarcado', () => {
    const off = renderToStaticMarkup(<WizardAdminTavilyTrialToggle checked={false} onCheckedChange={() => {}} />);
    const on = renderToStaticMarkup(<WizardAdminTavilyTrialToggle checked onCheckedChange={() => {}} />);
    assert.match(off, /data-state="unchecked"/);
    assert.match(on, /data-state="checked"/);
  });

  it('la etiqueta está asociada a la casilla (accesible con teclado y lector)', () => {
    const html = renderToStaticMarkup(<WizardAdminTavilyTrialToggle checked={false} onCheckedChange={() => {}} />);
    assert.match(html, /id="admin-tavily-trial"/);
    assert.match(html, /for="admin-tavily-trial"/);
  });

  it('usa tokens del sistema de diseño, sin colores fijos', () => {
    const html = renderToStaticMarkup(<WizardAdminTavilyTrialToggle checked={false} onCheckedChange={() => {}} />);
    assert.doesNotMatch(html, /#[0-9a-f]{3,6}\b|rgba?\(/i);
    assert.match(html, /su-brand/);
  });
});
