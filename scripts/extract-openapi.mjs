// Rebuilds test/fixtures/openapi-subset.json from the public OpenAPI file.
// Usage:
//   curl -sL https://quanticdata.io/docs/openapi.json -o openapi.json
//   node scripts/extract-openapi.mjs openapi.json
import { readFileSync, writeFileSync } from 'node:fs';

const [, , source] = process.argv;
if (!source) {
  console.error('Usage: node scripts/extract-openapi.mjs <openapi.json>');
  process.exit(2);
}
const spec = JSON.parse(readFileSync(source, 'utf8'));

function resolve(node, seen = new Set()) {
  if (node && node.$ref) {
    if (seen.has(node.$ref)) return {};
    let target = spec;
    for (const part of node.$ref.replace('#/', '').split('/')) target = target[part];
    return resolve(target, new Set([...seen, node.$ref]));
  }
  return node;
}

function fieldNames(schema) {
  const s = resolve(schema);
  if (!s || typeof s !== 'object') return [];
  const names = Object.keys(s.properties || {});
  for (const key of ['allOf', 'oneOf', 'anyOf']) {
    for (const part of s[key] || []) names.push(...fieldNames(part));
  }
  return [...new Set(names)].sort();
}

const endpoints = {};
for (const [path, item] of Object.entries(spec.paths)) {
  if (!path.startsWith('/scraper/')) continue;
  for (const [method, op] of Object.entries(item)) {
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
    const body = op.requestBody && resolve(op.requestBody).content?.['application/json'];
    endpoints[`${method.toUpperCase()} ${path}`] = {
      requestFields: body ? fieldNames(body.schema) : [],
      queryParams: (op.parameters || []).map((p) => resolve(p)).filter((p) => p.in === 'query').map((p) => p.name).sort(),
    };
  }
}
const out = { source: 'https://quanticdata.io/docs/openapi.json', version: spec.info?.version ?? null, server: spec.servers[0].url, endpoints };
writeFileSync(new URL('../test/fixtures/openapi-subset.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(`Wrote ${Object.keys(endpoints).length} endpoints`);
