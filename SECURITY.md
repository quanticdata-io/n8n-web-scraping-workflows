# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Email **hello@quanticdata.io** with the subject "Security: n8n-web-scraping-workflows" and include a description, steps to reproduce and the workflow concerned. We acknowledge reports within 3 business days and keep you informed until a fix is released.

## API keys

The workflows contain no credentials. They expect an n8n **Header Auth** credential (`Authorization: Bearer <key>`) that you create in your own n8n instance, where n8n stores it encrypted. Before sharing an exported workflow, check that it contains no key: n8n exports credential names and ids, not their values, but keys pasted into a Set or Code node are exported as plain text. If a key leaks, rotate it on the API keys page of the QuanticData dashboard.
