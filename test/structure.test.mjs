import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { API_BASE, loadWorkflows } from './helpers.mjs';

// Node types the workflows may use, with the typeVersion each one is written for.
const KNOWN_TYPES = {
  'n8n-nodes-base.manualTrigger': [1],
  'n8n-nodes-base.scheduleTrigger': [1.2],
  'n8n-nodes-base.set': [3.4],
  'n8n-nodes-base.splitOut': [1],
  'n8n-nodes-base.code': [2],
  'n8n-nodes-base.httpRequest': [4.2],
  'n8n-nodes-base.if': [2.2],
  'n8n-nodes-base.wait': [1.1],
  'n8n-nodes-base.convertToFile': [1.1],
  'n8n-nodes-base.stickyNote': [1],
  '@n8n/n8n-nodes-langchain.chatTrigger': [1.1],
  '@n8n/n8n-nodes-langchain.agent': [2.2],
  '@n8n/n8n-nodes-langchain.lmChatOpenAi': [1.2],
  '@n8n/n8n-nodes-langchain.mcpClientTool': [1.2],
};

const SECRET_PATTERNS = [
  /q[dp]_live_[0-9a-f]{16,}/i,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /BEGIN [A-Z ]*PRIVATE KEY/,
  /Bearer\s+[A-Za-z0-9_-]{12,}/,
];

const workflows = loadWorkflows();

describe('workflow files', () => {
  it('there are workflows to test', () => {
    assert.ok(workflows.length >= 6);
  });

  for (const { file, raw, json: wf } of workflows) {
    describe(file, () => {
      it('has a name, nodes, connections and the v1 execution order', () => {
        assert.equal(typeof wf.name, 'string');
        assert.ok(Array.isArray(wf.nodes) && wf.nodes.length > 1);
        assert.equal(typeof wf.connections, 'object');
        assert.equal(wf.settings.executionOrder, 'v1');
      });

      it('carries no instance data, pinned data or credentials', () => {
        assert.equal(wf.meta?.instanceId, undefined);
        assert.equal(wf.meta.templateCredsSetupCompleted, false);
        assert.deepEqual(wf.pinData, {});
        for (const n of wf.nodes) assert.equal(n.credentials, undefined, `${n.name} has credentials`);
        for (const p of SECRET_PATTERNS) assert.doesNotMatch(raw, p);
      });

      it('uses unique node names and ids', () => {
        const names = wf.nodes.map((n) => n.name);
        const ids = wf.nodes.map((n) => n.id);
        assert.equal(new Set(names).size, names.length);
        assert.equal(new Set(ids).size, ids.length);
      });

      it('uses known node types and versions', () => {
        for (const n of wf.nodes) {
          assert.ok(KNOWN_TYPES[n.type], `unknown node type ${n.type}`);
          assert.ok(KNOWN_TYPES[n.type].includes(n.typeVersion), `${n.name}: ${n.type} v${n.typeVersion}`);
          assert.ok(Array.isArray(n.position) && n.position.length === 2);
        }
      });

      it('connects only existing nodes', () => {
        const names = new Set(wf.nodes.map((n) => n.name));
        for (const [from, byType] of Object.entries(wf.connections)) {
          assert.ok(names.has(from), `connection from missing node ${from}`);
          for (const outputs of Object.values(byType)) {
            for (const targets of outputs) {
              for (const t of targets) assert.ok(names.has(t.node), `${from} -> missing ${t.node}`);
            }
          }
        }
      });

      it('leaves no node unconnected except sticky notes and triggers', () => {
        const targets = new Set();
        for (const byType of Object.values(wf.connections)) {
          for (const outputs of Object.values(byType)) for (const ts of outputs) for (const t of ts) targets.add(t.node);
        }
        for (const n of wf.nodes) {
          if (n.type.endsWith('stickyNote') || /trigger/i.test(n.type)) continue;
          const isSource = Object.hasOwn(wf.connections, n.name);
          assert.ok(targets.has(n.name) || isSource, `${n.name} is not connected`);
        }
      });

      it('authenticates QuanticData calls with a Header Auth credential, never inline', () => {
        for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.httpRequest')) {
          const url = String(n.parameters.url);
          if (!url.includes('api.quanticdata.io')) continue;
          assert.ok(url.replace(/^=/, '').startsWith(API_BASE), `${n.name}: ${url}`);
          assert.equal(n.parameters.authentication, 'genericCredentialType');
          assert.equal(n.parameters.genericAuthType, 'httpHeaderAuth');
          assert.equal(n.parameters.sendHeaders, undefined, `${n.name} sends inline headers`);
        }
      });

      it('explains its setup in a sticky note that links the pricing page', () => {
        const notes = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.stickyNote');
        assert.ok(notes.length >= 1);
        assert.match(notes.map((n) => n.parameters.content).join('\n'), /https:\/\/quanticdata\.io\/pricing\//);
      });
    });
  }
});
