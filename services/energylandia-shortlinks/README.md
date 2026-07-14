# Energylandia short links

This Worker turns the app's **anonymous compact-v2 itinerary** into a short,
clickable token. It is deliberately not a generic URL shortener or data store.

- `POST /plans` accepts only a size-capped, schema-validated compact-v2 plan.
- `GET /plans/:token` returns only the original compact payload.
- Tokens contain 96 bits of random data, are URL-safe, and never include `=`.
- The payload expires after 90 days.
- A singleton SQLite-backed Durable Object provides immediate read-after-write
  consistency across phones; Workers KV was intentionally not used.

The public frontend should turn a successful response into a link such as:

```text
https://jakiesluchawki.github.io/zabhop/planer-energylandia/#p/n8V6VhHE1I7Bu3O_
```

That shape has no `=` after `#p/`, so WhatsApp and Signal recognise it as a
normal clickable URL.

## API

### `POST /plans`

```json
{ "payload": "<compact-v2-base64url>" }
```

Successful response (`201`):

```json
{ "token": "n8V6VhHE1I7Bu3O_" }
```

### `GET /plans/:token`

Successful response (`200`):

```json
{ "payload": "<compact-v2-base64url>" }
```

There is intentionally no endpoint for listing, updating, deleting, or storing
arbitrary content. POST requires an `Origin` of
`https://jakiesluchawki.github.io` or a local development origin
(`localhost`, `127.0.0.1`, or `[::1]`). CORS does not grant access to any other
origin.

## Local verification

```bash
cd services/energylandia-shortlinks
npm install
npm test
npx wrangler dev
```

`wrangler dev` creates local Durable Object state only. It does not create a
remote Worker or any Cloudflare data resource.

## First production deployment

The `wrangler.jsonc` file includes a `new_sqlite_classes` migration. With an
authenticated Wrangler session, deployment creates the SQLite-backed Durable
Object binding and applies that migration; no separate KV namespace is needed.

```bash
cd services/energylandia-shortlinks
npm install
npx wrangler login
npx wrangler deploy
```

Use the returned `*.workers.dev` URL as the frontend build variable:

```bash
VITE_SHORTLINK_API=https://energylandia-shortlinks.<account>.workers.dev
```

Then build and publish the static planner. The Worker itself is intentionally
not deployed by this repository change.

## Keeping the validator aligned

The validator accepts only the compact-v2 IDs owned by the planner. When the
planner adds a new attraction, restaurant, or officially fetched show that can
be placed in a shared plan, add its ID to the corresponding allow-list in
`src/index.js` and deploy the Worker before enabling its short-link sharing.
