import { describe, expect, it } from 'vitest';
import { cb } from '../engine/builder';
import { analyze } from '../engine/analyze';
import { meshAnalysis } from '../engine/methods/mesh';
import { nodalAnalysis } from '../engine/methods/nodal';
import { branchAnalysis } from '../engine/methods/branch';
import { thevenin, superposition, maxPower } from '../engine/methods/thevenin';
import { reduceNetwork, deltaToY, yToDelta, parallel } from '../engine/methods/reduce';
import { byLabel } from '../engine/mna';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1e-300, Math.abs(b));

/** Cuaderno, problema 4: 40 V, 2, 8, 6, 6, 4 Ω y 20 V */
export function cuaderno4() {
  const b = cb();
  b.el('V', 'E1', '40', [0, 0], [0, 8]);
  b.el('R', 'R2', '2', [0, 0], [8, 0]);
  b.el('R', 'R8', '8', [8, 0], [8, 8], { varName: 'Vo' });
  b.el('R', 'R6a', '6', [8, 0], [16, 0]);
  b.el('R', 'R6b', '6', [16, 0], [16, 8]);
  b.el('R', 'R4', '4', [16, 0], [24, 0]);
  b.el('V', 'E2', '20', [24, 0], [24, 8]);
  b.wire([0, 8], [24, 8]).gnd([0, 8]);
  return b.build();
}

/** Cuaderno, problema 10 (supermalla): 100 V, 50 V, 5 A */
export function cuaderno10() {
  const b = cb();
  b.wire([0, 0], [0, 6]).wire([16, 0], [16, 6]);
  b.el('R', 'R10', '10', [0, 0], [16, 0]);
  b.el('R', 'R3', '3', [0, 6], [8, 6]);
  b.el('R', 'R2', '2', [8, 6], [16, 6]);
  b.el('V', 'E100', '100', [0, 6], [0, 12]);
  b.el('I', 'I5', '5', [8, 12], [8, 6]);
  b.el('V', 'E50', '50', [16, 6], [16, 12]);
  b.el('R', 'R6', '6', [0, 12], [8, 12]);
  b.el('R', 'R4', '4', [8, 12], [16, 12]);
  b.gnd([8, 12]);
  return b.build();
}

/** Cuaderno: mallas con 4V_Δ (V_Δ = 30 I₄), geometría deducida de los resultados */
export function cuadernoVDelta() {
  const b = cb();
  b.el('V', 'E', '100', [0, 0], [0, 8]);
  b.el('R', 'R80', '80', [8, 0], [8, 8]);
  b.wire([0, 0], [8, 0]);
  b.el('R', 'R10', '10', [8, 0], [16, 0]);
  b.el('R', 'R60', '60', [16, 0], [16, 8]);
  b.el('VCVS', 'D', '4', [16, 0], [24, 0], { ctrlRef: 'r30' });
  b.el('R', 'R20', '20', [24, 0], [24, 8]);
  b.wire([24, 0], [32, 0]);
  b.el('R', 'R30', '30', [32, 0], [32, 8], { id: 'r30', varName: 'V_Δ' });
  b.wire([0, 8], [32, 8]).gnd([0, 8]);
  return b.build();
}

