// Offline helpers: load the workflows, evaluate n8n expressions and run Code nodes
// against recorded API responses. This is a small stand-in for the parts of n8n the
// workflows use, not a full n8n runtime.
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);

export const API_BASE = 'https://api.quanticdata.io/v1';

export function loadWorkflows() {
  const dir = new URL('workflows/', root);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => ({ file, raw: readFileSync(new URL(file, dir), 'utf8'), json: JSON.parse(readFileSync(new URL(file, dir), 'utf8')) }));
}

export function loadWorkflow(file) {
  return JSON.parse(readFileSync(new URL(`workflows/${file}`, root), 'utf8'));
}

export function fixture(name) {
  return JSON.parse(readFileSync(new URL(`test/fixtures/${name}`, root), 'utf8'));
}

export function node(workflow, name) {
  const found = workflow.nodes.find((n) => n.name === name);
  if (!found) throw new Error(`No node named ${name}`);
  return found;
}

/** Items as n8n passes them between nodes. */
export const items = (...jsons) => jsons.map((json) => ({ json }));

/**
 * Context for expressions and Code nodes.
 * outputs: node name -> array of items that node produced earlier in the run.
 */
export function context({ json = {}, input = [], outputs = {}, staticData = {} } = {}) {
  const ref = (name) => {
    const out = outputs[name];
    if (!out) throw new Error(`Expression references node "${name}" with no recorded output`);
    return { all: () => out, first: () => out[0], last: () => out[out.length - 1], item: out[0] };
  };
  return {
    $json: json,
    $: ref,
    $input: { all: () => input, first: () => input[0], last: () => input[input.length - 1] },
    $now: { toFormat: () => '2026-11-18' },
    $getWorkflowStaticData: () => staticData,
    // Node globals the n8n Code node also exposes
    URL,
  };
}

const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function run(expr, ctx) {
  return vm.runInNewContext(`(${expr})`, { ...ctx }, { timeout: 1000 });
}

/** Evaluates an n8n parameter: "=..." strings with {{ }} expressions. */
export function evaluate(param, ctx) {
  if (typeof param !== 'string' || !param.startsWith('=')) return param;
  const text = param.slice(1);
  const trimmed = text.trim();
  if (trimmed.startsWith('{{') && trimmed.endsWith('}}') && trimmed.indexOf('{{', 2) === -1) {
    return plain(run(trimmed.slice(2, -2), ctx));
  }
  return text.replace(/\{\{([\s\S]*?)\}\}/g, (_, expr) => {
    const v = run(expr, ctx);
    return typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
  });
}

/** Evaluates a JSON body template and parses the result, as n8n does for specifyBody=json. */
export function body(httpNode, ctx) {
  return JSON.parse(evaluate(httpNode.parameters.jsonBody, ctx));
}

/** Runs a Code node ("Run Once for All Items" mode) and returns its items. */
export function runCode(codeNode, ctx) {
  const result = vm.runInNewContext(`(function () {\n${codeNode.parameters.jsCode}\n})()`, { ...ctx }, { timeout: 2000 });
  return plain(result);
}

/** Evaluates the single condition of an If node. */
export function condition(ifNode, ctx) {
  const [c] = ifNode.parameters.conditions.conditions;
  return evaluate(c.leftValue, ctx);
}
