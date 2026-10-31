// Ayudante para construir circuitos con geometría (plantillas, pruebas y generador de ejercicios).
import { CElement, Circuit, ELEMENT_LEN, Kind, Pt } from './types';

type P = [number, number];

export class CircuitBuilder {
  c: Circuit = { elements: [], wires: [], nodeNames: [] };
  private n = 0;
  private uid(p: string) {
    this.n++;
    return `${p}${this.n}`;
  }
  /**
   * Coloca un elemento entre `a` (terminal a, +) y `b` (terminal b, −) sobre una línea horizontal o vertical.
   * Si el tramo es más largo que el elemento, lo centra y completa con cables.
   */
  el(kind: Kind, label: string, value: string, a: P, b: P, extra: Partial<CElement> = {}): string {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    if (dx !== 0 && dy !== 0) throw new Error(`Elemento ${label} no está alineado`);
    const L = Math.abs(dx + dy);
    if (L < ELEMENT_LEN) throw new Error(`Tramo muy corto para ${label}`);
    const ux = Math.sign(dx);
    const uy = Math.sign(dy);
    const off = Math.floor((L - ELEMENT_LEN) / 2);
    const p0: Pt = { x: a[0] + ux * off, y: a[1] + uy * off };
    const p1: Pt = { x: p0.x + ux * ELEMENT_LEN, y: p0.y + uy * ELEMENT_LEN };
    if (off > 0) this.wire(a, [p0.x, p0.y]);
    if (L - ELEMENT_LEN - off > 0) this.wire([p1.x, p1.y], b);
    // rotación según la dirección de a→b
    const rot = ux === 1 ? 0 : uy === 1 ? 1 : ux === -1 ? 2 : 3;
    const id = extra.id ?? this.uid(kind);
    this.c.elements.push({ id, kind, label, value, x: p0.x, y: p0.y, rot: rot as 0 | 1 | 2 | 3, ...extra });
    return id;
  }
  wire(...pts: P[]) {
    for (let i = 0; i + 1 < pts.length; i++) {
      this.c.wires.push({ id: this.uid('w'), a: { x: pts[i][0], y: pts[i][1] }, b: { x: pts[i + 1][0], y: pts[i + 1][1] } });
    }
    return this;
  }
  gnd(p: P) {
    this.c.elements.push({ id: this.uid('g'), kind: 'GND', label: 'Tierra', value: '', x: p[0], y: p[1], rot: 0 });
    return this;
  }
  name(p: P, name: string) {
    this.c.nodeNames!.push({ x: p[0], y: p[1], name });
    return this;
  }
  build(): Circuit {
    return JSON.parse(JSON.stringify(this.c));
  }
}

export const cb = () => new CircuitBuilder();