describe('topología y mallas', () => {
  it('cuaderno 4: cuenta nodos, ramas y mallas (l = b − n + 1)', () => {
    const a = analyze(cuaderno4());
    expect(a.ok).toBe(true);
    expect(a.topo.meshes.length).toBe(3);
    expect(a.topo.principalNodes.length).toBe(3);
    expect(a.topo.branches.length).toBe(5);
    expect(a.topo.branches.length - a.topo.principalNodes.length + 1).toBe(3);
  });
  it('cuaderno 4: Iₐ = 5,6; I_b = 2; I_c = −0,8 A; V₀ = 28,8 V', () => {
    const a = analyze(cuaderno4());
    const m = meshAnalysis(a.net, a.topo);
    expect(m.ok).toBe(true);
    const v = m.system!.values!;
    expect(rel(v.get('I_{1}')!, 5.6)).toBeLessThan(1e-9);
    expect(rel(v.get('I_{2}')!, 2)).toBeLessThan(1e-9);
    expect(rel(v.get('I_{3}')!, -0.8)).toBeLessThan(1e-9);
    expect(rel(byLabel(a.dc!, 'R8')!.v, 28.8)).toBeLessThan(1e-9);
  });
  it('cuaderno 10 (supermalla): I₁ = 1,25; I₂ = 1,75; I₃ = 6,75 A; V = 88 V', () => {
    const a = analyze(cuaderno10());
    expect(a.ok).toBe(true);
    const m = meshAnalysis(a.net, a.topo, 'cramer');
    expect(m.ok).toBe(true);
    expect(m.supermeshes.length).toBe(1);
    const v = m.system!.values!;
    // mallas ordenadas izquierda→derecha: la superior (centro x=8,y≈3) puede quedar en medio
    const vals = [...v.values()].sort((x, y) => x - y);
    expect(vals.map((x) => Math.round(x * 1000) / 1000)).toEqual([1.25, 1.75, 6.75]);
    expect(rel(byLabel(a.dc!, 'I5')!.v, -88)).toBeLessThan(1e-9);
  });
  it('cuaderno: mallas con 4V_Δ: I₁ = 3,75; I₂ = 2,5; I₃ = 1,25; I₄ = 0,5 A y balance 375 = 300 + 75', () => {
    const a = analyze(cuadernoVDelta());
    expect(a.ok).toBe(true);
    const m = meshAnalysis(a.net, a.topo);
    expect(m.ok).toBe(true);
    const v = m.system!.values!;
    expect(rel(v.get('I_{1}')!, 3.75)).toBeLessThan(1e-9);
    expect(rel(v.get('I_{2}')!, 2.5)).toBeLessThan(1e-9);
    expect(rel(v.get('I_{3}')!, 1.25)).toBeLessThan(1e-9);
    expect(rel(v.get('I_{4}')!, 0.5)).toBeLessThan(1e-9);
    expect(rel(byLabel(a.dc!, 'E')!.p, -375)).toBeLessThan(1e-9);
    expect(rel(byLabel(a.dc!, 'D')!.p, 75)).toBeLessThan(1e-9);
    expect(a.balance.ok).toBe(true);
    expect(rel(a.balance.delivered, 375)).toBeLessThan(1e-9);
  });
  it('nodos y ramas coinciden con MNA; LCK y LVK con residuo cero', () => {
    for (const c of [cuaderno4(), cuaderno10(), cuadernoVDelta()]) {
      const a = analyze(c);
      const n = nodalAnalysis(a.net);
      expect(n.ok).toBe(true);
      for (let k = 1; k < a.net.nodeCount; k++) expect(Math.abs(n.V[k] - a.dc!.V[k])).toBeLessThan(1e-9 * Math.max(1, Math.abs(a.dc!.V[k])));
      const br = branchAnalysis(a.net, a.topo);
      expect(br.ok).toBe(true);
      for (const e of a.net.elements) expect(Math.abs(br.current.get(e.id)! - a.dc!.el.get(e.id)!.i)).toBeLessThan(1e-9 * Math.max(1, Math.abs(a.dc!.el.get(e.id)!.i)));
      for (const k of a.kcl) expect(Math.abs(k.residual)).toBeLessThan(1e-9);
      for (const k of a.kvl) expect(Math.abs(k.residual)).toBeLessThan(1e-9);
    }
  });
});

describe('U3: reducción, Δ–Y y divisores', () => {
  it('Δ → Y con 10, 65 y 25 Ω da 6,5; 2,5 y 16,25 Ω', () => {
    const r = deltaToY(10, 65, 25);
    expect(rel(r.Rx, 6.5)).toBeLessThan(1e-12);
    expect(rel(r.Ry, 2.5)).toBeLessThan(1e-12);
    expect(rel(r.Rz, 16.25)).toBeLessThan(1e-12);
    const back = yToDelta(r.Rx, r.Ry, r.Rz);
    expect(rel(back.R1, 10)).toBeLessThan(1e-12);
  });
  it('puente de 9 Ω: Δ de 9 Ω → Y de 3 Ω; 18 ∥ 27 ∥ 18 = 6,75 Ω', () => {
    expect(deltaToY(9, 9, 9).Rx).toBeCloseTo(3, 12);
    expect(rel(parallel(18, 27, 18), 6.75)).toBeLessThan(1e-12);
  });
  it('ejemplos del material: 1 k + 250 ∥ 500 = 1166,67 Ω; 1 k + 250 ∥ 500 ∥ 1500 = 1150 Ω', () => {
    const e = (id: string, R: number, a: number, b: number) => ({ id, name: id, R, a, b, from: [id] });
    const r1 = reduceNetwork([e('R1', 1000, 0, 1), e('R2', 250, 1, 2), e('R3', 500, 1, 2)], 0, 2);
    expect(rel(r1.Req, 1000 + (250 * 500) / 750)).toBeLessThan(1e-12);
    const r2 = reduceNetwork([e('R1', 1000, 0, 1), e('R2', 250, 1, 2), e('R3', 500, 1, 2), e('R4', 1500, 1, 2)], 0, 2);
    expect(rel(r2.Req, 1150)).toBeLessThan(1e-12);
  });
  it('puente de Wheatstone no balanceado requiere Δ→Y y coincide con MNA', () => {
    const e = (id: string, R: number, a: number, b: number) => ({ id, name: id, R, a, b, from: [id] });
    const net = [e('R1', 10, 0, 1), e('R2', 20, 0, 2), e('R3', 30, 1, 3), e('R4', 40, 2, 3), e('R5', 50, 1, 2)];
    const r = reduceNetwork(net, 0, 3);
    expect(r.ok).toBe(true);
    expect(r.usedDeltaY).toBe(true);
    // referencia por MNA con fuente de prueba
    const b = cb();
    b.el('I', 'Ip', '1', [0, 8], [0, 0]);
    b.el('R', 'R1', '10', [0, 0], [8, 0]);
    b.el('R', 'R2', '20', [0, 0], [0, -8]);
    b.wire([0, -8], [8, -8]);
    b.el('R', 'R5', '50', [8, 0], [8, -8]);
    b.el('R', 'R3', '30', [8, 0], [16, 0]);
    b.el('R', 'R4', '40', [8, -8], [16, -8]);
    b.wire([16, -8], [16, 0], [16, 8], [0, 8]).gnd([0, 8]);
    const a = analyze(b.build());
    expect(a.ok).toBe(true);
    expect(rel(-byLabel(a.dc!, 'Ip')!.v, r.Req)).toBeLessThan(1e-9);
  });
});

