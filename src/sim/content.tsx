import React from 'react';
import { pick } from '../core/engine/generate';
import { texNum, texQ } from '../core/engine/units';
import { Tex } from '../core/ui/basic';
import { CircuitPreview } from '../core/ui/CircuitPreview';
import { ExerciseGen, LearnSection } from '../core/ui/Practice';
import { P, T } from '../core/ui/panels';
import { rcCarga, rcDependiente, rcDescarga, rlEscalon, rlNatural, secuencial } from './calc';

export const LEARN: LearnSection[] = [
  {
    title: '6.1 Respuesta natural RL y RC',
    body: (
      <>
        <p>Sin fuentes, la energía almacenada se disipa en las resistencias:</p>
        <Tex block tex="i(t) = I_0 e^{-t/\tau},\ \tau = \frac{L}{R}\qquad v(t) = V_0 e^{-t/\tau},\ \tau = RC" />
        <CircuitPreview circuit={rlNatural()} height={170} />
      </>
    ),
  },
  {
    title: '6.2 Respuesta al escalón',
    body: (
      <>
        <Tex block tex="x(t) = x(\infty) + [x(t_0^+) - x(\infty)]\,e^{-(t-t_0)/\tau}" />
        <p>Vale para cualquier corriente o voltaje del circuito. En t = τ se recorre el 63,2 % del cambio; en 5τ, el 99,3 %.</p>
        <CircuitPreview circuit={rcCarga()} height={170} />
      </>
    ),
  },
  {
    title: '6.3 Método completo',
    body: (
      <ol>
        <li>Circuito para t &lt; t₀ en DC (L = corto, C = abierto) → i_L(t₀⁻) o v_C(t₀⁻).</li>
        <li>Continuidad: i_L(t₀⁺) = i_L(t₀⁻), v_C(t₀⁺) = v_C(t₀⁻).</li>
        <li>Circuito para t &gt; t₀: Thévenin visto por L o C → R_eq y τ.</li>
        <li>Valor final x(∞) en DC con la nueva posición de los interruptores.</li>
        <li>Escribir la ecuación final.</li>
      </ol>
    ),
  },
  { title: '6.4 Llaveo secuencial', body: <><p>Con varios interruptores en instantes distintos se resuelve intervalo por intervalo: el valor al final de un intervalo es la condición inicial del siguiente.</p><CircuitPreview circuit={secuencial()} height={170} /></> },
  { title: '6.5 Fuentes dependientes', body: <><p>Las dependientes no se apagan: R_eq se halla con una fuente de prueba (1 V o 1 A) en los terminales de L o C.</p><CircuitPreview circuit={rcDependiente()} height={170} /></> },
];

export const GLOSSARY = [
  { term: 'Constante de tiempo τ', def: 'Tiempo en que la exponencial recorre el 63,2 % del cambio: L/R o RC.' },
  { term: 'Respuesta natural', def: 'Respuesta sin fuentes: la energía almacenada se disipa.' },
  { term: 'Respuesta al escalón', def: 'Respuesta al conectar súbitamente una fuente DC.' },
  { term: 't₀⁻ y t₀⁺', def: 'Instantes justo antes y justo después de la conmutación.' },
];

export const GENS: ExerciseGen[] = [
  {
    id: 'Constante de tiempo',
    subtopic: '6.1–6.2',
    gen: (r) => {
      const isRL = r() < 0.5;
      const R = pick(r, [10, 20, 50, 100, 1000]);
      const K = isRL ? pick(r, [0.1, 0.5, 1, 2]) : pick(r, [1e-6, 10e-6, 100e-6]);
      const tau = isRL ? K / R : R * K;
      return { prompt: isRL ? `Un circuito RL tiene R = ${R} Ω y L = ${K} H. Halle τ.` : `Un circuito RC tiene R = ${R} Ω y C = ${texNum(K * 1e6)} µF. Halle τ.`, answers: [{ label: '\\tau', value: tau, unit: 's' }], hints: [isRL ? 'τ = L/R' : 'τ = RC'], solution: [T(`\\tau = ${texQ(tau, 's')}`)] };
    },
  },
  {
    id: 'Respuesta al escalón RC',
    subtopic: '6.2 Escalón',
    gen: (r) => {
      const E = pick(r, [5, 10, 12, 24]);
      const R = pick(r, [1000, 2000, 4700]);
      const C = pick(r, [1e-6, 10e-6, 47e-6]);
      const tau = R * C;
      const t = pick(r, [0.5, 1, 2, 3]) * tau;
      const v = E * (1 - Math.exp(-t / tau));
      return { prompt: `Un capacitor descargado de ${texNum(C * 1e6)} µF se carga desde ${E} V a través de ${R} Ω. ¿Cuánto vale v_C en t = ${texNum(t, 4)} s?`, answers: [{ label: 'v_C', value: v, unit: 'V' }], hints: ['$v_C(t) = E(1 - e^{-t/RC})$'], solution: [T(`v_C = ${E}(1 - e^{-${texNum(t / tau, 3)}}) = ${texQ(v, 'V')}`)] };
    },
  },
  {
    id: 'Respuesta natural RL',
    subtopic: '6.1 Natural',
    gen: (r) => {
      const I0 = pick(r, [1, 2, 3, 5]);
      const R = pick(r, [10, 20, 40]);
      const L = pick(r, [0.5, 1, 2]);
      const tau = L / R;
      const t = pick(r, [1, 2, 3]) * tau;
      return { prompt: `Un inductor de ${L} H con I₀ = ${I0} A se descarga por ${R} Ω. Halle i(t) en t = ${texNum(t, 4)} s y la energía total disipada.`, answers: [{ label: 'i', value: I0 * Math.exp(-t / tau), unit: 'A' }, { label: 'W', value: 0.5 * L * I0 * I0, unit: 'J' }], hints: ['$i = I_0 e^{-t/\\tau}$', 'La energía disipada es ½LI₀².'], solution: [P(`τ = ${texNum(tau)} s`), T(`i = ${texQ(I0 * Math.exp(-t / tau), 'A')},\\ W = ${texQ(0.5 * L * I0 * I0, 'J')}`)] };
    },
  },
];

export const TEMPLATES = [
  { name: 'RC: carga al escalón', desc: 'E = 10 V, R = 1 kΩ, C = 1 µF: τ = 1 ms; v_C → 10 V.', circuit: rcCarga },
  { name: 'RC: descarga (respuesta natural)', desc: 'El interruptor se abre y C se descarga por R2: τ = 50 ms.', circuit: rcDescarga },
  { name: 'RL: respuesta natural', desc: 'I₀ = 1 A, τ = L/R2 = 50 ms; energía inicial 0,5 J = energía disipada.', circuit: rlNatural },
  { name: 'RL: respuesta al escalón', desc: 'i_L → 3 A con τ = 50 ms.', circuit: rlEscalon },
  { name: 'Llaveo secuencial', desc: 'S1 se cierra en 0 y S2 en 2 ms: τ cambia de 1 ms a 0,5 ms.', circuit: secuencial },
  { name: 'RC con fuente dependiente', desc: 'R_eq por fuente de prueba: R_eq = 8 kΩ, τ = 0,4 s.', circuit: rcDependiente },
];
