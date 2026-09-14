// Contraste medido en el peor caso real (DESIGN.md §8).
//
// La paleta NO vive aquí: se lee de `web/styles.css`, que es la única fuente.
// Lo que este archivo declara es su contrato —qué roles se miden, sobre qué
// fondos y con qué mínimo—, no una segunda configuración visual. Un rol que
// falte o un valor que no se sepa leer produce error explícito, nunca una
// medición con un hueco.
//
// Antes guardaba 54 valores copiados a mano y ya se había desincronizado dos
// veces: `--border-2` nunca llegó a copiarse, y el peso del vidrio era `.144`
// frente al 14 % del CSS.
//
// Ejecutar: node scripts/contrast.mjs → imprime las razones y falla bajo el mínimo.
// Vive en `scripts/` y no en `web/`: `web/` es exactamente lo que se publica.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { color, declaracion, numero, pesosDeMezcla, tokensPorTema } from './css-tokens.mjs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HOJA = path.join(raiz, 'web', 'styles.css');

const lum = (c) => c.map((v) => { const canal = v / 255; return canal <= 0.03928 ? canal / 12.92 : ((canal + 0.055) / 1.055) ** 2.4; })
  .reduce((total, v, i) => total + v * [0.2126, 0.7152, 0.0722][i], 0);
const over = (frente, alpha, fondo) => frente.map((v, i) => alpha * v + (1 - alpha) * fondo[i]);
export const contrastRatio = (izquierda, derecha) => (Math.max(lum(izquierda), lum(derecha)) + 0.05) / (Math.min(lum(izquierda), lum(derecha)) + 0.05);

/** Los roles de color que se miden, con el nombre que usan en el CSS. */
const ROLES = Object.freeze({
  background: '--background',
  foreground: '--foreground',
  muted: '--muted-foreground',
  card: '--card',
  card2: '--card-2',
  border: '--border',
  border2: '--border-2',
  primary: '--primary',
  primaryForeground: '--primary-foreground',
  accent: '--accent',
  ring: '--ring',
  regular: '--product-regular',
  regularStrong: '--product-regular-strong',
  premium: '--product-premium',
  premiumStrong: '--product-premium-strong',
});
const GLOWS = Object.freeze(['--glow-1', '--glow-2', '--glow-3']);
const HALOS = Object.freeze(['--halo-primax', '--halo-repsol', '--halo-ava', '--halo-petroperu']);

/**
 * Todo lo que la medición necesita, leído del CSS.
 *
 * Los pesos de las mezclas se sacan de la receta que de verdad las pinta: el
 * vidrio de `--surface`, el card fijo de su regla y el chip de la suya.
 */
export function leerPaleta(css) {
  const temas = tokensPorTema(css);
  const vidrio = pesosDeMezcla(temas.light.get('--surface'), '--surface');
  if (vidrio.length !== 3) throw new Error(`contrast: --surface debía mezclar tres superficies y mezcla ${vidrio.length}`);
  const fijo = pesosDeMezcla(declaracion(css, '.controls[data-state="compact"]', 'background'), 'el card de controles fijo');
  const chip = pesosDeMezcla(declaracion(css, '.chip{', 'background'), 'el relleno del chip');
  const glow3 = numero(declaracion(css, '.glow i:nth-child(3)', 'opacity'), 'la tercera mancha del glow');
  const referencia = pesosDeMezcla(declaracion(css, '.history__promedio{', '--serie-ref'), 'la recta del promedio');

  const porTema = {};
  for (const [tema, tokens] of Object.entries(temas)) {
    const leer = (nombre) => {
      const valor = tokens.get(nombre);
      if (valor === undefined) throw new Error(`contrast: ${nombre} no está declarada para el tema ${tema}`);
      return valor;
    };
    porTema[tema] = {
      ...Object.fromEntries(Object.entries(ROLES).map(([rol, nombre]) => [rol, color(leer(nombre), `${nombre} (${tema})`)])),
      glow: GLOWS.map((nombre) => color(leer(nombre), `${nombre} (${tema})`)),
      glowAlpha: numero(leer('--glow-alpha'), `--glow-alpha (${tema})`),
      halos: HALOS.map((nombre) => color(leer(nombre), `${nombre} (${tema})`)),
      haloAlpha: numero(leer('--brand-halo-alpha'), `--brand-halo-alpha (${tema})`),
      fillAlpha: numero(leer('--chart-fill-alpha'), `--chart-fill-alpha (${tema})`),
    };
  }
  return { temas: porTema, vidrio, fijo: fijo[0], chip: chip[0], glow3, referencia: referencia[0] };
}

/**
 * Dos juegos de fondos, porque el texto y el gráfico no viven en el mismo sitio.
 *
 * TARJETA: el vidrio (sus tres mezclas) y el card de controles fijo sobre el
 * papel liso y sobre cada mancha del glow; y sobre cualquiera de esos, el halo
 * de cualquiera de las marcas registradas. El halo sí queda detrás de texto —la
 * dirección y el distrito viven en la esquina donde sangra la marca—, así que
 * entra en el peor caso. El isotipo no: es una imagen recortada y desvanecida,
 * no un color plano.
 *
 * TRAZADO: el histórico vive en un `.plate`, donde no hay halo de marca, pero sí
 * el relleno de su propia serie. La recta del promedio puede cruzar esa zona.
 */
