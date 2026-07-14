// Node does not implement Cloudflare's `cloudflare:workers` module. The
// production module dynamically imports it; this flag substitutes a harmless
// base class so the pure HTTP/schema tests can run in Node.
globalThis.__ENERGYLANDIA_SHORTLINK_NODE_TEST__ = true;
