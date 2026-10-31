// Modelo de datos del circuito (lo que dibuja el editor) y de la netlist (lo que resuelve el motor).

export type Kind =
  | 'R' // resistencia
  | 'G' // conductancia
  | 'V' // fuente independiente de voltaje
  | 'I' // fuente independiente de corriente
  | 'VCVS' // fuente de voltaje controlada por voltaje
  | 'VCCS' // fuente de corriente controlada por voltaje
  | 'CCVS' // fuente de voltaje controlada por corriente
  | 'CCCS' // fuente de corriente controlada por corriente
  | 'L'
  | 'C'
  | 'SW' // interruptor
  | 'AM' // amperímetro ideal
  | 'VM' // voltímetro ideal
  | 'GND';

export interface Pt {
  x: number;
  y: number;
}

/** Elemento tal como lo guarda el editor. Coordenadas en unidades de grilla. */
export interface CElement {
  id: string;
  kind: Kind;
  label: string;
  x: number;
  y: number;
  /** rotación en pasos de 90° */
  rot: 0 | 1 | 2 | 3;
  /** voltear: invierte la polaridad (intercambia terminales a y b) */
  flip?: boolean;
  /** valor escrito por el usuario, con prefijo SI (ej. "4,7k") */
  value: string;
  /** id del elemento cuya v (o i) controla a esta fuente dependiente */
  ctrlRef?: string;
  /** interruptor: 'close' = se cierra en t0 (normalmente abierto); 'open' = se abre en t0 */
  swMode?: 'close' | 'open';
  t0?: string;
  /** L y C: condición inicial dada (iL o vC) */
  ic?: string;
  /** L y C: 'dc' = calcular la condición inicial con el régimen permanente previo; 'given' = usar ic */
  icMode?: 'dc' | 'given';
  /** nombre opcional de la variable asociada (Iₓ, V_Δ…) que se muestra en el dibujo */
  varName?: string;
}

export interface Wire {
  id: string;
  a: Pt;
  b: Pt;
}

export interface NodeName {
  x: number;
  y: number;
  name: string;
}

export interface Circuit {
  elements: CElement[];
  wires: Wire[];
  nodeNames?: NodeName[];
}

export const ELEMENT_LEN = 4; // longitud de un elemento de dos terminales (unidades de grilla)

export const KIND_INFO: Record<Kind, { name: string; unit: string; valueLabel: string; prefix: string; twoTerminal: boolean }> = {
  R: { name: 'Resistencia', unit: 'Ω', valueLabel: 'R', prefix: 'R', twoTerminal: true },
  G: { name: 'Conductancia', unit: 'S', valueLabel: 'G', prefix: 'G', twoTerminal: true },
  V: { name: 'Fuente de voltaje', unit: 'V', valueLabel: 'E', prefix: 'E', twoTerminal: true },
  I: { name: 'Fuente de corriente', unit: 'A', valueLabel: 'I', prefix: 'Is', twoTerminal: true },
  VCVS: { name: 'Fuente de voltaje controlada por voltaje (VCVS)', unit: '', valueLabel: 'μ (adimensional)', prefix: 'Vd', twoTerminal: true },
  VCCS: { name: 'Fuente de corriente controlada por voltaje (VCCS)', unit: 'S', valueLabel: 'g [S]', prefix: 'Id', twoTerminal: true },
  CCVS: { name: 'Fuente de voltaje controlada por corriente (CCVS)', unit: 'Ω', valueLabel: 'r [Ω]', prefix: 'Vd', twoTerminal: true },
  CCCS: { name: 'Fuente de corriente controlada por corriente (CCCS)', unit: '', valueLabel: 'β (adimensional)', prefix: 'Id', twoTerminal: true },
  L: { name: 'Inductor', unit: 'H', valueLabel: 'L', prefix: 'L', twoTerminal: true },
  C: { name: 'Capacitor', unit: 'F', valueLabel: 'C', prefix: 'C', twoTerminal: true },
  SW: { name: 'Interruptor', unit: 's', valueLabel: 't₀', prefix: 'S', twoTerminal: true },
  AM: { name: 'Amperímetro', unit: '', valueLabel: '', prefix: 'A', twoTerminal: true },
  VM: { name: 'Voltímetro', unit: '', valueLabel: '', prefix: 'Vm', twoTerminal: true },
  GND: { name: 'Tierra', unit: '', valueLabel: '', prefix: 'GND', twoTerminal: false },
};

export const isVoltageControlled = (k: Kind) => k === 'VCVS' || k === 'VCCS';
export const isCurrentControlled = (k: Kind) => k === 'CCVS' || k === 'CCCS';
export const isDependent = (k: Kind) => k === 'VCVS' || k === 'VCCS' || k === 'CCVS' || k === 'CCCS';
export const isVoltageSourceLike = (k: Kind) => k === 'V' || k === 'VCVS' || k === 'CCVS';
export const isCurrentSourceLike = (k: Kind) => k === 'I' || k === 'VCCS' || k === 'CCCS';
export const isSource = (k: Kind) => isVoltageSourceLike(k) || isCurrentSourceLike(k);

/** Elemento ya conectado a nodos (índices). El nodo 0 es la referencia (tierra). */
export interface NetElement {
  id: string;
  kind: Kind;
  label: string;
  /** valor numérico ya interpretado (R, V, I, ganancia, L, C, t0 del interruptor…) */
  value: number;
  /** nodo del terminal a (+) */
  n1: number;
  /** nodo del terminal b (−) */
  n2: number;
  ctrlRef?: string;
  swMode?: 'close' | 'open';
  t0?: number;
  ic?: number;
  icMode?: 'dc' | 'given';
  varName?: string;
}

export interface Netlist {
  /** número de nodos incluida la referencia (índice 0) */
  nodeCount: number;
  elements: NetElement[];
  nodeNames: string[];
  /** puntos de grilla que pertenecen a cada nodo (para dibujar) */
  nodePoints: Pt[][];
  /** true si la tierra se asignó automáticamente */
  autoGround: boolean;
  /** errores de interpretación de valores */
  valueErrors: { id: string; label: string; message: string }[];
  /** terminales sueltos detectados al armar la netlist */
  danglingPins: { id: string; label: string; pin: 'a' | 'b'; at: Pt }[];
}
