const test = require("node:test");
const assert = require("node:assert/strict");

const { THEMES, normalizeTheme, themeById, nextTheme } = require("../theme.js");

test("exposes the four product themes in the intended order", () => {
  assert.deepEqual(
    THEMES.map(({ id, name }) => ({ id, name })),
    [
      { id: "rose", name: "Różana Łąka" },
      { id: "sage", name: "Szałwiowy Las" },
      { id: "blue", name: "Błękitny Poranek" },
      { id: "honey", name: "Miodowy Zachód" }
    ]
  );
});

test("uses Różana Łąka for missing or invalid saved values", () => {
  assert.equal(normalizeTheme(null), "rose");
  assert.equal(normalizeTheme("unknown"), "rose");
  assert.equal(themeById("unknown").name, "Różana Łąka");
});

test("cycles through every theme and wraps to the default", () => {
  assert.equal(nextTheme("rose").id, "sage");
  assert.equal(nextTheme("sage").id, "blue");
  assert.equal(nextTheme("blue").id, "honey");
  assert.equal(nextTheme("honey").id, "rose");
});
