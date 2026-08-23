const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const heading = require("../heading-filter.js");
const hours = require("../store-hours.js");
const theme = require("../theme.js");

function appHarness(options = {}) {
  const elements = new Map();
  const documentListeners = new Map();
  const requests = [];
  const values = new Map();
  let document;

  class Element {
    constructor(name) {
      this.name = name;
      this.dataset = {};
      this.style = {};
      this.attributes = new Map();
      this.listeners = new Map();
      this.children = [];
      this.hidden = name === "#storeSheet";
      this.textContent = "";
      const classes = new Set();
      this.classList = {
        add: (value) => classes.add(value),
        remove: (value) => classes.delete(value),
        contains: (value) => classes.has(value),
        toggle: (value, enabled) => {
          const active = enabled ?? !classes.has(value);
          if (active) classes.add(value);
          else classes.delete(value);
          return active;
        }
      };
    }

    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) || null; }
    set src(value) { this.setAttribute("src", value); }
    get src() { return this.getAttribute("src"); }
    querySelector(selector) { return element(`${this.name} ${selector}`); }
    querySelectorAll() { return [element("#closeSheet"), ...element("#storeList").children]; }
    addEventListener(type, handler) { this.listeners.set(type, handler); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    focus() { document.activeElement = this; }
    click() { this.focus(); return this.listeners.get("click")?.({ preventDefault() {} }); }
  }

  function element(name) {
    if (!elements.has(name)) elements.set(name, new Element(name));
    return elements.get(name);
  }

  const modeButtons = ["zabka", "other"].map((mode) => {
    const button = element(`mode:${mode}`);
    button.dataset.storeMode = mode;
    return button;
  });
  const availabilityButtons = ["open", "all"].map((availability) => {
    const button = element(`availability:${availability}`);
    button.dataset.availability = availability;
    return button;
  });
  const artwork = ["./felt-compass-optimized.jpg", "./felt-arrow-optimized.png"].map((src, index) => {
    const image = element(`artwork:${index}`);
    image.dataset.radarSrc = src;
    return image;
  });

  document = {
    visibilityState: "visible",
    activeElement: null,
    body: { style: {} },
    documentElement: { dataset: {} },
    querySelector: element,
    querySelectorAll(selector) {
      if (selector === "[data-store-mode]") return modeButtons;
      if (selector === "[data-availability]") return availabilityButtons;
      if (selector === "[data-radar-src]") return artwork;
      return [];
    },
    createElement: (name) => new Element(name),
    addEventListener(type, handler) { documentListeners.set(type, handler); }
  };

  const navigator = {
    standalone: false,
    geolocation: options.position ? {
      watchPosition(onSuccess) {
        onSuccess({ coords: {
          latitude: options.position.lat,
          longitude: options.position.lon,
          accuracy: 5
        } });
        return 1;
      },
      clearWatch() {}
    } : undefined
  };

  const localStorage = {
    getItem(key) { return values.get(key) || null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };

  const window = {
    ZabHopHeading: heading,
    ZabHopStoreHours: hours,
    ZabHopTheme: theme,
    ZabHopCatalogSync: {
      createCatalogManager() {
        return {
          async load(mode) { return options.catalogs?.[mode] || []; },
          async refresh() { return false; }
        };
      }
    },
    location: { search: options.search || "", hostname: options.hostname || "localhost" },
    navigator,
    addEventListener() {},
    matchMedia: () => ({ matches: false }),
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    requestAnimationFrame: (callback) => { callback(); return 1; }
  };

  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8"), {
    window,
    document,
    navigator,
    localStorage,
    URLSearchParams,
    AbortController,
    performance,
    fetch: async (url) => {
      requests.push(String(url));
      throw new Error("unexpected external search");
    }
  });

  return { element, artwork, requests, document, documentListeners };
}

test("demo radar renders walking estimates, lazy artwork, and an accessible store picker", () => {
  const app = appHarness({ search: "?demo=1&mode=other&availability=all" });
  assert.match(app.element("#walkingEta").textContent, /min pieszo/);
  assert.equal(app.artwork[0].src, "./felt-compass-optimized.jpg");
  assert.equal(app.artwork[1].src, "./felt-arrow-optimized.png");
  assert.equal(app.element("#storeList").children.length, 5);

  const openPicker = app.element("#storesButton");
  openPicker.click();
  assert.equal(app.element("#storeSheet").hidden, false);
  assert.equal(app.document.activeElement, app.element("#closeSheet"));
  app.documentListeners.get("keydown")({ key: "Escape", preventDefault() {} });
  assert.equal(app.element("#storeSheet").hidden, true);
  assert.equal(app.document.activeElement, openPicker);
});

test("does not send location to fallback providers when the local catalog only contains closed shops", async () => {
  const app = appHarness({
    search: "?mode=other&availability=open",
    position: { lat: 52.200123456, lon: 21.029987654 },
    catalogs: {
      other: [{
        id: "closed-nearby",
        name: "Biedronka",
        lat: 52.2002,
        lon: 21.03,
        hours: Array(7).fill("")
      }]
    }
  });
  app.element("#startButton").click();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(app.requests, []);
  assert.match(app.element("#errorTitle").textContent, /otwartego sklepu/);
});

test("rounds emergency Photon and Overpass location searches to three decimals", async () => {
  const app = appHarness({
    search: "?mode=other&availability=open",
    position: { lat: 52.200123456, lon: 21.029987654 },
    catalogs: {
      other: [{ id: "far-away", name: "Lidl", lat: 50.01, lon: 19.94, hours: Array(7).fill("0-1440") }]
    }
  });
  app.element("#startButton").click();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(app.requests.some((url) => url.includes("photon.komoot.io")));
  assert.ok(app.requests.some((url) => url.includes("overpass")));
  for (const rawUrl of app.requests) {
    const url = decodeURIComponent(rawUrl);
    assert.doesNotMatch(url, /52\.200123456|21\.029987654/);
    assert.match(url, /52\.200/);
    assert.match(url, /21\.030/);
  }
});
