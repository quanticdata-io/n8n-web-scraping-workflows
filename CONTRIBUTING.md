# Contributing

Thanks for helping. New workflows and fixes to existing ones are both welcome.

## Setup

```bash
git clone https://github.com/quanticdata-io/n8n-web-scraping-workflows
cd n8n-web-scraping-workflows
npm test          # Node 20 or later, no dependencies to install
```

## Ground rules

- Use n8n core nodes. A workflow must import into a stock n8n instance without community nodes.
- QuanticData calls go through the HTTP Request node with a **Header Auth** credential chosen by the user. Never put a key, a credential id or an instance id in the JSON. Export with credentials removed and `pinData` empty.
- Call only endpoints and fields documented in the [OpenAPI file](https://quanticdata.io/docs/openapi.json). `test/api-contract.test.mjs` checks every call against `test/fixtures/openapi-subset.json`.
- Write JSON request bodies as templates (`={ "url": "{{ $json.url }}" }`), so the contract test can read the field names.
- Write Code nodes in "Run Once for All Items" mode with `$input.all()` and give them a test in `test/simulate.test.mjs` that runs them on a recorded response.
- Every workflow starts with a sticky note: what it does, setup steps, and a link to https://quanticdata.io/pricing/ (no prices in the repository).
- Examples target public sample sites (`quotes.toscrape.com`, `books.toscrape.com`, `example.com`) or search results. No workflow collects personal data by default.

## Fixtures

`test/fixtures/responses/` holds responses recorded from the live API, then trimmed: long text is cut, Google click tokens are replaced with `EXAMPLE_TOKEN_n`, and collector rows are replaced with fictional places (`.example` websites, 555 numbers). Keep it that way: no keys, no request ids, no personal data.

`test/fixtures/openapi-subset.json` is generated. To refresh it:

```bash
curl -sL https://quanticdata.io/docs/openapi.json -o openapi.json
npm run openapi
npm test
```

CI runs the same steps in an informational job and reports when the published document has changed.

## Adding a workflow

1. Build and run it in n8n, then export it (Download) with credentials removed.
2. Save it as `workflows/<task>.json`, add the node types it uses to `KNOWN_TYPES` in `test/structure.test.mjs` if needed, and add tests to `test/simulate.test.mjs`.
3. Document it in the README (inputs, outputs, cost note) and add a CHANGELOG entry under "Unreleased".
