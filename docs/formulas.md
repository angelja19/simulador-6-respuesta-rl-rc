# Fórmulas del curso — Circuitos I (UMSS)

Fuente: carpeta `avance/` (material del docente Ing. Abg. Juan Antonio Rodríguez Sejas y apuntes de clase).
Cada fórmula indica su notación, unidades y archivo de origen. El motor y las ventanillas 2 y 3 usan
exactamente esta notación.

---

## Unidad 1 — Unidades y Variables

| Concepto | Fórmula (notación del curso) | Unidades | Archivo |
|---|---|---|---|
| Carga elemental | e = 1,6022 × 10⁻¹⁹ C | [C] | `CIRCUITOS I UNIDAD 1_jarslobo 2 2020.ppt.pdf` (diap. 1.2), `U1 NBKLM NOCIONES BASICAS (1).pdf`, `Arcade_El-ctrico.pdf` |
| Corriente | I = dq/dt | q [C], t [s], I [A] | `CIRCUITOS I UNIDAD 1…pdf` (1.4) |
| Voltaje (tensión) | v = dw/dq | w [J], q [C], v [V] | `CIRCUITOS I UNIDAD 1…pdf` (1.5) |
| Potencia | p = dw/dt = (dw/dq)(dq/dt) | p [W], 1 W = 1 J/s | `CIRCUITOS I UNIDAD 1…pdf` (1.6) |
| Potencia en DC | P = V × I | [W] = [V]·[A] | ídem |
| Potencia AC monofásica | P = V × I × fp = V × I × cos φ | [W] | ídem (solo como referencia; el curso trabaja en DC) |
| Potencia AC trifásica | P = √3 × V × I × fp | [W] | ídem (en el material aparece «3 × V × I × fp»; el texto extraído no muestra el símbolo de raíz — ver nota 1) |
| DC vs AC | f = 0 Hz (DC); f = 50 Hz o 60 Hz (AC) | [Hz] | ídem (1.7) |
| Elemento básico ideal | 2 terminales; descrito por v e i; no se subdivide | — | ídem (1.9) |
| Carga por corriente constante | Q = I · t (t en segundos); Nₑ = Q / e | [C], adimensional | derivada de I = dq/dt (prompt, casos del cuaderno) |
| Energía y costo | w = ∫ p dt; costo = kWh × tarifa (la tarifa la ingresa el usuario) | [J], [kWh] | derivada de p = dw/dt |

Niveles de tensión (diapositivas U1): generación 3–36 kV, transporte 110–380 kV, media tensión 3–30 kV
(transformación 25–132 kV en otra diapositiva), baja tensión 125–220 V. Campo eléctrico [N/C] o [V/m];
campo magnético [T].

## Unidad 2 — Elementos y Leyes Principales sobre Circuitos

| Concepto | Fórmula | Unidades | Archivo |
|---|---|---|---|
| Circuito | trayectoria cerrada: partiendo de un punto se llega al mismo punto | — | `CIR 1 U2 TEORIA jarslobito 2026.pdf` (2.1) |
| Serie | I = I₁ = I₂ = …; E = V₁ + V₂ + …; P = P₁ + P₂ + … | [A], [V], [W] | ídem (2.2), `CAP 2_jarslobo CIRCUITOS I.ppt.pdf` |
| Paralelo | I = I₁ + I₂ + …; E = V₁ = V₂ = …; P = P₁ + P₂ + … | | ídem |
| Nodo / Malla / Rama | nodo: unión de 2 o más elementos; nodo «especial» o con «pedigree» (principal); malla: trayectoria donde se verifica el concepto de circuito; rama: une dos nodos especiales | — | ídem (2.3) |
| Fuentes de voltaje en serie | se pueden conectar siempre; se reducen sumando o restando | [V] | ídem (2.5, 2.6) |
| Fuentes de voltaje en paralelo | SOLO si son de igual valor | | ídem |
| Fuentes de corriente en serie | SOLO si son de igual valor | [A] | ídem |
| Fuentes de corriente en paralelo | siempre; se reducen sumando o restando | | ídem |
| Resistencia | R = ρ × l / S | R [Ω], l [m], S [mm²], ρ [Ω·mm²/m] | ídem (2.7), `Circuit_Foundations.pptx.pdf` |
| Conductancia | G = 1/R | [S] | Boylestad (bibliografía base) |
| Ley de Ohm | V = R × I (en clase también E = R·I) | [V], [Ω], [A] | ídem (2.8) |
| LVK | Σ Vᵢ = 0 en toda malla o circuito cerrado | [V] | ídem (2.9) |
| LCK | Σ Iᵢ = 0 en un nodo («agüita que entra, agüita que sale»); también Σ I entran = Σ I salen | [A] | ídem (2.9) |
| Polaridades (2.10) | Resistencias: + por donde entra la corriente. Fuente de voltaje: la corriente sale por el polo +. Fuente de corriente: criterio del agua, de mayor (+) a menor (−) altura | — | ídem (2.10) |
| Elección de signos LVK | recorriendo en sentido horario: de − a + ⇒ (+); de + a − ⇒ (−) | — | ídem (2.10) |
| Método de corrientes de rama (2.11) | 1) ramas y corrientes I₁, I_A… 2) polaridades 3) LVK por malla + LCK por nodo con pedigree 4) resolver; n.º ecuaciones = n.º incógnitas | — | ídem (2.11), `EJ1 MET DE RAMA.pdf`, `Ej A Sol Met Ramas Cir I.pdf` |

