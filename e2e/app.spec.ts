import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.goto('./');
});

test('RC por defecto: τ y paso a paso', async ({ page }, info) => {
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Simulador 6 – Respuesta Natural y a un Escalón de Circuitos RL y RC');
  await expect(page.getByText('1 ms').first()).toBeVisible();
  if (info.project.name === 'celular') await page.getByRole('tab', { name: /2\. Solución/ }).click();
  await expect(page.getByText('Concepto clave').first()).toBeVisible();
});

test('plantillas RL natural y secuencial; captura', async ({ page }, info) => {
  await page.getByRole('button', { name: /Plantillas/ }).click();
  await page.locator('.card', { hasText: 'RL: respuesta natural' }).getByRole('button').click();
  await expect(page.getByText('50 ms').first()).toBeVisible();
  await expect(page.getByText('Energía inicial almacenada').first()).toBeVisible();
  await page.screenshot({ path: `docs/captura-${info.project.name}.png` });
});

test('error: inductor con corriente interrumpida', async ({ page }) => {
  const c = {
    elements: [
      { id: 'e', kind: 'V', label: 'E', value: '10', x: 0, y: 0, rot: 1 },
      { id: 's', kind: 'SW', label: 'S1', value: '', x: 0, y: 0, rot: 0, swMode: 'open', t0: '0' },
      { id: 'r', kind: 'R', label: 'R1', value: '10', x: 4, y: 0, rot: 0 },
      { id: 'l', kind: 'L', label: 'L', value: '1', x: 8, y: 0, rot: 1, icMode: 'dc' },
      { id: 'g', kind: 'GND', label: 'Tierra', value: '', x: 0, y: 4, rot: 0 },
    ],
    wires: [{ id: 'w', a: { x: 0, y: 4 }, b: { x: 8, y: 4 } }],
  };
  const enc = Buffer.from(JSON.stringify(c)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  await page.goto(`./#c=${enc}`);
  await expect(page.getByText(/interrumpida/).first()).toBeVisible();
});
