// Plantillas y utilidades del Simulador 6 (transitorios de primer orden).
import { cb } from '../core/engine/builder';
import { TransientResult } from '../core/engine/transient';
import { Circuit } from '../core/engine/types';
import { ElementResult } from '../core/engine/mna';

/** Valores de todos los elementos en el instante t (desde la solución numérica o analítica) */
export function valuesAt(r: TransientResult, t: number, useAnalytic = true): Map<string, ElementResult> {
  const src = useAnalytic && r.analytic ? r.analytic : r.numeric;
  let k = 0;
  while (k + 1 < r.t.length && r.t[k + 1] <= t) k++;
  const m = new Map<string, ElementResult>();
  for (const v of r.vars) {
    if (v.type !== 'v') continue;
    const id = v.elementId;
    const k2 = Math.min(k + 1, r.t.length - 1);
    const w = r.t[k2] > r.t[k] ? Math.max(0, Math.min(1, (t - r.t[k]) / (r.t[k2] - r.t[k]))) : 0;
    const lerp = (arr: number[]) => arr[k] + (arr[k2] - arr[k]) * w;
    const vv = lerp(src.get(`v:${id}`)!);
    const ii = lerp(src.get(`i:${id}`)!);
    m.set(id, { id, label: v.label, kind: 'R', v: vv, i: ii, p: vv * ii });
  }
  return m;
}

/** Respuesta general de primer orden */
export const firstOrder = (xInf: number, x0: number, tau: number, t: number, t0 = 0) => (t < t0 ? x0 : xInf + (x0 - xInf) * Math.exp(-(t - t0) / tau));

export function rcCarga(): Circuit {
  const b = cb();
  b.el('V', 'E', '10', [0, 0], [0, 8]);
  b.el('SW', 'S1', '', [0, 0], [8, 0], { swMode: 'close', t0: '0' });
  b.el('R', 'R', '1k', [8, 0], [16, 0]);
  b.el('C', 'C', '1µ', [16, 0], [16, 8], { icMode: 'dc' });
  b.wire([0, 8], [16, 8]);
  b.gnd([0, 8]);
  return b.build();
}
export function rcDescarga(): Circuit {
  const b = cb();
  b.el('V', 'E', '12', [0, 0], [0, 8]);
  b.el('R', 'R1', '2k', [0, 0], [8, 0]);
  b.el('SW', 'S1', '', [8, 0], [16, 0], { swMode: 'open', t0: '0' });
  b.el('C', 'C', '10µ', [16, 0], [16, 8]);
  b.wire([16, 0], [24, 0]);
  b.el('R', 'R2', '5k', [24, 0], [24, 8]);
  b.wire([0, 8], [24, 8]);
  b.gnd([0, 8]);
  return b.build();
}
export function rlNatural(): Circuit {
  const b = cb();
  b.el('V', 'E', '10', [0, 0], [0, 8]);
  b.el('SW', 'S1', '', [0, 0], [8, 0], { swMode: 'open', t0: '0' });
  b.el('R', 'R1', '10', [8, 0], [16, 0]);
  b.el('L', 'L', '1', [16, 0], [16, 8]);
  b.wire([16, 0], [24, 0]);
  b.el('R', 'R2', '20', [24, 0], [24, 8]);
  b.wire([0, 8], [24, 8]);
  b.gnd([0, 8]);
  return b.build();
}
export function rlEscalon(): Circuit {
  const b = cb();
  b.el('V', 'E', '24', [0, 0], [0, 8]);
  b.el('SW', 'S1', '', [0, 0], [8, 0], { swMode: 'close', t0: '0' });
  b.el('R', 'R', '8', [8, 0], [16, 0]);
  b.el('L', 'L', '0,4', [16, 0], [16, 8]);
  b.wire([0, 8], [16, 8]);
  b.gnd([0, 8]);
  return b.build();
}
export function secuencial(): Circuit {
  const b = cb();
  b.el('V', 'E', '10', [0, 0], [0, 8]);
  b.el('SW', 'S1', '', [0, 0], [8, 0], { swMode: 'close', t0: '0' });
  b.el('R', 'R', '1k', [8, 0], [16, 0]);
  b.el('C', 'C', '1µ', [16, 0], [16, 8]);
  b.wire([16, 0], [24, 0]);
  b.el('SW', 'S2', '', [24, 0], [24, 4], { swMode: 'close', t0: '2m' });
  b.el('R', 'R2', '1k', [24, 4], [24, 8]);
  b.wire([0, 8], [24, 8]);
  b.gnd([0, 8]);
  return b.build();
}
/** RC con fuente dependiente: R_eq por fuente de prueba */
export function rcDependiente(): Circuit {
  const b = cb();
  b.el('V', 'E', '20', [0, 0], [0, 8]);
  b.el('SW', 'S1', '', [0, 0], [8, 0], { swMode: 'close', t0: '0' });
  b.el('R', 'R1', '4k', [8, 0], [16, 0], { id: 'rx', varName: 'Iₓ' });
  b.el('C', 'C', '50µ', [16, 0], [16, 8]);
  b.wire([16, 0], [24, 0]);
  b.el('CCCS', 'F', '0,5', [24, 0], [24, 8], { ctrlRef: 'rx' });
  b.wire([0, 8], [24, 8]);
  b.gnd([0, 8]);
  return b.build();
}