export function verifyContrast(tema, paleta) {
  const t = paleta.temas[tema];
  if (!t) throw new Error(`Tema desconocido: ${tema}`);
  const fondo = t.background;
  const traseras = [fondo, ...t.glow.map((mancha, i) => over(mancha, i === 2 ? paleta.glow3 : t.glowAlpha, fondo))];
  const vidrio = traseras.flatMap((trasera) => [
    over(t.card, paleta.vidrio[0], trasera),
    over(t.card2, paleta.vidrio[1], trasera),
    over(t.card, paleta.vidrio[2], trasera),
    over(t.card, paleta.fijo, trasera),
  ]);
  const surfaces = vidrio.flatMap((s) => [s, ...t.halos.map((halo) => over(halo, t.haloAlpha, s))]);
  const trazado = vidrio.flatMap((s) => [s, ...[t.regularStrong, t.premiumStrong].map((serie) => over(serie, t.fillAlpha, s))]);

  const minimo = (c) => Math.min(...surfaces.map((s) => contrastRatio(c, s)));
  const enTrazado = (c) => Math.min(...trazado.map((s) => contrastRatio(c, s)));
  // El chip se mezcla con `--card`, que es OPACO: su relleno no deja pasar el
  // vidrio ni el halo, así que la pareja es directa y no depende del fondo.
  const relleno = (producto) => over(producto, paleta.chip, t.card);
  const referencia = (serie) => over(serie, paleta.referencia, t.foreground);
  const enChip = (tinta, producto) => contrastRatio(tinta, relleno(producto));

  return {
    foreground: minimo(t.foreground),
    muted: minimo(t.muted),
    accent: minimo(t.accent),
    button: contrastRatio(t.primaryForeground, t.primary),
    primary: minimo(t.primary),
    ring: minimo(t.ring),
    border: minimo(t.border),
    border2: minimo(t.border2),
    chipRegular: enChip(t.regularStrong, t.regular),
    chipPremium: enChip(t.premiumStrong, t.premium),
    chipMutedRegular: enChip(t.muted, t.regular),
    chipMutedPremium: enChip(t.muted, t.premium),
    // La cifra grande de la tarjeta y la curva de su serie llevan el mismo color
    // «strong». El relleno no entra aquí: queda DEBAJO del trazo, que siempre
    // linda por arriba con el vidrio limpio.
    regularStrong: minimo(t.regularStrong),
    premiumStrong: minimo(t.premiumStrong),
    // La referencia del promedio sí cruza el relleno, y es gráfico necesario
    // para entender el dato: se miden su línea y su etiqueta, que llevan el
    // color de su serie tirado hacia la tinta.
    promedioRegular: enTrazado(referencia(t.regularStrong)),
    promedioPremium: enTrazado(referencia(t.premiumStrong)),
    // El degradado de área es decoración declarada: se informa y no se exige.
    areaRegular: Math.min(...vidrio.map((s) => contrastRatio(over(t.regularStrong, t.fillAlpha, s), s))),
    areaPremium: Math.min(...vidrio.map((s) => contrastRatio(over(t.premiumStrong, t.fillAlpha, s), s))),
  };
}

// Texto ≥ 4.5; texto grande (la cifra a peso 800) y no textual —anillo, botón
// como forma, curva y referencia del histórico— ≥ 3.
//
// Los chips SÍ se exigen, en sus dos tintas: son texto de lectura de 12 px, y
// que declaren su nombre completo en `aria-label` no compensa no poder leerlos.
// Quedan informativos los dos cantos del vidrio —nunca se pintan sólidos— y el
// degradado de área, que es decoración.
export const MINIMUM = Object.freeze({
  foreground: 4.5, muted: 4.5, accent: 4.5, button: 4.5,
  chipRegular: 4.5, chipPremium: 4.5, chipMutedRegular: 4.5, chipMutedPremium: 4.5,
  primary: 3, ring: 3, regularStrong: 3, premiumStrong: 3, promedioRegular: 3, promedioPremium: 3,
});

const pct = (fraccion) => `${Number((fraccion * 100).toFixed(2))}%`;

if (typeof process !== 'undefined' && /contrast\.mjs$/.test(process.argv?.[1] ?? '')) {
  const paleta = leerPaleta(fs.readFileSync(HOJA, 'utf8'));
  let fallo = false;
  for (const tema of Object.keys(paleta.temas)) {
    for (const [nombre, valor] of Object.entries(verifyContrast(tema, paleta))) {
      const piso = MINIMUM[nombre];
      const ok = piso === undefined || valor >= piso;
      if (!ok) fallo = true;
      process.stdout.write(`${tema.padEnd(5)} ${nombre.padEnd(17)} ${valor.toFixed(2).padStart(6)} ${piso === undefined ? '(informativo)' : ok ? 'ok' : `< ${piso}`}\n`);
    }
  }
  process.stdout.write(`\nPaleta leída de ${path.relative(raiz, HOJA)} · vidrio ${paleta.vidrio.map(pct).join('/')} · card fijo ${pct(paleta.fijo)} · chip ${pct(paleta.chip)} · referencia ${pct(paleta.referencia)}\n`);
  process.exitCode = fallo ? 1 : 0;
}