## Unidad 3 — Circuitos Resistivos

| Concepto | Fórmula | Archivo |
|---|---|---|
| Serie | R_total equiv. = R₁ + R₂ + … + Rₙ | `CIR I U3 CTO RESISTIVOS 2026.pdf` (3.1), `U3 CTOS RESITIVOS.pdf` |
| Paralelo | 1/R_total = 1/R₁ + 1/R₂ + … + 1/Rₙ | ídem (3.2) |
| Dos en paralelo | R_equiv = R₁·R₂ / (R₁ + R₂) («producto sobre suma») | ídem |
| Tres en paralelo | R_equiv = R₁R₂R₃ / (R₁R₂ + R₁R₃ + R₂R₃) | ídem |
| Divisor de voltaje | V_R1 = R₁/(R₁ + R₂) · E_entrada; condiciones: dos resistencias en serie y un voltaje de entrada (varias en serie se reducen a dos) | ídem (3.3) |
| Divisor de corriente | I_R1 = R₂/(R₁ + R₂) · I_entrada (resistencia OPUESTA); condiciones: exactamente dos resistencias en paralelo y una corriente de entrada | ídem (3.4) |
| Δ (Π) → Y (T) | R_X = R₁R₂/(R₁+R₂+R₃); R_Y = R₁R₃/(R₁+R₂+R₃); R_Z = R₂R₃/(R₁+R₂+R₃) | ídem (3.5), `IMAGEN U3.jfif.png` |
| Y (T) → Δ (Π) | R₁ = (R_XR_Y + R_XR_Z + R_YR_Z)/R_Z; R₂ = (…)/R_Y; R₃ = (…)/R_X | ídem (3.6) |
| Ejemplos de control | 1 k + 250∥500 = 1166,67 Ω; 1 k + 250∥500∥1500 = 1150 Ω; V_ab = 2,14 V y V_R1 = 12,86 V con 15 V; I_R2 = 0,32 A, I_Req = 1,68 A, I_R3 = 0,105 A, I_Req = 1,89 A con 2 A | ídem |

Geometría Δ–Y del material: R₁ entre los vértices superior e izquierdo, R₂ entre superior y derecho, R₃ entre
izquierdo y derecho; R_X va al vértice superior (entre R₁ y R₂), R_Y al izquierdo (entre R₁ y R₃), R_Z al derecho
(entre R₂ y R₃).

## Unidad 4 — Métodos y Técnicas de Análisis

