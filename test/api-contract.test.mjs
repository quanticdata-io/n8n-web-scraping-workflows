// Every QuanticData call in the workflows must match a documented endpoint, and send
// only documented body fields and query parameters (test/fixtures/openapi-subset.json,
// rebuilt from the public OpenAPI file by scripts/extract-openapi.mjs).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { API_BASE, fixture, loadWorkflows } from './helpers.mjs';

const spec = fixture('openapi-subset.json');
const collector = fixture('responses/collector-google_maps_places.json');

function endpointFor(method, url) {
  const path = url.replace(/^=/, '').slice(API_BASE.length).replace(/\{\{[\s\S]*?\}\}/g, '{param}');
  for (const key of Object.keys(spec.endpoints)) {
    const [m, p] = key.split(' ');
    if (m !== method) continue;
    const pattern = new RegExp(`^${p.replace(/\{[^}]+\}/g, '[^/]+')}$`);
    if (pattern.test(path)) return key;
  }
  return null;
}

// Replaces {{ }} expressions with placeholders so the template parses as JSON.
function templateKeys(jsonBody) {
  const text = jsonBody.replace(/^=/, '').replace(/"\{\{[\s\S]*?\}\}"/g, '"x"').replace(/\{\{[\s\S]*?\}\}/g, '0');
  return JSON.parse(text);
}

const calls = [];
for (const { file, json: wf } of loadWorkflows()) {
  for (const n of wf.nodes) {
    if (n.type === 'n8n-nodes-base.httpRequest' && String(n.parameters.url).includes('api.quanticdata.io')) {
      calls.push({ file, node: n });
    }
  }
}

describe('QuanticData calls match the OpenAPI document', () => {
  it('found the calls', () => {
    assert.ok(calls.length >= 8);
    assert.equal(spec.server, API_BASE);
  });

  for (const { file, node } of calls) {
    describe(`${file}: ${node.name}`, () => {
      const method = node.parameters.method || 'GET';
      const key = endpointFor(method, node.parameters.url);

      it('targets a documented endpoint', () => {
        assert.ok(key, `${method} ${node.parameters.url} is not in the OpenAPI document`);
      });

      it('sends only documented body fields', () => {
        if (!node.parameters.jsonBody) return;
        const sent = Object.keys(templateKeys(node.parameters.jsonBody));
        for (const field of sent) assert.ok(spec.endpoints[key].requestFields.includes(field), `${key} has no field "${field}"`);
      });

      it('sends only documented query parameters', () => {
        const query = node.parameters.queryParameters?.parameters ?? [];
        for (const q of query) assert.ok(spec.endpoints[key].queryParams.includes(q.name), `${key} has no query "${q.name}"`);
      });

      if (key === 'POST /scraper/collectors/{slug}/run') {
        it("sends an input that fits the collector's input_schema", () => {
          const input = templateKeys(node.parameters.jsonBody).input;
          const props = Object.keys(collector.input_schema.properties);
          for (const field of Object.keys(input)) assert.ok(props.includes(field), `collector has no input "${field}"`);
          for (const field of collector.input_schema.required) assert.ok(field in input, `missing required "${field}"`);
        });
      }
    });
  }
});
