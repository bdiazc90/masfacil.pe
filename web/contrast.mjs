// Contraste medido en el peor caso real (DESIGN.md §8). Copia de los tokens de
// web/styles.css en los mismos términos: knobs OKLCH para los neutros y hex
// para el resto. Mover un color obliga a actualizar las dos.
// Ejecutar: node web/contrast.mjs → imprime las razones y falla bajo el mínimo.
const HUE = 130, PAPER = 0.01, PAPER_DARK = 0.02, INK = 0.010;

function oklch(L, C, H) {
  const h = (H * Math.PI) / 180; const a = C * Math.cos(h); const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b; const m_ = L - 0.1055613458 * a - 0.0638541728 * b; const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
  return lin.map((x) => { const c = Math.min(1, Math.max(0, x)); return Math.round((c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 255); });
}
const rgb = (color) => Array.isArray(color) ? color : color.replace('#', '').match(/.{2}/g).map((part) => Number.parseInt(part, 16));

const themes = Object.freeze({
  light: {
    background: oklch(.95, PAPER, HUE), foreground: oklch(.30, INK, HUE), muted: oklch(.46, INK, HUE), card: oklch(.98, PAPER, HUE), card2: oklch(.90, PAPER, HUE), border: oklch(.40, INK, HUE),
    accent: '#17615d', primary: '#074b3f', primaryForeground: '#ffffff', ring: '#2e7d32',
    regular: '#708d3a', regularStrong: '#207461', premium: '#4a78a8', premiumStrong: '#1d4e8e',
    glow: ['#bfb6a7', '#d7d2c3', '#bb9978'], glowAlpha: .6,
  },
  dark: {
    background: oklch(.20, PAPER_DARK, HUE), foreground: oklch(.78, INK, HUE), muted: oklch(.75, INK, HUE), card: oklch(.30, PAPER_DARK, HUE), card2: oklch(.23, PAPER_DARK, HUE), border: oklch(.62, INK, HUE),
    accent: '#63d0c9', primary: '#32b988', primaryForeground: '#052611', ring: '#4caf50',
    regular: '#7fc9a0', regularStrong: '#8fe3b3', premium: '#8fb4e0', premiumStrong: '#a4c6f2',
    glow: ['#815a48', '#585b48', '#8d6c5e'], glowAlpha: .6,
  },
});

const lum = (color) => color.map((value) => { const channel = value / 255; return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4; }).reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
const over = (front, alpha, back) => front.map((value, index) => alpha * value + (1 - alpha) * back[index]);
export const contrastRatio = (left, right) => (Math.max(lum(left), lum(right)) + 0.05) / (Math.min(lum(left), lum(right)) + 0.05);

// Peor caso: el vidrio (card al 20 %, card-2 al 14 %, card al 8 %) y el card de
// controles fijo (card al 90 %) sobre el papel liso y sobre cada mancha del glow.
export function verifyContrast(theme) {
  const token = themes[theme]; if (!token) throw new Error(`Tema desconocido: ${theme}`);
  const bg = rgb(token.background);
  const backdrops = [bg, ...token.glow.map((glow, index) => over(rgb(glow), index === 2 ? token.glowAlpha * .6 : token.glowAlpha, bg))];
  const surfaces = backdrops.flatMap((backdrop) => [over(rgb(token.card), .2, backdrop), over(rgb(token.card2), .144, backdrop), over(rgb(token.card), .08, backdrop), over(rgb(token.card), .9, backdrop)]);
  const minimum = (color) => Math.min(...surfaces.map((surface) => contrastRatio(rgb(color), surface)));
  const chip = (product) => Math.min(...surfaces.map((surface) => contrastRatio(rgb(product), over(rgb(product), .16, surface))));
  return {
    foreground: minimum(token.foreground), muted: minimum(token.muted), accent: minimum(token.accent),
    regularStrong: minimum(token.regularStrong), premiumStrong: minimum(token.premiumStrong),
    button: contrastRatio(rgb(token.primaryForeground), rgb(token.primary)), primary: minimum(token.primary), ring: minimum(token.ring), border: minimum(token.border),
    chipRegular: chip(token.regular), chipPremium: chip(token.premium),
  };
}

// Texto ≥ 4.5; texto grande (la cifra de 24 px a peso 800 es lo único que
// lleva el color «strong») y no textual (anillo, botón como forma) ≥ 3. El
// borde y los chips de producto se informan pero no se exigen: el borde nunca
// se pinta sólido y el dato del chip lo lleva la cifra; el chip declara su
// nombre completo en aria-label.
export const MINIMUM = Object.freeze({ foreground: 4.5, muted: 4.5, accent: 4.5, regularStrong: 3, premiumStrong: 3, button: 4.5, primary: 3, ring: 3 });

if (typeof process !== 'undefined' && /contrast\.mjs$/.test(process.argv?.[1] ?? '')) {
  let failed = false;
  for (const theme of Object.keys(themes)) {
    const result = verifyContrast(theme);
    for (const [name, value] of Object.entries(result)) {
      const floor = MINIMUM[name]; const ok = floor === undefined || value >= floor;
      if (!ok) failed = true;
      process.stdout.write(`${theme.padEnd(5)} ${name.padEnd(14)} ${value.toFixed(2).padStart(6)} ${floor === undefined ? '(informativo)' : ok ? 'ok' : `< ${floor}`}\n`);
    }
  }
  process.exitCode = failed ? 1 : 0;
}
