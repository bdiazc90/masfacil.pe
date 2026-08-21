// Protege los invariantes de la política de identidad y evidencia contra deriva silenciosa
// entre documentos vivos. No valida redacción: valida estructura y afirmaciones materiales.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const EVIDENCE_METHODS = ['owner_verified', 'first_party', 'public_web_observed', 'open_reusable', 'known_contributor'];

test('los métodos de evidencia del catálogo son consistentes', () => {
  const agents = read('AGENTS.md');
  const metodo = read('docs/metodo.md');
  for (const method of EVIDENCE_METHODS) {
    assert.ok(agents.includes(`\`${method}\``), `AGENTS.md no declara ${method}`);
    assert.ok(metodo.includes(`\`${method}\``), `docs/metodo.md no declara ${method}`);
  }
});

test('AGENTS.md conserva los guardrails generales además de la política de catálogo', () => {
  const agents = read('AGENTS.md');
  for (const heading of ['Documentación', 'Evidencia e investigación', 'Producto y UX', 'Principios técnicos', 'Comunicación con el owner', 'Mapa visual', 'Cierre de gate']) {
    assert.match(agents, new RegExp(`^## ${heading}$`, 'm'), `falta la sección ${heading}`);
  }
  assert.match(agents, /La interfaz no debe llenarse de disclaimers/);
});

test('todo NO-GO registrado declara alcance, evidencia de reapertura y responsable', () => {
  const factibilidad = read('docs/factibilidad.md');
  const section = factibilidad.split('## Registro de exclusiones y NO-GO')[1];
  assert.ok(section, 'docs/factibilidad.md no tiene registro de exclusiones');
  const header = section.split('\n').find((line) => line.startsWith('| Exclusión'));
  assert.ok(header, 'el registro no tiene encabezado reconocible');
  assert.match(header, /Evidencia que la reabriría/);
  assert.match(header, /Responsable/);

  const rows = section.split('\n')
    .filter((line) => line.startsWith('|') && !line.startsWith('| Exclusión') && !/^\|\s*-{2,}/.test(line))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
  assert.ok(rows.length >= 4, 'el registro tiene muy pocas entradas para ser el vigente');
  for (const row of rows) {
    assert.equal(row.length, 5, `una fila del registro no tiene 5 columnas: ${row.join(' | ')}`);
    for (const cell of row) assert.notEqual(cell, '', `celda vacía en el registro: ${row.join(' | ')}`);
    assert.doesNotMatch(row.join(' | '), /No aplica|Cerrado por alcance/i, `NO-GO resuelto mezclado con el registro vigente: ${row.join(' | ')}`);
  }
});

test('Gate 2.3 pertenece consistentemente a Capa 2 y mantiene alcance pequeño', () => {
  const factibilidad = read('docs/factibilidad.md');
  const roadmap = read('docs/roadmap.md');
  assert.match(factibilidad, /Gate 2\.3 \(Capa 2\)/);
  assert.doesNotMatch(factibilidad, /Gate de catálogo \(Capa 5\)/);
  assert.match(roadmap, /No bloquean Gate 2\.3: automatizar el refresco de Registro\/GIS/);
  assert.match(roadmap, /public_web_observed/);
});

test('CLAUDE.md vuelve a ser el contrato permanente del Challenger', () => {
  const claude = read('CLAUDE.md');
  assert.match(claude, /Challenger \/ Reviewer adversarial/);
  assert.doesNotMatch(claude, /mandato temporal|únicamente para una auditoría extraordinaria/i);
});

test('la documentación no afirma que la identidad comercial esté publicada', () => {
  assert.match(read('README.md'), /Identidad comercial: hoy no se publica/);
  assert.match(read('docs/factibilidad.md'), /ninguna identidad comercial está publicada/i);
  assert.match(read('docs/datos.md'), /ninguna identidad comercial se publica/i);
});

test('el contrato del piloto se conserva histórico y su sucesión queda declarada', () => {
  const overlay = JSON.parse(read('contracts/gate-2.1-commercial-identity-overlay.schema.json'));
  const entry = overlay.$defs.entry.properties;
  // El contrato histórico no se muta para simular que siempre admitió observación humana.
  assert.equal(entry.discovery_method.const, 'normalized_address_exact');
  assert.equal(entry.integration_method.const, 'official_anchor_exact');
  assert.equal(overlay.$defs.source.properties.url.pattern, '^https://');
  assert.ok(overlay.$defs.source.properties.kind.enum.includes('owner_verified'));

  const datos = read('docs/datos.md');
  assert.match(datos, /contrato histórico/i);
  assert.match(datos, /contrato sucesor/i);
  assert.match(datos, /publication-matrix\.mjs/);
  assert.match(datos, /requiere migración/i);
});
