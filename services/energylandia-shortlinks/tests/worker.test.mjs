import assert from "node:assert/strict";
import test from "node:test";

import { handleRequest, validateCompactV2Payload } from "../src/index.js";

function compactPayload(snapshot) {
  return Buffer.from(JSON.stringify(snapshot), "utf8").toString("base64url");
}

function validSnapshot() {
  return {
    v: 2,
    p: [20260716, 600, 900, "n", "n", "m", 4, "w", 30, "f", 855, 1, [[0, 18, 170], [1, 6, 120]]],
    t: [29733533, 0],
    d: [[
      ["r", "anaconda", 600, 660, 0, -1],
      ["m", "formula-pizza", 660, 700, 3],
      ["h", "piraci-z-zatoki-67", "Piraci z Zatoki 67!", "Teatr Colosseo", "54", 700, 720, 15, [720, 825], 29733533, 5],
      ["f", 735, 900, 0, ["atlantis"]],
    ]],
  };
}

function fakeEnvironment() {
  const records = new Map();
  const token = "n8V6VhHE1I7Bu3O_";
  const stub = {
    async createPlan(payload) {
      records.set(token, payload);
      return { token };
    },
    async getPlan(requestedToken) {
      return records.get(requestedToken) ?? null;
    },
  };
  return {
    PLAN_STORE: {
      idFromName(name) {
        assert.equal(name, "energylandia-short-plans-v1");
        return name;
      },
      get() {
        return stub;
      },
    },
  };
}

test("accepts the compact v2 contract and rejects non-plan data", () => {
  assert.equal(validateCompactV2Payload(compactPayload(validSnapshot())), true);
  assert.equal(validateCompactV2Payload(Buffer.from(JSON.stringify({ v: 2, arbitrary: "storage" })).toString("base64url")), false);
  assert.equal(validateCompactV2Payload("not=base64url"), false);
});

test("rejects a compact plan that refers to an unknown attraction", () => {
  const snapshot = validSnapshot();
  snapshot.d[0][0][1] = "not-an-energylandia-ride";
  assert.equal(validateCompactV2Payload(compactPayload(snapshot)), false);
});

test("POST creates a URL-safe token and GET returns the same payload", async () => {
  const env = fakeEnvironment();
  const payload = compactPayload(validSnapshot());
  const post = await handleRequest(new Request("https://short.example/plans", {
    method: "POST",
    headers: {
      Origin: "https://jakiesluchawki.github.io",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ payload }),
  }), env);
  assert.equal(post.status, 201);
  assert.equal(post.headers.get("Access-Control-Allow-Origin"), "https://jakiesluchawki.github.io");
  const created = await post.json();
  assert.match(created.token, /^[A-Za-z0-9_-]{16}$/);
  assert.equal(created.token.includes("="), false);

  const get = await handleRequest(new Request(`https://short.example/plans/${created.token}`, {
    headers: { Origin: "https://jakiesluchawki.github.io" },
  }), env);
  assert.equal(get.status, 200);
  assert.deepEqual(await get.json(), { payload });
});

test("requires an allowed browser origin before creating plans", async () => {
  const env = fakeEnvironment();
  const response = await handleRequest(new Request("https://short.example/plans", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://not-the-app.example" },
    body: JSON.stringify({ payload: compactPayload(validSnapshot()) }),
  }), env);
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
});

test("allows only the production and local-development CORS origins", async () => {
  const env = fakeEnvironment();
  const allowed = await handleRequest(new Request("https://short.example/plans", {
    method: "OPTIONS",
    headers: { Origin: "http://localhost:5173" },
  }), env);
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("Access-Control-Allow-Origin"), "http://localhost:5173");

  const blocked = await handleRequest(new Request("https://short.example/plans", {
    method: "OPTIONS",
    headers: { Origin: "https://jakiesluchawki.github.io.evil.example" },
  }), env);
  assert.equal(blocked.status, 403);
});

test("GET uses a fixed token route and does not expose a listing endpoint", async () => {
  const env = fakeEnvironment();
  const listing = await handleRequest(new Request("https://short.example/plans"), env);
  assert.equal(listing.status, 404);

  const invalidToken = await handleRequest(new Request("https://short.example/plans/short"), env);
  assert.equal(invalidToken.status, 404);
});
