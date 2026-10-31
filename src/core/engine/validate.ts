// Validador: detecta configuraciones sin sentido físico antes de calcular y las explica.
import { solveMNA, switchStateAfter, switchStateBefore } from './mna';
import { Circuit, Netlist, NetElement, isCurrentSourceLike, isDependent, isVoltageSourceLike, KIND_INFO } from './types';
import { fmtEng } from './units';

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  code: string;
  severity: Severity;
  /** qué pasa */
  what: string;
  /** por qué es un error físico (qué ley viola) */
  why: string;
  /** qué causaría en un circuito real */
  consequence: string;
  /** cómo corregirlo */
  fix: string;
  elements: string[];
  nodes: number[];
}

export interface ValidateOptions {
  /** 'dc' (régimen permanente) o 'transient' (con interruptores, L y C) */
  mode?: 'dc' | 'transient';
  /** se pidió el método de mallas */
  wantsMesh?: boolean;
  /** el dibujo no es planar (lo calcula la topología) */
  nonPlanar?: boolean;
}

const mk = (code: string, severity: Severity, what: string, why: string, consequence: string, fix: string, elements: string[] = [], nodes: number[] = []): Issue => ({ code, severity, what, why, consequence, fix, elements, nodes });

export function validate(c: Circuit | null, net: Netlist, opt: ValidateOptions = {}): Issue[] {
  const out: Issue[] = [];
  const mode = opt.mode ?? 'dc';
  const els = net.elements;
  const byId = new Map(els.map((e) => [e.id, e]));
  if (!els.length) {
    out.push(mk('vacio', 'error', 'El circuito está vacío.', 'Sin elementos no hay trayectoria cerrada (concepto de circuito, U2 punto 2.1).', 'No hay nada que medir.', 'Arrastre elementos desde la paleta y únalos con cables, o cargue una plantilla.'));
    return out;
  }
  // valores
  for (const ve of net.valueErrors)
    out.push(mk('valor', 'error', `Valor inválido — ${ve.message}`, 'Cada elemento necesita un número con su unidad para poder aplicar la ley de Ohm y las leyes de Kirchhoff.', 'El simulador no puede calcular nada con un dato mal escrito.', 'Escriba el valor con prefijo SI, por ejemplo 4,7k · 220µ · 2m · 1e-3.', [ve.id]));
  const bad = new Set(net.valueErrors.map((v) => v.id));
  for (const e of els) {
    if (bad.has(e.id)) continue;
    if ((e.kind === 'R' || e.kind === 'G') && e.value <= 0)
      out.push(mk('valor', 'error', `${e.label} = ${fmtEng(e.value, KIND_INFO[e.kind].unit)}: ${e.kind === 'R' ? 'una resistencia' : 'una conductancia'} debe ser mayor que cero.`, e.value === 0 ? 'R = 0 es un cable (cortocircuito), y G = 0 un circuito abierto; no son resistencias.' : 'Una resistencia negativa entregaría energía (P = R·I² < 0): un elemento pasivo no puede hacerlo.', 'No existe tal componente pasivo.', e.value === 0 ? 'Reemplácela por un cable o dele un valor positivo.' : 'Escriba un valor positivo.', [e.id]));
    if ((e.kind === 'L' || e.kind === 'C') && e.value <= 0)
      out.push(mk('valor', 'error', `${e.label}: ${e.kind === 'L' ? 'la inductancia' : 'la capacitancia'} debe ser mayor que cero.`, 'L y C de un elemento pasivo son positivas; con valor 0 o negativo la energía ½Li² o ½Cv² no tendría sentido.', 'No existe tal componente.', 'Escriba un valor positivo (ej. 10m, 220µ).', [e.id]));
    if (e.kind === 'SW' && (e.t0 ?? 0) < 0 && mode === 'transient')
      out.push(mk('valor', 'warning', `${e.label} conmuta en un instante negativo.`, 'El análisis toma como referencia t = 0.', 'Se acepta, pero las gráficas comienzan antes de 0.', 'Use t₀ ≥ 0 si quiere seguir la convención usual.', [e.id]));
  }
  // fuentes dependientes
  for (const e of els.filter((x) => isDependent(x.kind))) {
    const c = byId.get(e.ctrlRef ?? '');
    if (!e.ctrlRef || !c) {
      out.push(mk('control', 'error', `La fuente dependiente ${e.label} no tiene una variable de control válida.`, 'Una fuente dependiente vale k·(variable de control); sin esa variable su valor no está definido.', 'No se puede saber cuánto voltaje o corriente entrega.', 'Seleccione la fuente y elija en «Controlada por» el elemento cuyo voltaje o corriente la controla.', [e.id]));
    } else if (c.id === e.id) {
      out.push(mk('control', 'error', `${e.label} está controlada por sí misma.`, 'La variable de control debe estar en otra parte del circuito (definición de fuente dependiente, U2 punto 2.4).', 'La ecuación quedaría indeterminada.', 'Elija otro elemento como control.', [e.id]));
    } else if ((e.kind === 'CCVS' || e.kind === 'CCCS') && c.kind === 'VM') {
      out.push(mk('control', 'warning', `${e.label} está controlada por la corriente de un voltímetro (siempre 0).`, 'Un voltímetro ideal no deja pasar corriente.', 'La fuente siempre valdrá 0.', 'Use un amperímetro en serie o el elemento por donde pasa la corriente de control.', [e.id, c.id]));
    } else if ((e.kind === 'VCVS' || e.kind === 'VCCS') && c.kind === 'AM') {
      out.push(mk('control', 'warning', `${e.label} está controlada por el voltaje de un amperímetro (siempre 0).`, 'Un amperímetro ideal tiene voltaje cero.', 'La fuente siempre valdrá 0.', 'Use un voltímetro en paralelo o el elemento cuyo voltaje controla.', [e.id, c.id]));
    }
  }
  if (net.autoGround)
    out.push(mk('tierra', 'info', 'No colocó tierra: se asignó automáticamente al nodo con más conexiones.', 'Los voltajes de nodo se miden respecto a una referencia (0 V); sin ella solo existen diferencias de voltaje.', 'Ninguna: el circuito funciona igual; solo cambian los valores de V de nodo.', 'Coloque el símbolo de tierra en el nodo que quiera usar como referencia.', [], [0]));
  // terminales sueltos
  for (const d of net.danglingPins)
    out.push(mk('suelto', 'warning', `El terminal ${d.pin === 'a' ? '(+/a)' : '(−/b)'} de ${d.label} está suelto (no se conecta con ningún otro elemento).`, 'Por un terminal suelto no puede circular corriente: no se forma una trayectoria cerrada (LCK: la corriente que entra a un nodo debe salir).', `${d.label} no conduce corriente (no forma parte de ningún lazo); si es una fuente queda en vacío. El resto del circuito se resuelve igual.`, 'Una ese terminal con un cable al resto del circuito, o borre el elemento.', [d.id]));
  // conectividad: componentes y nodos flotantes
  const N = net.nodeCount;
  const parent = Array.from({ length: N }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (const e of els) parent[find(e.n1)] = find(e.n2);
  const compNodes = new Map<number, number[]>();
  for (let n = 0; n < N; n++) {
    const r = find(n);
    if (!compNodes.has(r)) compNodes.set(r, []);
    compNodes.get(r)!.push(n);
  }
  if (compNodes.size > 1) {
    for (const [r, nodes] of compNodes) {
      if (r === find(0)) continue;
      const ids = els.filter((e) => nodes.includes(e.n1)).map((e) => e.id);
      if (!ids.length) continue;
      out.push(mk('aislado', 'error', `Hay ${ids.length === 1 ? 'un componente aislado' : 'una parte del circuito aislada'} (${ids.map((i) => byId.get(i)!.label).join(', ')}) sin conexión con la referencia: nodo flotante.`, 'Un nodo flotante no tiene camino a tierra; su voltaje no está definido respecto a la referencia.', 'Esa parte no forma parte del circuito; su voltaje real dependería de cargas estáticas.', 'Conéctela con un cable al resto del circuito o coloque una tierra en ella.', ids, nodes));
    }
  }
  // camino cerrado: debe existir al menos un lazo con elementos que conducen
  // el concepto de circuito cerrado es geométrico: un lazo que pasa por un capacitor existe (su problema en DC lo informan otros errores)
  const conducts = (e: NetElement) => e.kind !== 'VM' && !(e.kind === 'SW' && !switchStateAfter(e) && mode === 'dc');
  {
    const p2 = Array.from({ length: N }, (_, i) => i);
    const f2 = (x: number): number => (p2[x] === x ? x : (p2[x] = f2(p2[x])));
    let loop = false;
    for (const e of els.filter(conducts)) {
      const a = f2(e.n1);
      const b = f2(e.n2);
      if (a === b) loop = true;
      else p2[a] = b;
    }
    if (!loop && els.some((e) => e.kind !== 'VM'))
      out.push(mk('abierto', 'error', 'Circuito abierto: no existe ningún camino cerrado por donde circule corriente.', 'Un circuito es toda trayectoria cerrada (U2, 2.1). Sin lazo cerrado la LCK obliga a que todas las corrientes sean cero.', 'No circula corriente; las fuentes quedan en vacío.', 'Cierre el circuito con un cable o elemento entre los extremos libres.', []));
  }
  // ---- fuentes de voltaje en cortocircuito / lazos de fuentes de voltaje ----
  const storage: 'dc' | 'ic' = 'dc';
  const vlike = (e: NetElement, closed: (e: NetElement) => boolean) => isVoltageSourceLike(e.kind) || e.kind === 'AM' || (e.kind === 'L' && storage === 'dc') || (e.kind === 'SW' && closed(e));
  const states: { name: string; closed: (e: NetElement) => boolean }[] = mode === 'transient' ? [{ name: 'para t < t₀', closed: switchStateBefore }, { name: 'para t > t₀', closed: switchStateAfter }] : [{ name: '', closed: switchStateAfter }];
  const reported = new Set<string>();
  for (const st of states) {
    const p3 = Array.from({ length: N }, (_, i) => i);
    const f3 = (x: number): number => (p3[x] === x ? x : (p3[x] = f3(p3[x])));
    const vl = els.filter((e) => vlike(e, st.closed) && !bad.has(e.id));
    for (const e of vl) {
      if (e.n1 === e.n2) {
        if (e.kind === 'V' && e.value !== 0 && !reported.has('corto' + e.id)) {
          reported.add('corto' + e.id);
          out.push(mk('vcorto', 'error', `La fuente de voltaje ${e.label} está en cortocircuito (sus dos terminales en el mismo nodo).`, `Viola la LVK: el lazo fuente + cable exige ${fmtEng(e.value, 'V')} = 0.`, 'Una fuente real entregaría una corriente enorme, se calentaría y podría explotar o quemar los cables.', 'Retire el cable que une sus terminales o coloque una carga (resistencia) en serie.', [e.id]));
        }
        continue;
      }
      const a = f3(e.n1);
      const b = f3(e.n2);
      if (a !== b) {
        p3[a] = b;
        continue;
      }
      // lazo formado solo por elementos tipo fuente de voltaje: verificar consistencia con KVL
      const loopIds = findPath(vl.filter((x) => x !== e && x.n1 !== x.n2), e.n1, e.n2);
      const loopEls = [e, ...loopIds.map((id) => byId.get(id)!)];
      const key = loopEls.map((x) => x.id).sort().join(',');
      if (reported.has(key)) continue;
      reported.add(key);
      const hasL = loopEls.some((x) => x.kind === 'L');
      const hasDep = loopEls.some((x) => isDependent(x.kind));
      const hasAM = loopEls.find((x) => x.kind === 'AM');
      const hasSW = loopEls.find((x) => x.kind === 'SW');
      // suma de voltajes alrededor del lazo (solo independientes)
      const sum = loopSum(loopEls, e);
      if (hasL && mode === 'dc') {
        out.push(mk('lparalelo', 'error', `En DC el inductor ${loopEls.find((x) => x.kind === 'L')!.label} (cortocircuito) queda en paralelo con una fuente de voltaje.`, 'En régimen permanente v = L·di/dt = 0: el inductor es un corto y la fuente quedaría cortocircuitada (viola la LVK).', 'La corriente crecería sin límite (i = (V/L)·t) hasta destruir la fuente o el inductor.', 'Agregue una resistencia en serie con el inductor.', loopEls.map((x) => x.id)));
      } else if (hasAM && loopEls.filter((x) => x.kind === 'V').length && !hasDep) {
        out.push(mk('instrumento', 'error', `El amperímetro ${hasAM.label} está conectado en paralelo con una fuente de voltaje (la cortocircuita).`, 'Un amperímetro ideal tiene resistencia cero: puesto en paralelo es un cortocircuito y viola la LVK.', 'En la práctica se funde el fusible del amperímetro o se daña la fuente.', 'El amperímetro va EN SERIE con el elemento cuya corriente quiere medir.', loopEls.map((x) => x.id)));
      } else if (hasSW && Math.abs(sum) > 1e-12) {
        out.push(mk('vcorto', 'error', `${st.name ? 'Con el interruptor ' + hasSW.label + ' ' + (st.closed(hasSW) ? 'cerrado' : 'abierto') + ' (' + st.name + '), ' : ''}la fuente de voltaje queda en cortocircuito.`, 'Viola la LVK: la suma de voltajes del lazo no es cero.', 'Corriente de cortocircuito destructiva.', 'Agregue una resistencia en serie o cambie la posición del interruptor.', loopEls.map((x) => x.id)));
      } else if (hasDep) {
        out.push(mk('vlazo', 'error', `Lazo formado solo por fuentes de voltaje (incluye la dependiente ${loopEls.find((x) => isDependent(x.kind))!.label}).`, 'La LVK de ese lazo fija una relación entre fuentes y la corriente del lazo queda indeterminada (sistema singular).', 'Corrientes de circulación imprevisibles entre las fuentes.', 'Agregue una resistencia en el lazo.', loopEls.map((x) => x.id)));
      } else if (Math.abs(sum) > 1e-9 * Math.max(1, ...loopEls.map((x) => Math.abs(x.value)))) {
        out.push(mk('vparalelo', 'error', `Fuentes de voltaje en paralelo (o en lazo) con valores distintos: ${loopEls.map((x) => `${x.label} = ${fmtEng(x.value, 'V')}`).join(', ')}.`, 'Viola la LVK: alrededor del lazo la suma de voltajes no es cero. Las fuentes de voltaje SOLO se pueden conectar en paralelo si son de igual valor (U2, 2.5 b).', 'Circularía una corriente enorme de una fuente a la otra; se dañan las fuentes.', 'Use fuentes de igual valor, o ponga una resistencia entre ellas.', loopEls.map((x) => x.id)));
      } else {
        out.push(mk('vparaleloigual', 'warning', `Fuentes de voltaje iguales en paralelo: ${loopEls.map((x) => x.label).join(', ')}.`, 'Está permitido (U2, 2.5 b), pero con fuentes ideales el reparto de corriente entre ellas es indeterminado.', 'En la práctica la fuente un poco mayor entrega casi toda la corriente.', 'Puede dejar una sola fuente; el simulador reparte la corriente en partes iguales.', loopEls.map((x) => x.id)));
      }
    }
  }
  // ---- cortes formados solo por fuentes de corriente (o elementos abiertos) ----
  for (const st of states) {
    const isOpenEl = (e: NetElement) => e.kind === 'VM' || (e.kind === 'C' && mode === 'dc') || (e.kind === 'SW' && !st.closed(e));
    const p4 = Array.from({ length: N }, (_, i) => i);
    const f4 = (x: number): number => (p4[x] === x ? x : (p4[x] = f4(p4[x])));
    for (const e of els) if (!isCurrentSourceLike(e.kind) && !isOpenEl(e)) p4[f4(e.n1)] = f4(e.n2);
    const groups = new Map<number, number[]>();
    for (let n = 0; n < N; n++) {
      const r = f4(n);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r)!.push(n);
    }
    if (groups.size <= 1) continue;
    for (const [r, nodes] of groups) {
      if (nodes.includes(0) && groups.size === 2) continue; // el complemento se revisa con el otro grupo
      const srcs = els.filter((e) => isCurrentSourceLike(e.kind) && (f4(e.n1) === r) !== (f4(e.n2) === r));
      const opens = els.filter((e) => isOpenEl(e) && (f4(e.n1) === r) !== (f4(e.n2) === r));
      if (!srcs.length) continue; // grupo aislado (ya reportado) o solo abiertos
      const key = 'cut' + srcs.map((s) => s.id).sort().join(',');
      if (reported.has(key)) continue;
      reported.add(key);
      const sum = srcs.reduce((s, e) => s + (e.kind === 'I' ? (f4(e.n1) === r ? e.value : -e.value) : NaN), 0);
      const caps = opens.filter((x) => x.kind === 'C');
      if (caps.length && mode === 'dc') {
        out.push(mk('cserie', 'error', `El capacitor ${caps[0].label} queda en serie con la fuente de corriente ${srcs[0].label}: en DC no hay camino para esa corriente.`, 'En régimen permanente el capacitor es un circuito abierto (i = C·dv/dt = 0), pero la fuente obliga a que pase corriente: viola la LCK.', 'El voltaje del capacitor crecería sin límite (v = I·t/C) hasta perforar el dieléctrico.', 'Agregue una resistencia en paralelo con el capacitor o con la fuente.', [...srcs, ...caps].map((x) => x.id), nodes));
      } else if (srcs.length === 1) {
        out.push(mk('iabierto', 'error', `La fuente de corriente ${srcs[0].label} está en circuito abierto${st.name ? ' ' + st.name : ''}: su corriente no tiene por dónde circular.`, 'Viola la LCK: la fuente obliga a que salga corriente de un nodo al que no llega ningún otro camino.', 'Una fuente real elevaría su voltaje sin límite (arco eléctrico, daño).', 'Cierre el camino con una resistencia o un cable en paralelo con la fuente.', srcs.map((x) => x.id), nodes));
      } else if (srcs.some((s) => isDependent(s.kind)) || Math.abs(sum) > 1e-12 * Math.max(1, ...srcs.map((s) => Math.abs(s.value)))) {
        out.push(mk('iserie', 'error', `Fuentes de corriente en serie con valores distintos (o un corte formado solo por fuentes de corriente): ${srcs.map((x) => `${x.label} = ${fmtEng(x.value, isDependent(x.kind) ? '' : 'A')}`).join(', ')}.`, 'Viola la LCK: en el nodo entre ellas la corriente que entra no puede ser igual a la que sale. Las fuentes de corriente SOLO se pueden conectar en serie si son de igual valor (U2, 2.5 c).', 'Los voltajes de las fuentes reales subirían hasta dañarlas.', 'Use fuentes de igual valor o agregue una resistencia en paralelo con una de ellas.', srcs.map((x) => x.id), nodes));
      } else {
        out.push(mk('iserieigual', 'warning', `Fuentes de corriente iguales en serie: ${srcs.map((x) => x.label).join(', ')}.`, 'Está permitido (U2, 2.5 c), pero el voltaje de cada fuente ideal queda indeterminado.', 'En la práctica cada fuente toma un voltaje según sus imperfecciones.', 'Puede dejar una sola fuente.', srcs.map((x) => x.id), nodes));
      }
    }
  }
  // ---- instrumentos mal conectados ----
  for (const e of els) {
    if (e.kind === 'AM') {
      const par = els.find((x) => x !== e && x.kind !== 'VM' && ((x.n1 === e.n1 && x.n2 === e.n2) || (x.n1 === e.n2 && x.n2 === e.n1)));
      if (par && !reported.has('am' + e.id) && !isVoltageSourceLike(par.kind))
        out.push(mk('instrumento', 'error', `El amperímetro ${e.label} está conectado en paralelo con ${par.label}.`, 'Un amperímetro ideal tiene resistencia cero: en paralelo cortocircuita al elemento y no mide su corriente.', `${par.label} queda sin corriente; en un circuito real el amperímetro podría quemarse.`, `Conéctelo EN SERIE: abra la rama de ${par.label} e intercale el amperímetro.`, [e.id, par.id]));
    }
    if (e.kind === 'VM') {
      const deg = (n: number) => els.filter((x) => x.n1 === n || x.n2 === n).length;
      const serial = [e.n1, e.n2].some((n) => n !== 0 && deg(n) === 2 && els.some((x) => x !== e && x.kind !== 'VM' && (x.n1 === n || x.n2 === n)));
      if (serial)
        out.push(mk('instrumento', 'error', `El voltímetro ${e.label} está conectado en serie.`, 'Un voltímetro ideal tiene resistencia infinita: en serie abre el circuito y la corriente se anula.', 'El circuito deja de funcionar y el voltímetro marca casi el voltaje de la fuente.', 'Conéctelo EN PARALELO con el elemento cuyo voltaje quiere medir (entre sus dos terminales).', [e.id]));
    }
  }
  // ---- elementos en paralelo con un corto ----
  for (const e of els) {
    if ((e.kind === 'R' || e.kind === 'G' || e.kind === 'L' || e.kind === 'C') && e.n1 === e.n2)
      out.push(mk('enCorto', 'warning', `${e.label} tiene sus dos terminales en el mismo nodo (está en paralelo con un cortocircuito).`, 'Su voltaje es 0, así que su corriente también: no aporta nada al circuito.', 'Ese componente no trabaja.', 'Retire el cable que lo cortocircuita si quería que funcione.', [e.id]));
  }
  // ---- malla en circuito no planar ----
  if (opt.wantsMesh && opt.nonPlanar)
    out.push(mk('noplanar', 'error', 'Se pidió el método de mallas en un circuito no planar (o dibujado con cruces).', 'Las mallas son las «ventanas» de un circuito dibujado sin cruces; si hay cruces no están definidas.', 'El planteo de mallas sería incorrecto.', 'Redibuje el circuito sin cruces o use el método de nodos.', []));
  // ---- sistema singular / mal condicionado y advertencias numéricas ----
  if (!out.some((i) => i.severity === 'error')) {
    const r = solveMNA(prepareForSolve(net, out).net, { storage: 'dc', switchClosed: mode === 'transient' ? switchStateAfter : undefined });
    if (!r.ok && r.error?.kind === 'control') out.push(mk('control', 'error', r.error.message, 'La variable de control no puede depender de sí misma a través de otras fuentes dependientes.', 'El sistema no tiene solución única.', 'Revise las variables de control.', []));
    else if (!r.ok)
      out.push(mk('singular', 'error', `El sistema de ecuaciones es singular (falla al despejar ${r.error?.column ? r.error.column.replace(/[{}_]/g, '') : 'una incógnita'}).`, 'Hay más incógnitas que ecuaciones independientes. Suele deberse a una fuente dependiente cuya ganancia hace que dos ecuaciones sean iguales (por ejemplo, una VCVS con ganancia 1 conectada sobre su propio control), o a una parte del circuito sin camino a la referencia.', 'El circuito real no tendría un punto de operación estable (corrientes indeterminadas o infinitas).', 'Cambie la ganancia de la fuente dependiente o agregue una resistencia que dé camino a tierra.', []));
    else {
      if (r.cond > 1e12) out.push(mk('malcond', 'warning', 'El sistema está mal condicionado (valores muy dispares).', 'Mezclar resistencias de pΩ con GΩ hace que los errores de redondeo crezcan.', 'Los resultados pueden tener pocas cifras exactas.', 'Use valores de un orden de magnitud razonable.', []));
      for (const e of els) {
        const x = r.el.get(e.id)!;
        if ((e.kind === 'R' || e.kind === 'G') && Math.abs(x.p) > 1e4)
          out.push(mk('exagerado', 'warning', `${e.label} disiparía ${fmtEng(x.p, 'W')} (corriente ${fmtEng(Math.abs(x.i), 'A')}).`, 'Es mucha potencia para una resistencia de circuito; las comunes son de ¼ a 5 W.', 'Una resistencia real se quemaría salvo que sea de potencia (calefactor, freno).', 'Si es un ejercicio de papel, ignore el aviso; si es un circuito real, aumente R o baje la fuente.', [e.id]));
        if (mode === 'dc' && (e.kind === 'R' || e.kind === 'G') && Math.abs(x.i) < 1e-15 && e.n1 !== e.n2 && Math.abs(r.V[e.n1]) + Math.abs(r.V[e.n2]) > 0)
          out.push(mk('sincorriente', 'warning', `Por ${e.label} no circula corriente.`, 'Sus dos terminales están al mismo voltaje (puente balanceado o rama abierta).', 'Ese elemento no cumple ninguna función en este circuito.', 'Puede retirarlo sin cambiar el resto del circuito.', [e.id]));
      }
    }
  }
  return out;
}

