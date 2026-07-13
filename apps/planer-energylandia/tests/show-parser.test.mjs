import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  decodeHtml,
  parseShowDetail,
  parseShowIndex,
  showParserInternals,
  textFromHtml,
} from "../scripts/show-parser.mjs";

const fixtureDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name) => readFile(resolve(fixtureDirectory, name), "utf8");

test("parseShowIndex reads only official show cards from the index section", async () => {
  const shows = parseShowIndex(await fixture("show-index.html"));
  assert.deepEqual(shows, [
    {
      title: "Funny In Sweet Valley Show",
      url: "https://energylandia.pl/show/funny-in-sweet-valley-show/",
      imageUrl: "https://energylandia.pl/wp-content/uploads/funny.jpg",
    },
    {
      title: "Załoga Na Pokład!",
      url: "https://energylandia.pl/show/zaloga-na-poklad/",
      imageUrl: "https://energylandia.pl/wp-content/uploads/crew.jpg",
    },
  ]);
});

test("parseShowDetail returns useful official copy, venue, duration and dated times", async () => {
  const show = parseShowDetail(await fixture("show-detail.html"), {
    url: "https://energylandia.pl/show/funny-in-sweet-valley-show/",
    referenceDate: "2026-07-13T18:00:00.000Z",
  });
  assert.equal(show.id, "funny-in-sweet-valley-show");
  assert.equal(show.title, "Funny In Sweet Valley Show");
  assert.match(show.description, /charyzmatycznego bohatera/);
  assert.equal(show.durationMinutes, 15);
  assert.equal(show.durationLabel, "15 min");
  assert.equal(show.venue, "Town Hall Theatre");
  assert.equal(show.mapUrl, "https://energylandia.pl/mapa-parku/?location=238");
  assert.equal(show.imageUrl, "https://energylandia.pl/wp-content/uploads/2026/04/funny_in_sv.jpg");
  assert.equal(show.officialModifiedAt, "2026-07-08T16:48:42.000Z");
  assert.equal(show.completeForScheduling, true);
  assert.deepEqual(show.schedule, [
    { date: "2026-07-14", label: "Jutro , 14 lipca", times: ["12:00", "14:30", "16:15"] },
    { date: "2026-07-15", label: "środa, 15 lipca", times: ["12:00", "18:15"] },
  ]);
});

test("date parser handles Polish year rollover", () => {
  assert.equal(showParserInternals.toIsoDate("czwartek, 2 stycznia", "2026-12-30T12:00:00Z"), "2027-01-02");
  assert.equal(showParserInternals.toIsoDate("wtorek, 30 grudnia", "2026-01-02T12:00:00Z"), "2025-12-30");
});

test("HTML text helpers decode entities and normalize markup", () => {
  assert.equal(decodeHtml("Załoga &amp; Piraci &#33;"), "Załoga & Piraci !");
  assert.equal(textFromHtml("<p>Dużo&nbsp; śmiechu<br>dla wszystkich</p>"), "Dużo śmiechu dla wszystkich");
});

test("detail parser refuses non-official URLs", async () => {
  assert.throws(
    () => parseShowDetail("<h1>Fałszywy pokaz</h1>", { url: "https://example.com/show/fake/" }),
    /official Energylandia show URL/,
  );
});