describe('U4: Thévenin, superposición, máxima potencia', () => {
  it('Thévenin con solo independientes coincide con la carga real', () => {
    const b = cb();
    b.el('V', 'E', '12', [0, 0], [0, 8]);
    b.el('R', 'R1', '4', [0, 0], [8, 0]);
    b.el('R', 'R2', '12', [8, 0], [8, 8]);
    b.el('R', 'RL', '3', [8, 0], [16, 0]);
    b.wire([16, 0], [16, 8], [0, 8]).gnd([0, 8]);
    const a = analyze(b.build());
    const RL = a.net.elements.find((x) => x.label === 'RL')!;
    const th = thevenin(a.net, RL.n1, RL.n2 === 0 ? 0 : RL.n2, [RL.id]);
    expect(th.ok).toBe(true);
    expect(rel(th.Eth, 9)).toBeLessThan(1e-9);
    expect(rel(th.Rth, 3)).toBeLessThan(1e-9);
    const iL = th.Eth / (th.Rth + 3);
    expect(rel(byLabel(a.dc!, 'RL')!.i, iL)).toBeLessThan(1e-9);
    expect(maxPower(th.Eth, th.Rth).Pmax).toBeCloseTo(81 / 12, 9);
  });
  it('Thévenin con dependientes: E_TH / I_CC y fuente de prueba', () => {
    // TP4 nodos, ejercicio 1: el resultado de la red debe ser coherente por los tres caminos
    const b = cb();
    b.el('V', 'E', '10', [0, 0], [0, 8]);
    b.el('R', 'R1', '2', [0, 0], [8, 0], { id: 'r1' });
    b.el('R', 'R2', '4', [8, 0], [8, 8]);
    b.el('CCCS', 'F', '0.5', [16, 8], [16, 0], { ctrlRef: 'r1' });
    b.wire([8, 0], [16, 0]).wire([0, 8], [16, 8]).gnd([0, 8]);
    const a = analyze(b.build());
    const node = a.net.elements.find((x) => x.label === 'R2')!.n1;
    const th = thevenin(a.net, node, 0);
    expect(th.case).toBe('mixto');
    const s = superposition(a.net);
    expect(s.ok).toBe(true);
    // con dependientes y sin independientes: fuente de prueba
    const th2 = thevenin({ ...a.net, elements: a.net.elements.filter((e) => e.label !== 'E') }, node, 0);
    expect(th2.case).toBe('dependientes');
    expect(th2.ok).toBe(true);
    // R vista: R2 ∥ (R1 con la dependiente) se verifica contra 1V
    const th3 = thevenin({ ...a.net, elements: a.net.elements.filter((e) => e.label !== 'E') }, node, 0, [], '1V');
    expect(rel(th3.Rth, th2.Rth)).toBeLessThan(1e-9);
  });
  it('superposición: la suma de las respuestas parciales da la total', () => {
    const a = analyze(cuaderno10());
    const s = superposition(a.net);
    for (const e of a.net.elements) {
      const sum = s.parts.reduce((acc, p) => acc + p.result.el.get(e.id)!.i, 0);
      expect(Math.abs(sum - a.dc!.el.get(e.id)!.i)).toBeLessThan(1e-9 * Math.max(1, Math.abs(sum)));
    }
  });
});
