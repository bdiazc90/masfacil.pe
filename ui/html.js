// Escapar texto para las partes que todavía se pintan con `innerHTML` desde el
// coordinador y el histórico. La lista de resultados ya no lo necesita: React
// escapa por construcción. Se retira cuando G3 pase esas partes a React.
export const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
