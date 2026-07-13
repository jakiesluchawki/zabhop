import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/ParkView.jsx", import.meta.url), "utf8");

test("każdy wiersz trasy dostaje dystans GPS i czas marszu", () => {
  assert.match(source, /const liveDistance = livePosition \? distanceMeters\(livePosition, locationOf\(stop\)\) : null;/);
  assert.match(source, /const walkLabel = distanceLabel \? `~\$\{walkingMinutes\(liveDistance\)\} min` : null;/);
  assert.match(source, /className={`route-distance \$\{distanceLabel \? "live" : ""\}`}/);
  assert.match(source, /primaryRoute\.map\(\(stop, index\) => renderRouteRow\(stop, index\)\)/);
  assert.match(source, /secondaryRoute\.map\(\(stop, index\) => renderRouteRow\(stop, primaryRoute\.length \+ index\)\)/);
});

test("rekomendację można zmienić i przeliczyć bez kasowania historii", () => {
  assert.match(source, /rankNextStops\(/);
  assert.match(source, /Pokaż inną/);
  assert.match(source, /Przelicz teraz/);
  assert.match(source, /setDismissedSuggestionIds\(\[\]\)/);
});

test("automatyczny GPS uruchamia się tylko przy istniejącej zgodzie", () => {
  assert.match(source, /navigator\.permissions\.query\(\{ name: "geolocation" \}\)/);
  const grantedBranch = source.match(/if \(permission\.state === "granted"\) \{([\s\S]*?)\n\s*\}/)?.[1] ?? "";
  assert.match(grantedBranch, /watchRef\.current == null/);
  assert.match(grantedBranch, /locate\(\)/);
  assert.match(source, /czekamy na[\s\S]*świadome kliknięcie użytkownika/);
});

test("stan lokalizacji jest ogłaszany, a numer w szczegółach nie jest zdublowany", () => {
  assert.match(source, /role="status" aria-live="polite"/);
  assert.match(source, /locationStatus === "denied"/);
  assert.match(source, /locationStatus === "unsupported"/);

  const sheetSource = source.slice(
    source.indexOf("function MapNavigationSheet"),
    source.indexOf("export function ParkView"),
  );
  assert.equal((sheetSource.match(/className="navigation-destination-number"/g) ?? []).length, 1);
});
