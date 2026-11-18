// Runs the request templates, If conditions and Code nodes of each workflow against
// recorded API responses, so a field renamed in a workflow or in the API shows up here.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { body, condition, context, evaluate, fixture, items, loadWorkflow, node, runCode } from './helpers.mjs';

const r = (name) => fixture(`responses/${name}.json`);

describe('urls-to-markdown', () => {
  const wf = loadWorkflow('urls-to-markdown.json');

  it('builds a scrape request per URL', () => {
    const urls = evaluate(node(wf, 'URLs to convert').parameters.assignments.assignments[0].value, context());
    assert.ok(urls.length >= 1);
    const req = body(node(wf, 'Scrape to Markdown'), context({ json: { url: urls[0] } }));
    assert.deepEqual(req, { url: urls[0], format: 'markdown', contentMode: 'smart', frontmatter: true });
  });

  it('turns each page into a named Markdown item', () => {
    const out = runCode(node(wf, 'Name the file'), context({ input: items(r('extract')) }));
    assert.equal(out.length, 1);
    assert.equal(out[0].json.fileName, 'books-toscrape-com-catalogue-a-light-in-the-attic-1000-index-html.md');
    assert.match(out[0].json.markdown, /^# A Light in the Attic/);
    assert.equal(out[0].json.status, 200);
    assert.equal(evaluate(node(wf, 'Markdown file').parameters.options.fileName, context({ json: out[0].json })), out[0].json.fileName);
  });
});

describe('serp-rank-check', () => {
  const wf = loadWorkflow('serp-rank-check.json');
  const settings = {
    domain: 'wikipedia.org',
    keywords: ['xml sitemap'],
    country: 'us',
    lang: 'en',
    location: 'New York, New York, United States',
    depth: 20,
    alertWebhookUrl: 'https://hooks.example.com/rank',
  };
  const keywordItems = runCode(node(wf, 'One item per keyword'), context({ input: items(settings) }));
  const outputs = { Settings: items(settings), 'One item per keyword': keywordItems };

  it('builds one search per keyword with a number for num', () => {
    assert.equal(keywordItems.length, 1);
    const req = body(node(wf, 'Google search'), context({ json: keywordItems[0].json }));
    assert.deepEqual(req, { query: 'xml sitemap', engine: 'google', country: 'us', lang: 'en', location: settings.location, num: 20 });
  });

  it('finds the domain through display_link when Google returns a click address', () => {
    const staticData = {};
    const [first] = runCode(node(wf, 'Find the domain rank'), context({ input: items(r('serp')), outputs, staticData }));
    assert.equal(first.json.rank, 3);
    assert.equal(first.json.previous_rank, null);
    assert.equal(first.json.changed, false, 'the first run is only a baseline');
    assert.equal(first.json.ai_overview, true);
    assert.equal(first.json.results_seen, 3);
    assert.deepEqual(JSON.parse(JSON.stringify(staticData.ranks)), { 'xml sitemap': 3 });
  });

  it('reads source before the link', () => {
    const [row] = runCode(
      node(wf, 'Find the domain rank'),
      context({ input: items(r('serp')), outputs: { ...outputs, 'One item per keyword': items({ ...keywordItems[0].json, domain: 'storeownertips.com' }) } }),
    );
    assert.equal(row.json.rank, 2);
    assert.equal(row.json.url, 'https://storeownertips.com/glossary/xml-sitemap/');
  });

  it('flags a change and alerts only when a webhook is set', () => {
    const staticData = { ranks: { 'xml sitemap': 5 } };
    const [row] = runCode(node(wf, 'Find the domain rank'), context({ input: items(r('serp')), outputs, staticData }));
    assert.equal(row.json.changed, true);
    assert.equal(row.json.message, 'wikipedia.org for "xml sitemap": #5 -> #3');
    const ifNode = node(wf, 'Rank changed?');
    assert.equal(condition(ifNode, context({ json: row.json, outputs })), true);
    assert.equal(condition(ifNode, context({ json: row.json, outputs: { ...outputs, Settings: items({ ...settings, alertWebhookUrl: '' }) } })), false);
    const alert = node(wf, 'Send alert');
    assert.equal(evaluate(alert.parameters.url, context({ outputs })), settings.alertWebhookUrl);
    assert.deepEqual(JSON.parse(evaluate(alert.parameters.jsonBody, context({ json: row.json }))), { text: row.json.message });
  });

  it('reports a domain that is not in the results', () => {
    const staticData = { ranks: { 'xml sitemap': 3 } };
    const [row] = runCode(
      node(wf, 'Find the domain rank'),
      context({ input: items(r('serp')), outputs: { ...outputs, 'One item per keyword': items({ ...keywordItems[0].json, domain: 'example.org' }) }, staticData }),
    );
    assert.equal(row.json.rank, null);
    assert.equal(row.json.message, 'example.org for "xml sitemap": #3 -> not in top 20');
  });
});

describe('google-maps-places-to-csv', () => {
  const wf = loadWorkflow('google-maps-places-to-csv.json');
  const search = { query: 'public library', location: 'Brooklyn, NY', country: 'us', max_results: 20 };

  it('wraps the collector input', () => {
    assert.deepEqual(body(node(wf, 'Run collector'), context({ json: search })), { input: search });
  });

  it('polls a queued run and goes on with a finished one', () => {
    const ifNode = node(wf, 'Run finished?');
    assert.equal(condition(ifNode, context({ json: r('collector-run-queued') })), false);
    assert.equal(condition(ifNode, context({ json: r('collector-run-done') })), true);
    assert.equal(condition(ifNode, context({ json: r('collector-run-failed') })), true);
    const url = evaluate(node(wf, 'Poll run').parameters.url, context({ json: r('collector-run-queued') }));
    assert.equal(url, 'https://api.quanticdata.io/v1/scraper/collectors/runs/run_example_0001');
  });

  it('keeps the place columns', () => {
    const out = runCode(node(wf, 'Places'), context({ input: items(r('collector-run-done')) }));
    assert.equal(out.length, 2);
    assert.deepEqual(Object.keys(out[0].json), ['rank', 'name', 'category', 'address', 'phone', 'website', 'rating', 'reviews', 'latitude', 'longitude', 'maps_url', 'place_id']);
    assert.equal(out[0].json.name, 'Example Library 1');
    assert.equal(out[0].json.reviews, null);
  });

  it('stops on a failed run', () => {
    assert.throws(() => runCode(node(wf, 'Places'), context({ input: items(r('collector-run-failed')) })), /Collector run failed: Example failure/);
  });
});

describe('page-change-alert', () => {
  const wf = loadWorkflow('page-change-alert.json');
  const pages = evaluate(node(wf, 'Settings').parameters.assignments.assignments[0].value, context());
  const target = items(pages[1]);
  const compare = node(wf, 'Compare with last run');

  it('scrapes with links and images stripped', () => {
    assert.deepEqual(body(node(wf, 'Scrape page'), context({ json: pages[0] })), {
      url: pages[0].url,
      format: 'markdown',
      contentMode: 'smart',
      links_mode: 'strip',
      images_mode: 'strip',
    });
  });

  it('records a baseline, then detects a change', () => {
    const staticData = {};
    const outputs = { 'One item per page': target };
    const [first] = runCode(compare, context({ input: items(r('extract')), outputs, staticData }));
    assert.equal(first.json.changed, false);
    assert.match(first.json.hash, /^[0-9a-f]{8}$/);

    const [same] = runCode(compare, context({ input: items(r('extract')), outputs, staticData }));
    assert.equal(same.json.changed, false);
    assert.equal(same.json.previous_hash, first.json.hash);

    const edited = r('extract');
    edited.payload.content = edited.payload.content.replace('£51.77', '£45.00');
    const [changed] = runCode(compare, context({ input: items(edited), outputs, staticData }));
    assert.equal(changed.json.changed, true);
    assert.match(changed.json.message, /^Changed: /);
  });
});

describe('site-to-rag-chunks', () => {
  const wf = loadWorkflow('site-to-rag-chunks.json');
  const settings = { site: 'https://quotes.toscrape.com/', search: '/author/', limit: 10, maxChunkChars: 2000 };

  it('maps, then batches the URLs it found', () => {
    assert.deepEqual(body(node(wf, 'Map site'), context({ json: settings })), { url: settings.site, search: '/author/', limit: 10 });
    const [urls] = runCode(node(wf, 'URLs to scrape'), context({ input: items(r('map')) }));
    assert.equal(urls.json.urls.length, 2);
    assert.deepEqual(body(node(wf, 'Start batch'), context({ json: urls.json })), { urls: urls.json.urls, format: 'markdown', contentMode: 'smart' });
  });

  it('stops when the map finds nothing', () => {
    assert.throws(() => runCode(node(wf, 'URLs to scrape'), context({ input: items(r('map-empty')) })), /found no URLs/);
  });

  it('polls the batch until it is no longer running', () => {
    const outputs = { 'Start batch': items(r('batch-start')) };
    const url = evaluate(node(wf, 'Poll batch').parameters.url, context({ outputs }));
    assert.equal(url, 'https://api.quanticdata.io/v1/scraper/batch/00000000-0000-4000-8000-000000000001');
    const ifNode = node(wf, 'Batch finished?');
    assert.equal(condition(ifNode, context({ json: r('batch-running') })), false);
    assert.equal(condition(ifNode, context({ json: r('batch-completed') })), true);
  });

  it('splits pages at headings into JSONL chunks', () => {
    const [out] = runCode(node(wf, 'Chunk for RAG'), context({ input: items(r('batch-completed')), outputs: { Settings: items(settings) } }));
    const lines = out.json.jsonl.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(out.json.chunks, lines.length);
    assert.equal(out.json.pages, 2);
    assert.deepEqual(lines.map((l) => l.heading), ['Quotes to Scrape', 'Albert Einstein', 'Quotes to Scrape', 'Jane Austen']);
    assert.ok(lines.every((l) => l.url.startsWith('https://quotes.toscrape.com/author/') && l.text.length > 0));
  });

  it('cuts sections longer than maxChunkChars', () => {
    const job = r('batch-completed');
    job.payload.items = [{ url: 'https://quotes.toscrape.com/author/x', status: 200, title: 'T', content: '# A\n\n' + 'x'.repeat(4500) }];
    const [out] = runCode(node(wf, 'Chunk for RAG'), context({ input: items(job), outputs: { Settings: items(settings) } }));
    const lines = out.json.jsonl.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 3);
    assert.ok(lines.every((l) => l.text.length <= 2000));
  });
});

describe('mcp-research-agent', () => {
  const wf = loadWorkflow('mcp-research-agent.json');

  it('connects the hosted MCP server over Streamable HTTP with header auth', () => {
    const mcp = node(wf, 'QuanticData MCP').parameters;
    assert.equal(mcp.endpointUrl, 'https://api.quanticdata.io/mcp');
    assert.equal(mcp.serverTransport, 'httpStreamable');
    assert.equal(mcp.authentication, 'headerAuth');
    // Tool names verified against the server's tool list on 2026-11-18.
    for (const tool of mcp.includeTools) assert.ok(['search', 'scrape', 'map', 'crawl', 'batch'].includes(tool), tool);
  });

  it('wires the model and the tools into the agent', () => {
    assert.equal(wf.connections['Chat model'].ai_languageModel[0][0].node, 'Research agent');
    assert.equal(wf.connections['QuanticData MCP'].ai_tool[0][0].node, 'Research agent');
    assert.equal(wf.connections['When chat message received'].main[0][0].node, 'Research agent');
  });
});
