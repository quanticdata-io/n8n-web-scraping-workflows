# n8n web scraping workflows

Six importable [n8n](https://n8n.io/) workflows for web data tasks: URLs to Markdown files, a daily Google rank check with alerts, Google Maps places to CSV, a page change alert, a site-to-RAG chunk exporter, and a chat agent that researches the web through the QuanticData MCP server.

[![CI](https://github.com/quanticdata-io/n8n-web-scraping-workflows/actions/workflows/ci.yml/badge.svg)](https://github.com/quanticdata-io/n8n-web-scraping-workflows/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

The workflows use n8n core nodes only (HTTP Request, Code, If, Wait, Convert to File, and the AI Agent and MCP Client Tool nodes for the agent). They call the [QuanticData API](https://quanticdata.io/docs/) with a Header Auth credential, so no community node is needed.

| Workflow | File | QuanticData endpoint | Output |
| --- | --- | --- | --- |
| [URLs to Markdown files](#urls-to-markdown-files) | `urls-to-markdown.json` | `POST /scraper/extract` | One `.md` file per URL |
| [Daily Google rank check](#daily-google-rank-check) | `serp-rank-check.json` | `POST /scraper/serp` | CSV per run, webhook alert on change |
| [Google Maps places to CSV](#google-maps-places-to-csv) | `google-maps-places-to-csv.json` | `POST /scraper/collectors/google_maps_places/run`, `GET /scraper/collectors/runs/{runId}` | CSV of places |
| [Page change alert](#page-change-alert) | `page-change-alert.json` | `POST /scraper/extract` | Webhook alert on change |
| [Site to RAG chunks](#site-to-rag-chunks) | `site-to-rag-chunks.json` | `POST /scraper/map`, `POST /scraper/batch`, `GET /scraper/batch/{jobId}` | `chunks.jsonl` |
| [Web research agent](#web-research-agent) | `mcp-research-agent.json` | MCP server `https://api.quanticdata.io/mcp` | Chat answers with source URLs |

## Import

1. Download a file from [`workflows/`](workflows/) (or clone the repository).
2. In n8n: **Workflows > Create > ... > Import from File** (or paste the JSON on the canvas).
3. Create the credential once: **Credentials > New > Header Auth**
   - Name: `QuanticData API`
   - Header name: `Authorization`
   - Value: `Bearer qd_live_your_key` (create the key on the API keys page of the [QuanticData dashboard](https://app.quanticdata.io/))
4. Open each HTTP Request node that calls `api.quanticdata.io` and select that credential. The agent workflow uses the same kind of credential on its MCP Client Tool node.
5. Edit the **Settings** or input node, then run.

Tested against the node versions listed in [`test/structure.test.mjs`](test/structure.test.mjs) (HTTP Request 4.2, Code 2, If 2.2, Set 3.4, AI Agent 2.2, MCP Client Tool 1.2). The MCP Client Tool node needs an n8n release that ships it; the other workflows import into any recent n8n 1.x.

## Cost

Every QuanticData call is billed to your account: per successful page for scrape and batch, per search for SERP, per call for map, per delivered place for the collector. The [API reference](https://quanticdata.io/docs/) documents what is not charged (for example blocked pages, blocked searches and failed collector runs). See [pricing](https://quanticdata.io/pricing/) for the current rates. Start with the small defaults in each workflow.

## URLs to Markdown files

Scrapes each URL to Markdown with YAML front matter and returns one binary `.md` file per page.

`Start` > `URLs to convert` > `One item per URL` > `Scrape to Markdown` > `Name the file` > `Markdown file`

| Input (node `URLs to convert`) | Meaning |
| --- | --- |
| `urls` | Array of `http(s)` URLs. Default: two pages of public sample sites |

Request sent for each URL (one per second, set in the node's Batching option):

```json
{ "url": "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html", "format": "markdown", "contentMode": "smart", "frontmatter": true }
```

Response fields used, from a real call (trimmed):

```json
{
  "type": "response",
  "message": "Extraction successful",
  "payload": {
    "url": "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html",
    "finalUrl": "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html",
    "status": 200,
    "format": "markdown",
    "title": "A Light in the Attic | Books to Scrape - Sandbox",
    "content": "# A Light in the Attic\n\n£51.77\n\nIn stock (22 available)\n...",
    "engine": "tls"
  }
}
```

Output items: `url`, `title`, `status`, `fileName` (built from host and path), `markdown`, plus the binary file. To keep the files, add a storage node after `Markdown file` (Read/Write Files from Disk on self-hosted n8n, or a cloud drive node).

## Daily Google rank check

Every day at 07:00, searches Google for each keyword from a fixed location, finds the first organic result from your domain, records whether an AI Overview and People Also Ask are shown, compares with the previous run and posts a message to a webhook when a rank changes. Every run also produces a CSV.

`Every day at 07:00` > `Settings` > `One item per keyword` > `Google search` > `Find the domain rank` > `Rank changed?` > `Send alert`, and `Rank report CSV`

| Input (node `Settings`) | Meaning |
| --- | --- |
| `domain` | Registrable domain to look for, e.g. `wikipedia.org`. Subdomains match (`en.wikipedia.org`) |
| `keywords` | Array of search queries |
| `country`, `lang` | Google country and interface language (`us`, `en`) |
| `location` | Place to search from, e.g. `New York, New York, United States`. Keep it fixed: Google ranks by location |
| `depth` | How many organic results to request (`num`, 1 to 100). A domain below that depth is reported as not ranked |
| `alertWebhookUrl` | URL that receives `{"text": "..."}` by POST when a rank changes (Slack incoming webhooks accept this body). Empty: no alerts |

CSV and output columns: `keyword`, `domain`, `rank` (null when not found), `previous_rank`, `changed`, `url`, `results_seen`, `ai_overview`, `people_also_ask`, `checked_at`, `message`.

Notes:

- Google can return its own click address (`https://www.google.com/url?...`) in `link` instead of the site's URL. The workflow therefore matches the domain on `source`, then on the `link` host, then on the host at the start of `display_link`. When only a click address is available, the `url` column holds that address.
- The previous ranks live in the workflow's static data. n8n saves static data only for active (production) executions, so activate the workflow; manual test runs always look like a first run.
- The first run records a baseline and sends no alert.

## Google Maps places to CSV

Runs the `google_maps_places` collector for a keyword and a location and returns a CSV of the places. When the API queues the run (HTTP 202), the workflow waits 10 seconds and polls the run until it is `done` or `failed`.

`Start` > `Search` > `Run collector` > `Run finished?` > `Places` > `Places CSV` (and `Wait 10 s` > `Poll run` back to `Run finished?`)

| Input (node `Search`) | Meaning |
| --- | --- |
| `query` | Business type or keyword, e.g. `public library` |
| `location` | City, area or address, e.g. `Brooklyn, NY` |
| `country` | Two-letter country code |
| `max_results` | Places to deliver, 1 to 300 (the collector's documented cap) |

The collector also accepts `lang` and `enrich_details`; add them to the `input` object of the `Run collector` body if you need them. The live input schema is at `GET /scraper/collectors/google_maps_places`.

A finished run, from a real call (rows replaced with fictional values):

```json
{
  "type": "response",
  "message": "Collector run complete",
  "payload": {
    "run_id": "run_example_0001",
    "slug": "google_maps_places",
    "status": "done",
    "count": 2,
    "partial": false,
    "error": null,
    "results": [
      { "rank": 1, "name": "Example Library 1", "category": "Public library", "address": "1 Example Plaza, Springfield", "phone": "(555) 010-0001", "website": "library1.example", "rating": 4.5, "reviews": null, "latitude": 40.68, "longitude": -73.96, "maps_url": "https://www.google.com/maps/search/?api=1&query=Example%20Library%201", "place_id": "0x0000000000000000:0x0000000000000001" }
    ]
  }
}
```

CSV columns: `rank`, `name`, `category`, `address`, `phone`, `website`, `rating`, `reviews`, `latitude`, `longitude`, `maps_url`, `place_id`. A failed run stops the workflow with the run's `error`.

## Page change alert

Every 6 hours, scrapes each page to Markdown with links and images stripped, hashes the text, compares it with the previous run and posts a message to a webhook when a page changed.

`Every 6 hours` > `Settings` > `One item per page` > `Scrape page` > `Compare with last run` > `Changed?` > `Send alert`

| Input (node `Settings`) | Meaning |
| --- | --- |
| `pages` | Array of `{ "name": "...", "url": "..." }` |
| `alertWebhookUrl` | URL that receives `{"text": "Changed: <name> <url>"}` by POST. Empty: no alerts |

Output items: `name`, `url`, `status`, `hash`, `previous_hash`, `changed`, `message`.

Notes:

- A hash says that the text changed, not what changed. For a price or stock field, use the `extract` option of the scrape endpoint (CSS selectors) in the `Scrape page` body and compare `payload.data` instead of `payload.content`.
- Pages with rotating content (dates, counters, recommendations) change on every run. Narrow the content with the documented `parser.include` / `parser.exclude` selectors in the request body.
- Like the rank check, the hashes live in static data: activate the workflow. The first run records a baseline.

## Site to RAG chunks

Discovers a site's URLs with the map endpoint (robots.txt sitemaps, `/sitemap.xml` and homepage links), scrapes them in one batch job, splits each page's Markdown at its headings, cuts long sections, and returns `chunks.jsonl` with one chunk per line.

`Start` > `Settings` > `Map site` > `URLs to scrape` > `Start batch` > `Wait 15 s` > `Poll batch` > `Batch finished?` > `Chunk for RAG` > `chunks.jsonl`

| Input (node `Settings`) | Meaning |
| --- | --- |
| `site` | Seed URL |
| `search` | Only URLs containing this substring (e.g. `/docs/`). Empty: every discovered URL |
| `limit` | Maximum URLs to scrape (the map endpoint caps it at 5000, the batch endpoint at 5000 URLs) |
| `maxChunkChars` | Maximum characters per chunk |

Each JSONL line: `{"url", "title", "heading", "chunk", "text"}`. The last item also reports `chunks`, `pages`, `failed` and `more_items_withheld`.

Map response from a real call (trimmed):

```json
{
  "type": "response",
  "message": "Map successful",
  "payload": {
    "url": "https://quotes.toscrape.com/",
    "links": ["https://quotes.toscrape.com/author/Albert-Einstein", "https://quotes.toscrape.com/author/Jane-Austen"],
    "count": 2,
    "total": 47,
    "summary": { "/tag": 36, "/author": 8, "/": 1, "/login": 1, "/page": 1 },
    "sources": { "sitemap": 0, "homepage": 47 }
  }
}
```

Notes:

- The map endpoint lists URLs; it does not tell you whether the site allows them to be collected. Check the site's `robots.txt` and terms before the batch step, and keep `limit` low.
- One poll returns the finished items up to the API's response budget. When `more_items_withheld` is `true`, lower `limit` or extend the poll with the documented `since` cursor (`payload.nextCursor`).
- Batch jobs are kept about an hour after they finish.
- Chunks are split by characters, not tokens. For token-based chunks, the scrape endpoint has a documented `chunk` option per page.

## Web research agent

A chat workflow: the AI Agent node answers questions from the live web with the `search`, `scrape` and `map` tools of the hosted QuanticData MCP server, connected through n8n's MCP Client Tool node (Streamable HTTP, `https://api.quanticdata.io/mcp`).

`When chat message received` > `Research agent` (with `Chat model` and `QuanticData MCP`)

| Setting | Meaning |
| --- | --- |
| `QuanticData MCP` credential | Header Auth, `Authorization: Bearer qd_live_your_key` |
| `QuanticData MCP` > Tools to include | `search`, `scrape`, `map`. The server has more tools (crawl, batch, collectors...); add them only if the agent needs them, each call is billed |
| `Chat model` | OpenAI chat model node with `gpt-4.1-mini`; replace it with any chat model node and its credential |
| `Research agent` > System message | Limits the agent to three scraped pages per question and asks it to list its sources |

The MCP server is documented at [quanticdata.io/mcp-server](https://quanticdata.io/mcp-server/).

## Run the tests

```bash
npm test     # Node 20 or later, no dependencies
```

The tests never call the QuanticData API or any website:

- `test/structure.test.mjs`: every file is a valid workflow; nodes, ids and connections are consistent; known node types and versions; no credentials, pinned data, instance ids or keys.
- `test/api-contract.test.mjs`: every QuanticData URL is a documented endpoint, and every body field and query parameter is documented, checked against `test/fixtures/openapi-subset.json` (generated from the [OpenAPI file](https://quanticdata.io/docs/openapi.json) by `scripts/extract-openapi.mjs`). The collector input is checked against the collector's input schema.
- `test/simulate.test.mjs`: evaluates the request templates, If conditions and Code nodes against responses recorded from the live API on 2026-11-18 (trimmed and sanitised), including the polling branches and the rank and change detection.

The simulation is a small stand-in for the n8n expression and Code node runtime, not n8n itself. To run a workflow against the real API, import it into n8n and set your key in the Header Auth credential as described above.

## Limits

- The workflows were checked offline against recorded responses and the n8n node definitions; run each one once in your n8n version before you rely on it.
- Change and rank history are kept in workflow static data, which is per workflow and saved only for active executions. For long histories, write the rows to a database or a sheet node.
- No retries beyond the HTTP Request node's own "Retry on fail" (3 tries, 5 s apart). HTTP 402 means the balance cannot cover the call; 429 means a rate limit (see the [API reference](https://quanticdata.io/docs/)).

## Responsible use

- Collect public data only, at a modest rate, and respect each site's terms and `robots.txt`. The defaults point at public sample sites built for scraping practice.
- The Google Maps workflow returns public business listings. If you use them to contact businesses, data protection law (for example the GDPR) and anti-spam rules apply to you.
- Do not use the workflows to collect personal data about individuals.

## License

[MIT](LICENSE)
