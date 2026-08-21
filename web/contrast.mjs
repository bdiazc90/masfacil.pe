const themes = Object.freeze({
  light: { foreground: '#12232b', muted: '#515f66', accent: '#17615d', primary: '#074b3f', primaryForeground: '#ffffff', ring: '#2e7d32', card: '#e8f2f1', card2: '#d1dfe4', scrim: '#ffffff', dim: 0.5, bg: ['#f4f3de', '#b2dcea', '#dcf5e4', '#ffffff', '#f4b56d', '#e4c7b3', '#ffffff', '#f7bb99'] },
  dark: { foreground: '#e7ecec', muted: '#9aaab0', accent: '#63d0c9', primary: '#4caf50', primaryForeground: '#052611', ring: '#4caf50', card: '#304143', card2: '#1a2426', scrim: '#000000', dim: 0.4, bg: ['#466286', '#0b2d4b', '#125053', '#000000', '#72635a', '#372e28', '#201c16', '#0c151b'] },
});
const rgb = (hex) => hex.replace('#', '').match(/.{2}/g).map((part) => Number.parseInt(part, 16));
const lum = (color) => color.map((value) => { const channel = value / 255; return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4; }).reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
const over = (front, alpha, back) => front.map((value, index) => alpha * value + (1 - alpha) * back[index]);
export const contrastRatio = (left, right) => (Math.max(lum(left), lum(right)) + 0.05) / (Math.min(lum(left), lum(right)) + 0.05);
export function verifyContrast(theme) {
  const token = themes[theme]; if (!token) throw new Error(`Tema desconocido: ${theme}`);
  const stops = token.bg.map(rgb).sort((left, right) => lum(left) - lum(right));
  const backdrop = over(rgb(token.scrim), token.dim, theme === 'dark' ? stops.at(-1) : stops[0]);
  const surfaces = [over(rgb(token.card), .2, backdrop), over(rgb(token.card2), .144, backdrop), over(rgb(token.card2), .076, backdrop)];
  const minimum = (color) => Math.min(...surfaces.map((surface) => contrastRatio(rgb(color), surface)));
  return { foreground: minimum(token.foreground), muted: minimum(token.muted), accent: minimum(token.accent), primary: minimum(token.primary), button: contrastRatio(rgb(token.primaryForeground), rgb(token.primary)), ring: minimum(token.ring) };
}
