import { describe, expect, it } from 'vitest';
import { cb } from '../engine/builder';
import { analyze } from '../engine/analyze';
import { Circuit } from '../engine/types';

const codes = (c: Circuit, mode: 'dc' | 'transient' = 'dc', wantsMesh = false) => analyze(c, { mode, wantsMesh }).issues.map((i) => i.code);

function loop(extra: (b: ReturnType<typeof cb>) => void) {
  const b = cb();
  extra(b);
  return b.build();
}

describe('validador: un caso por cada tipo de error', () => {
  it('circuito vacío', () => expect(codes({ elements: [], wires: [] })).toContain('vacio'));
  it('terminal suelto', () => {
    const c = loop((b) => {
      b.el('V', 'E', '10', [0, 0], [0, 8]);
      b.el('R', 'R1', '10', [0, 0], [8, 0]);
      b.gnd([0, 8]);
    });
    expect(codes(c)).toContain('suelto');
  });
  it('circuito abierto / sin camino cerrado', () => {
    const c = loop((b) => {
      b.el('V', 'E', '10', [0, 0], [0, 8]);
      b.el('R', 'R1', '10', [0, 0], [8, 0]);
      b.el('R', 'R2', '10', [8, 0], [8, 8]);
      b.el('VM', 'Vm', '', [0, 8], [8, 8]);
      b.gnd([0, 8]);
    });
    const cs = codes(c);
    expect(cs.some((x) => x === 'abierto' || x === 'instrumento')).toBe(true);
  });
  it('componente aislado / nodo flotante', () => {
    const c = loop((b) => {
      b.el('V', 'E', '10', [0, 0], [0, 8]);
      b.el('R', 'R1', '10', [0, 0], [8, 0]);
      b.wire([8, 0], [8, 8], [0, 8]);
      b.gnd([0, 8]);
      b.el('R', 'Rx', '10', [20, 0], [20, 8]);
      b.el('R', 'Ry', '10', [20, 0], [28, 0]);
      b.wire([28, 0], [28, 8], [20, 8]);
    });
    expect(codes(c)).toContain('aislado');
  });
  it('falta de tierra: se asigna y se avisa', () => {
    const c = loop((b) => {
      b.el('V', 'E', '10', [0, 0], [0, 8]);
      b.el('R', 'R1', '10', [0, 0], [8, 0]);
      b.wire([8, 0], [8, 8], [0, 8]);
    });
    const a = analyze(c);
    expect(a.issues.map((i) => i.code)).toContain('tierra');
    expect(a.ok).toBe(true);
  });
  it('fuente de voltaje en cortocircuito', () => {
    const c = loop((b) => {
      b.el('V', 'E', '10', [0, 0], [0, 8]);
      b.wire([0, 0], [4, 0], [4, 8], [0, 8]);
      b.el('R', 'R1', '10', [4, 0], [12, 0]);
      b.wire([12, 0], [12, 8], [4, 8]);
      b.gnd([0, 8]);
    });
    expect(codes(c)).toContain('vcorto');
  });
  it('fuentes de voltaje en paralelo con valores distintos', () => {
    const c = loop((b) => {
      b.el('V', 'E1', '10', [0, 0], [0, 8]);
      b.el('V', 'E2', '12', [8, 0], [8, 8]);
      b.wire([0, 0], [8, 0]);
      b.wire([0, 8], [8, 8]);
      b.el('R', 'R', '5', [8, 0], [16, 0]);
      b.wire([16, 0], [16, 8], [8, 8]);
      b.gnd([0, 8]);
    });
    const a = analyze(c);
    const iss = a.issues.find((i) => i.code === 'vparalelo')!;
    expect(iss).toBeTruthy();
    expect(iss.why).toMatch(/LVK/);
  });
  it('fuentes de voltaje iguales en paralelo: permitido con aviso y se resuelve', () => {
    const c = loop((b) => {
      b.el('V', 'E1', '10', [0, 0], [0, 8]);
      b.el('V', 'E2', '10', [8, 0], [8, 8]);
      b.wire([0, 0], [8, 0]);
      b.wire([0, 8], [8, 8]);
      b.el('R', 'R', '5', [8, 0], [16, 0]);
      b.wire([16, 0], [16, 8], [8, 8]);
      b.gnd([0, 8]);
    });
    const a = analyze(c);
    expect(a.issues.map((i) => i.code)).toContain('vparaleloigual');
    expect(a.ok).toBe(true);
  });
  it('fuentes de corriente en serie con valores distintos', () => {
    const c = loop((b) => {
      b.el('I', 'I1', '2', [0, 8], [0, 0]);
      b.el('I', 'I2', '3', [0, 0], [8, 0]);
      b.el('R', 'R', '5', [8, 0], [8, 8]);
      b.wire([0, 8], [8, 8]);
      b.gnd([0, 8]);
    });
    const a = analyze(c);
    const iss = a.issues.find((i) => i.code === 'iserie')!;
    expect(iss).toBeTruthy();
    expect(iss.why).toMatch(/LCK/);
  });
  it('fuente de corriente en circuito abierto', () => {
    const c = loop((b) => {
      b.el('I', 'I1', '2', [0, 8], [0, 0]);
      b.el('VM', 'Vm', '', [0, 0], [8, 0]);
      b.el('R', 'R', '5', [8, 0], [8, 8]);
      b.wire([0, 8], [8, 8]);
      b.gnd([0, 8]);
    });
    expect(codes(c)).toContain('iabierto');
  });
  it('valores inválidos: R ≤ 0, C ≤ 0, unidad mal escrita, campo vacío', () => {
    const c = loop((b) => {
      b.el('V', 'E', '', [0, 0], [0, 8]);
      b.el('R', 'R1', '-5', [0, 0], [8, 0]);
      b.el('C', 'C1', '0', [8, 0], [8, 8]);
      b.el('R', 'R2', '4,7x', [8, 0], [16, 0]);
      b.wire([16, 0], [16, 8], [0, 8]);
      b.gnd([0, 8]);
    });
    const a = analyze(c);
    expect(a.issues.filter((i) => i.code === 'valor').length).toBeGreaterThanOrEqual(4);
  });
  it('fuente dependiente con control inexistente', () => {
    const c = loop((b) => {
      b.el('V', 'E', '10', [0, 0], [0, 8]);
      b.el('R', 'R1', '10', [0, 0], [8, 0]);
      b.el('CCCS', 'F', '2', [8, 8], [8, 0]);
      b.wire([0, 8], [8, 8]);
      b.gnd([0, 8]);
    });
    expect(codes(c)).toContain('control');
  });
  it('sistema singular (VCVS de ganancia 1 en paralelo con su propio control)', () => {
    const c = loop((b) => {
      b.el('V', 'E', '10', [0, 0], [0, 8]);
      b.el('R', 'R1', '10', [0, 0], [8, 0]);
      b.el('R', 'R2', '10', [8, 0], [8, 8], { id: 'r2' });
      b.wire([8, 0], [16, 0]);
      b.el('VCVS', 'D', '1', [16, 0], [16, 8], { ctrlRef: 'r2' });
      b.wire([0, 8], [16, 8]);
      b.gnd([0, 8]);
    });
    const a = analyze(c);
    const iss = a.issues.find((i) => i.code === 'singular')!;
    expect(iss).toBeTruthy();
    expect(iss.why).toMatch(/ganancia/);
  });
  it('capacitor en serie con fuente de corriente sin camino en DC', () => {
    const c = loop((b) => {
      b.el('I', 'Is', '1m', [0, 8], [0, 0]);
      b.el('C', 'C1', '1µ', [0, 0], [8, 0]);
      b.el('R', 'R', '1k', [8, 0], [8, 8]);
      b.wire([0, 8], [8, 8]);
      b.gnd([0, 8]);
    });
    expect(codes(c)).toContain('cserie');
  });
  it('inductor en paralelo con fuente de voltaje en DC', () => {
    const c = loop((b) => {
      b.el('V', 'E', '10', [0, 0], [0, 8]);
      b.wire([0, 0], [8, 0]);
      b.el('L', 'L1', '1', [8, 0], [8, 8]);
      b.wire([0, 8], [8, 8]);
      b.gnd([0, 8]);
    });
    expect(codes(c)).toContain('lparalelo');
  });
  it('malla pedida en un circuito no planar (dibujo con cruces)', () => {
    const c = loop((b) => {
      b.el('V', 'E', '10', [0, 0], [0, 8]);
      b.el('R', 'R1', '10', [0, 0], [8, 0]);
      b.wire([8, 0], [8, 8], [0, 8]);
      b.wire([4, -4], [4, 12]);
      b.el('R', 'R2', '10', [4, 12], [12, 12]);
      b.wire([12, 12], [12, -4], [4, -4]);
      b.gnd([0, 8]);
    });
    const a = analyze(c, { wantsMesh: true });
    expect(a.topo.crossings.length).toBeGreaterThan(0);
    expect(a.issues.map((i) => i.code)).toContain('noplanar');
  });
  it('instrumentos mal conectados: amperímetro en paralelo y voltímetro en serie', () => {
    const c = loop((b) => {
      b.el('V', 'E', '10', [0, 0], [0, 8]);
      b.el('R', 'R1', '10', [0, 0], [8, 0]);
      b.el('R', 'R2', '10', [8, 0], [8, 8]);
      b.wire([8, 0], [16, 0]);
      b.el('AM', 'A1', '', [16, 0], [16, 8]);
      b.wire([0, 8], [16, 8]);
      b.gnd([0, 8]);
    });
    expect(codes(c)).toContain('instrumento');
    const c2 = loop((b) => {
      b.el('V', 'E', '10', [0, 0], [0, 8]);
      b.el('VM', 'V1', '', [0, 0], [8, 0]);
      b.el('R', 'R2', '10', [8, 0], [8, 8]);
      b.wire([0, 8], [8, 8]);
      b.gnd([0, 8]);
    });
    expect(codes(c2)).toContain('instrumento');
  });
  it('advertencias: resistencia en corto y elemento sin corriente', () => {
    const c = loop((b) => {
      b.el('V', 'E', '10', [0, 0], [0, 8]);
      b.el('R', 'R1', '10', [0, 0], [8, 0]);
      b.el('R', 'R2', '10', [8, 0], [8, 8]);
      b.el('R', 'R3', '5', [8, 4], [16, 4]);
      b.wire([8, 4], [8, 8]);
      b.wire([16, 4], [16, 8], [0, 8]);
      b.gnd([0, 8]);
    });
    const a = analyze(c);
    expect(a.issues.some((i) => i.severity === 'warning')).toBe(true);
  });
  it('cada error tiene qué, por qué, consecuencia y cómo corregir', () => {
    const c = loop((b) => {
      b.el('V', 'E', '10', [0, 0], [0, 8]);
      b.wire([0, 0], [4, 0], [4, 8], [0, 8]);
      b.gnd([0, 8]);
    });
    for (const i of analyze(c).issues) {
      expect(i.what.length).toBeGreaterThan(5);
      expect(i.why.length).toBeGreaterThan(5);
      expect(i.consequence.length).toBeGreaterThan(3);
      expect(i.fix.length).toBeGreaterThan(5);
    }
  });
});
