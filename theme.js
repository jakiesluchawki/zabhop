(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ZabHopTheme = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const THEMES = Object.freeze([
    Object.freeze({ id: "rose", name: "Różana Łąka", shortName: "RÓŻ" }),
    Object.freeze({ id: "sage", name: "Szałwiowy Las", shortName: "LAS" }),
    Object.freeze({ id: "blue", name: "Błękitny Poranek", shortName: "BŁĘKIT" }),
    Object.freeze({ id: "honey", name: "Miodowy Zachód", shortName: "MIÓD" })
  ]);

  function normalizeTheme(value) {
    return THEMES.some((theme) => theme.id === value) ? value : THEMES[0].id;
  }

  function themeById(value) {
    const normalized = normalizeTheme(value);
    return THEMES.find((theme) => theme.id === normalized);
  }

  function nextTheme(value) {
    const normalized = normalizeTheme(value);
    const index = THEMES.findIndex((theme) => theme.id === normalized);
    return THEMES[(index + 1) % THEMES.length];
  }

  return { THEMES, normalizeTheme, themeById, nextTheme };
});
