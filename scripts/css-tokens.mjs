/**
 * Lee del CSS los valores que la comprobación de contraste necesita medir.
 *
 * Existe para que `web/styles.css` sea la ÚNICA fuente de la paleta. Antes el
 * verificador guardaba su propia copia —54 valores a mano— y ya se había
 * desincronizado en dos sitios sin que nadie lo notara: `--border-2` no llegó a
 * copiarse nunca, y el peso del vidrio era `.144` en el script frente al 14 %
 * del CSS.
 *
 * NO es un intérprete de CSS. Sabe leer exactamente tres formas, todas escritas
 * por este proyecto: las custom properties de un bloque, `oklch()`/hex/número
 * como valor, y el porcentaje de un `color-mix()` dentro de una declaración
 * concreta. Cualquier otra cosa es un error explícito, nunca un hueco silencioso.
 */

/** Cuerpo de la primera regla cuyo selector contenga `selector`. */
function bloque(css, selector) {
  const marca = css.indexOf(selector);
  if (marca < 0) throw new Error(`css-tokens: no encuentro el selector «${selector}» en web/styles.css`);
  const abre = css.indexOf('{', marca);
  const cierra = css.indexOf('}', abre);
  if (abre < 0 || cierra < 0) throw new Error(`css-tokens: la regla de «${selector}» no está cerrada`);
  return css.slice(abre + 1, cierra);
}

/** Custom properties declaradas en un bloque, sin resolver. */
export function declaraciones(css, selector) {
  const mapa = new Map();
  for (const [, nombre, valor] of bloque(css, selector).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}]+)/gi)) mapa.set(nombre, valor.trim());
  return mapa;
}

/**
 * Todas las declaraciones de tema: los `:root` sueltos se acumulan en claro y
 * `:root[data-theme="dark"]` sobrescribe encima. Es el mismo orden en que las
 * resuelve el navegador.
 */
export function tokensPorTema(css) {
  const claro = new Map();
  for (const [, cuerpo] of css.matchAll(/(?:^|\n):root\s*\{([\s\S]*?)\n\}/g)) {
    for (const [, nombre, valor] of cuerpo.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}]+)/gi)) claro.set(nombre, valor.trim());
  }
  if (!claro.size) throw new Error('css-tokens: no hay ningún bloque `:root` con custom properties');
  const oscuro = new Map(claro);
  for (const [nombre, valor] of declaraciones(css, ':root[data-theme="dark"]')) oscuro.set(nombre, valor);
  return { light: claro, dark: oscuro };
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** OKLab → sRGB. La misma transformación que aplica el navegador a `oklch()`. */
function desdeOklch(L, C, H) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ].map((canal) => {
    const recortado = Math.min(1, Math.max(0, canal));
    return Math.round((recortado <= 0.0031308 ? 12.92 * recortado : 1.055 * recortado ** (1 / 2.4) - 0.055) * 255);
  });
}

/** Un color del CSS como `[r, g, b]`. Lanza si la forma no es una de las nuestras. */
export function color(valor, donde) {
  const texto = String(valor ?? '').trim();
  if (HEX.test(texto)) {
    const cuerpo = texto.slice(1);
    const largo = cuerpo.length === 3 ? cuerpo.split('').map((c) => c + c) : cuerpo.match(/.{2}/g);
    return largo.map((par) => Number.parseInt(par, 16));
  }
  const oklch = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)$/i.exec(texto);
  if (oklch) return desdeOklch(Number(oklch[1]) / 100, Number(oklch[2]), Number(oklch[3]));
  throw new Error(`css-tokens: no sé leer el color de ${donde}: «${texto}»`);
}

/** Un número suelto: `.38`, `0.6`, `90%`, `12px`. */
export function numero(valor, donde) {
  const encontrado = /^-?[\d.]+/.exec(String(valor ?? '').trim());
  if (!encontrado) throw new Error(`css-tokens: no sé leer el número de ${donde}: «${valor}»`);
  const crudo = Number(encontrado[0]);
  if (!Number.isFinite(crudo)) throw new Error(`css-tokens: número no finito en ${donde}: «${valor}»`);
  return String(valor).trim().endsWith('%') ? crudo / 100 : crudo;
}

/**
 * Los pesos de los `color-mix()` de un valor, en orden y como fracción.
 *
 * Es lo que permite medir el vidrio, el card fijo y el chip sin copiar sus
 * porcentajes: se leen de la receta que de verdad los pinta.
 */
export function pesosDeMezcla(valor, donde) {
  // El `var(--x)` de dentro trae su propio paréntesis: hay que dejarlo pasar
  // antes de llegar al porcentaje de la mezcla.
  const pesos = [...String(valor ?? '').matchAll(/color-mix\((?:[^()]|\([^()]*\))*?([\d.]+)%/g)].map((m) => Number(m[1]) / 100);
  if (!pesos.length) throw new Error(`css-tokens: ${donde} no tiene ningún color-mix con porcentaje: «${valor}»`);
  return pesos;
}

/** Una declaración cualquiera de una regla, como texto. */
export function declaracion(css, selector, propiedad) {
  const encontrado = new RegExp(`(?:^|;|\\{|\\n)\\s*${propiedad}\\s*:\\s*([^;}]+)`, 'i').exec(bloque(css, selector));
  if (!encontrado) throw new Error(`css-tokens: «${selector}» no declara ${propiedad}`);
  return encontrado[1].trim();
}