function findPath(edges: NetElement[], from: number, to: number): string[] {
  const adj = new Map<number, { n: number; id: string }[]>();
  for (const e of edges) {
    if (!adj.has(e.n1)) adj.set(e.n1, []);
    if (!adj.has(e.n2)) adj.set(e.n2, []);
    adj.get(e.n1)!.push({ n: e.n2, id: e.id });
    adj.get(e.n2)!.push({ n: e.n1, id: e.id });
  }
  const prev = new Map<number, { n: number; id: string }>();
  const q = [from];
  const seen = new Set([from]);
  while (q.length) {
    const x = q.shift()!;
    if (x === to) break;
    for (const y of adj.get(x) ?? []) if (!seen.has(y.n)) {
      seen.add(y.n);
      prev.set(y.n, { n: x, id: y.id });
      q.push(y.n);
    }
  }
  const path: string[] = [];
  let c = to;
  while (c !== from && prev.has(c)) {
    path.push(prev.get(c)!.id);
    c = prev.get(c)!.n;
  }
  return path;
}

/** Suma de voltajes (solo fuentes independientes) recorriendo el lazo que cierra `closing` */
function loopSum(loop: NetElement[], closing: NetElement): number {
  // recorrer desde closing.n2 hasta closing.n1 por el resto y volver por closing
  let node = closing.n1;
  let sum = closing.kind === 'V' ? closing.value : 0; // atravesar closing de b→a... se define abajo
  // recorrido: n2 --(resto)--> n1 --closing--> n2 ; sumamos caídas a→b
  sum = 0;
  node = closing.n2;
  const rest = loop.filter((x) => x !== closing);
  const used = new Set<string>();
  let guard = 0;
  while (node !== closing.n1 && guard++ < 100) {
    const e = rest.find((x) => !used.has(x.id) && (x.n1 === node || x.n2 === node));
    if (!e) break;
    used.add(e.id);
    const val = e.kind === 'V' ? e.value : 0;
    if (e.n1 === node) {
      sum += val;
      node = e.n2;
    } else {
      sum -= val;
      node = e.n1;
    }
  }
  sum += closing.kind === 'V' ? closing.value : 0;
  return sum;
}

export const hasErrors = (iss: Issue[]) => iss.some((i) => i.severity === 'error');

/**
 * Prepara la netlist para resolver: si hay fuentes de voltaje iguales en paralelo (o de corriente iguales en serie),
 * deja una sola activa para que el sistema no sea singular. Devuelve cómo repartir los resultados.
 */
export function prepareForSolve(net: Netlist, issues: Issue[]): { net: Netlist; shared: Map<string, string[]> } {
  const shared = new Map<string, string[]>();
  const drop = new Set<string>();
  const toShort = new Set<string>();
  for (const is of issues) {
    if (is.code === 'vparaleloigual') {
      const [keep, ...rest] = is.elements;
      rest.forEach((r) => drop.add(r));
      shared.set(keep, is.elements);
    }
    if (is.code === 'iserieigual') {
      const [, ...rest] = is.elements;
      rest.forEach((r) => toShort.add(r));
    }
  }
  if (!drop.size && !toShort.size) return { net, shared };
  return {
    net: {
      ...net,
      elements: net.elements
        .filter((e) => !drop.has(e.id))
        .map((e) => (toShort.has(e.id) ? { ...e, kind: 'AM' as const } : e)),
    },
    shared,
  };
}
