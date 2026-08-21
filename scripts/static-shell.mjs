import fs from 'node:fs';
import path from 'node:path';

function localModulePath(webRoot, importer, specifier) {
  const clean = specifier.split(/[?#]/, 1)[0];
  if (clean.startsWith('/')) return path.resolve(webRoot, `.${clean}`);
  if (clean.startsWith('.')) return path.resolve(path.dirname(importer), clean);
  return null;
}

function moduleSpecifiers(source) {
  return [...source.matchAll(/\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

function htmlModuleSources(source) {
  return [...source.matchAll(/<script\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => /\btype=['"]module['"]/i.test(tag))
    .map((tag) => tag.match(/\bsrc=['"]([^'"]+)['"]/i)?.[1])
    .filter(Boolean);
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function validateStaticShell(webRoot) {
  const root = path.resolve(webRoot);
  const errors = [];
  const queue = [];
  const visited = new Set();

  for (const relative of ['index.html', 'gasolina/index.html']) {
    const html = path.join(root, relative);
    if (!fs.existsSync(html)) continue;
    for (const source of htmlModuleSources(fs.readFileSync(html, 'utf8'))) {
      const resolved = localModulePath(root, html, source);
      if (!resolved) errors.push(`${relative}: módulo web no local ${source}`);
      else queue.push(resolved);
    }
  }
  queue.push(path.join(root, 'sw.js'));

  while (queue.length) {
    const file = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);
    const relative = path.relative(root, file);
    if (!inside(root, file)) { errors.push(`módulo fuera de web/: ${file}`); continue; }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { errors.push(`falta módulo estático ${relative}`); continue; }
    const source = fs.readFileSync(file, 'utf8');
    for (const specifier of moduleSpecifiers(source)) {
      const resolved = localModulePath(root, file, specifier);
      if (!resolved) errors.push(`${relative}: import web no local ${specifier}`);
      else queue.push(resolved);
    }
  }

  const worker = path.join(root, 'sw.js');
  if (fs.existsSync(worker)) {
    const shell = fs.readFileSync(worker, 'utf8').match(/\bconst\s+SHELL\s*=\s*\[([\s\S]*?)\]\s*;/)?.[1];
    if (!shell) errors.push('sw.js: no se pudo leer SHELL');
    else for (const match of shell.matchAll(/['"](\/[^'"]+)['"]/g)) {
      const pathname = match[1].split(/[?#]/, 1)[0];
      if (pathname.endsWith('/')) continue;
      const target = path.resolve(root, `.${pathname}`);
      if (!inside(root, target) || !fs.existsSync(target) || !fs.statSync(target).isFile()) errors.push(`sw.js SHELL: falta ${pathname}`);
    }
  }

  return [...new Set(errors)].sort();
}