| Concepto | Procedimiento / fórmula | Archivo |
|---|---|---|
| Nodos | 1) contar nodos 2) referencia (Ref.) y V₁, V₂… 3) dibujar corrientes que SALEN de cada nodo 4) LCK en cada nodo excepto Ref. 5) corrientes en función de voltajes (Ohm: I = (V_i − V_j)/R) 6) resolver | `CIR1 TP4 N-SUPERNODOS jarslobo 2026.pdf` |
| Supernodo | fuente de voltaje entre dos nodos característicos: ecuación V(+) − V(−) = V_fuente (minuendo: nodo del +); se cortocircuita mentalmente la fuente y se aplica LCK al supernodo | ídem |
| Mallas | corrientes de malla en sentido horario I₁, I₂…; LVK por malla; caídas en resistencias positivas; en fuentes de voltaje, signo según el polo por donde entra la corriente de malla | `CIRCUITOS I TP4 MALLAS jarslobo 2022.pdf` |
| Supermalla | ecuación de la fuente de corriente (I_a − I_b = I_s), se «levanta» la fuente (circuito abierto) y se aplica LVK a la supermalla | ídem |
| Fuente en rama exterior | I_m = ± I_s | ídem (ejercicio C: I₁ = 15) |
| Fuentes dependientes | la variable de control se escribe en función de las incógnitas (p. ej. i = I_y − I_z; V_a = V₂) | ídem, `cuaderno.pdf` |
| Thévenin | 1) retirar la porción 2) marcar terminales 3) R_TH: solo independientes → apagar fuentes (V → corto, I → abierto); con dependientes → R_TH = E_TH (circuito abierto) / I_CC (cortocircuito); solo dependientes → fuente de prueba 1 V (R_TH = 1 V / I_fuente) o 1 A (R_TH = V_fuente / 1 A); en este último caso el equivalente es solo R_TH | `U4 TEO. DE THEVENIN 2026.pdf` |
| Norton | I_N = I_CC = E_TH / R_TH, R_N = R_TH | Boylestad/Nilsson (bibliografía) |
| Máxima transferencia | R_L = R_TH; P_max = E_TH² / (4 R_TH) | Nilsson (bibliografía) |
| Superposición | una fuente independiente a la vez; las dependientes quedan; la potencia no se superpone | Hayt/Nilsson (bibliografía) |

## Unidad 5 — Inductancia y Capacitancia

| Concepto | Fórmula | Archivo |
|---|---|---|
| Capacitancia | q = C·v; C = q/v | [F] | `TEORIA CAPACITORES.pdf` |
| Corriente en C | i = C · dv/dt | ídem (ec. 1) |
| Voltaje en C | v(t) = (1/C) ∫_{t₀}^{t} i dτ + v(t₀) | ídem (ec. 2) |
| C en serie | 1/C_T = 1/C₁ + 1/C₂ + …; dos: C_T = C₁C₂/(C₁ + C₂) | ídem |
| C en paralelo | C_T = C₁ + C₂ + … | ídem |
| Energía en C | W_C = ½ C V² = Q²/(2C) | [J] | ídem |
| C en DC | circuito abierto | ídem |
| Voltaje en L | v = L · di/dt | `TEORIA INDUCTORES.pdf` (ec. 1) |
| Corriente en L | i(t) = (1/L) ∫_{t₀}^{t} v dτ + i(t₀) | ídem (ec. 2) |
| L en serie | L_T = L₁ + L₂ + … | ídem |
| L en paralelo | 1/L_T = 1/L₁ + 1/L₂ + …; dos: L_T = L₁L₂/(L₁ + L₂) | ídem |
| Energía en L | W_L = ½ L I² | ídem |
| L en DC | cortocircuito; no admite cambio instantáneo de corriente | ídem |

## Unidad 6 — Respuesta natural y al escalón RL / RC

No hay archivo de la unidad 6 en `avance/`; se usan las fórmulas del prompt, coherentes con la U5 y la
bibliografía (Nilsson cap. 7):

- τ = L / R (RL), τ = R·C (RC) [s]
- Respuesta natural: i(t) = I₀ e^{−t/τ}, v(t) = V₀ e^{−t/τ}
- Escalón / general: x(t) = x(∞) + [x(t₀⁺) − x(∞)] e^{−(t−t₀)/τ}
- R_eq vista por L o C = R_TH del circuito para t > 0 (fuente de prueba si hay dependientes)
- Energía: W₀ = ½ L I₀² o ½ C V₀² = energía disipada en las resistencias (respuesta natural)

---

### Notas sobre diferencias material ↔ prompt

1. **Carga elemental.** El material usa 1,6022 × 10⁻¹⁹ C; el prompt pide el valor exacto SI
   1,602176634 × 10⁻¹⁹ C con opción de 1,6 × 10⁻¹⁹ C. No es un conflicto de fórmula sino de redondeo:
   el simulador usa el exacto por defecto y ofrece las opciones «1,6022 (material)» y «1,6 (docente)»,
   mostrando la diferencia.
2. **Potencia trifásica.** El texto extraído de la diapositiva dice «P = 3 × V × I × fp»; probablemente es
   √3 (el símbolo de raíz no se extrae en el PDF). Solo es referencia (la materia trabaja en DC) y no se usa
   en los cálculos.
3. **Resistividad.** El material usa ρ en Ω·mm²/m con S en mm² y l en m. El simulador trabaja en esa
   unidad y además convierte a Ω·m.
4. **Divisor de voltaje.** El material lo define para dos resistencias; para n resistencias se reduce a dos
   (como indica el material, punto c) y además se muestra la forma general V_k = R_k/ΣR · E.
