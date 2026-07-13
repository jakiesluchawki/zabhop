const OFFICIAL_ORIGIN = "https://energylandia.pl";

const MONTHS = new Map([
  ["stycznia", 1],
  ["lutego", 2],
  ["marca", 3],
  ["kwietnia", 4],
  ["maja", 5],
  ["czerwca", 6],
  ["lipca", 7],
  ["sierpnia", 8],
  ["września", 9],
  ["wrzesnia", 9],
  ["października", 10],
  ["pazdziernika", 10],
  ["listopada", 11],
  ["grudnia", 12],
]);

export function decodeHtml(value = "") {
  const named = {
    amp: "&",
    apos: "'",
    bdquo: "„",
    bull: "•",
    gt: ">",
    hellip: "…",
    laquo: "«",
    ldquo: "“",
    lt: "<",
    nbsp: " ",
    ndash: "–",
    mdash: "—",
    quot: '"',
    raquo: "»",
    rdquo: "”",
    rsquo: "’",
  };

  return String(value)
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, raw) => {
      const codePoint = raw[0].toLowerCase() === "x"
        ? Number.parseInt(raw.slice(1), 16)
        : Number.parseInt(raw, 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _;
    })
    .replace(/&([a-z]+);/gi, (entity, name) => named[name.toLowerCase()] ?? entity);
}

export function textFromHtml(value = "") {
  return decodeHtml(
    String(value)
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?\s*>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function officialUrl(raw, base = OFFICIAL_ORIGIN) {
  if (!raw) return null;
  try {
    const url = new URL(decodeHtml(raw), base);
    return url.protocol === "https:" && url.hostname === "energylandia.pl" ? url.href : null;
  } catch {
    return null;
  }
}

function firstMatch(html, pattern) {
  return html.match(pattern)?.[1] ?? "";
}

function extractArticleCards(html) {
  const section = firstMatch(
    html,
    /<section\b[^>]*\bid=["']while["'][^>]*>([\s\S]*?)<\/section>/i,
  ) || html;
  return [...section.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)].map((match) => match[0]);
}

export function parseShowIndex(html, baseUrl = `${OFFICIAL_ORIGIN}/show/`) {
  const seen = new Set();
  const shows = [];

  for (const card of extractArticleCards(html)) {
    const url = officialUrl(
      firstMatch(card, /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/i),
      baseUrl,
    );
    if (!url || !url.startsWith(`${OFFICIAL_ORIGIN}/show/`) || url === `${OFFICIAL_ORIGIN}/show/` || seen.has(url)) {
      continue;
    }

    const title = textFromHtml(firstMatch(
      card,
      /<h[1-6]\b[^>]*\bclass=["'][^"']*\bplm-card-title\b[^"']*["'][^>]*>([\s\S]*?)<\/h[1-6]>/i,
    ));
    if (!title) continue;

    const imageUrl = officialUrl(
      firstMatch(card, /<img\b[^>]*\bdata-src=["']([^"']+)["'][^>]*\bwp-post-image\b[^>]*>/i)
        || firstMatch(card, /<img\b[^>]*\bclass=["'][^"']*\bwp-post-image\b[^"']*["'][^>]*\bdata-src=["']([^"']+)["']/i)
        || firstMatch(card, /<img\b[^>]*\bdata-src=["']([^"']+)["']/i),
      baseUrl,
    );

    seen.add(url);
    shows.push({ title, url, imageUrl });
  }

  return shows;
}

function dateParts(referenceDate) {
  const date = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  if (Number.isNaN(date.valueOf())) throw new TypeError("referenceDate must be a valid date");
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const part = (type) => Number(parts.find((entry) => entry.type === type)?.value);
  return { year: part("year"), month: part("month"), day: part("day") };
}

function toIsoDate(label, referenceDate) {
  const normalized = textFromHtml(label).toLocaleLowerCase("pl-PL");
  const match = normalized.match(/\b(\d{1,2})\s+([a-ząćęłńóśźż]+)\b/iu);
  if (!match) return null;
  const day = Number(match[1]);
  const month = MONTHS.get(match[2].normalize("NFC"));
  if (!month || day < 1 || day > 31) return null;

  const reference = dateParts(referenceDate);
  let year = reference.year;
  const candidate = Date.UTC(year, month - 1, day);
  const referenceUtc = Date.UTC(reference.year, reference.month - 1, reference.day);
  const differenceDays = Math.round((candidate - referenceUtc) / 86_400_000);
  if (differenceDays < -180) year += 1;
  if (differenceDays > 180) year -= 1;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseSchedule(html, referenceDate) {
  const section = firstMatch(
    html,
    /<section\b[^>]*\bid=["']terminarzshow["'][^>]*>([\s\S]*?)<\/section>/i,
  );
  if (!section) return [];

  const rows = [];
  for (const row of section.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1]);
    if (cells.length < 2) continue;
    const label = textFromHtml(cells[0]);
    const date = toIsoDate(label, referenceDate);
    const times = [...new Set(cells[1].match(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g) ?? [])];
    if (!date || !times.length) continue;
    rows.push({ date, label, times });
  }
  return rows;
}

function parseInfoValue(html, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return textFromHtml(firstMatch(
    html,
    new RegExp(
      `<span\\b[^>]*\\bclass=["'][^"']*\\bplm-icon-title\\b[^"']*["'][^>]*>\\s*${escaped}\\s*<\\/span>\\s*<span\\b[^>]*\\bclass=["'][^"']*\\bplm-icon-desc\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/span>`,
      "i",
    ),
  ));
}

function primaryImage(html, pageUrl) {
  const schemaBlock = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .find((json) => json.includes("primaryImageOfPage"));
  if (schemaBlock) {
    try {
      const graph = JSON.parse(schemaBlock)["@graph"] ?? [];
      const page = graph.find((item) => item?.["@type"] === "WebPage");
      const imageRef = page?.primaryImageOfPage?.["@id"];
      const image = graph.find((item) => item?.["@id"] === imageRef);
      const url = officialUrl(image?.contentUrl || image?.url, pageUrl);
      if (url?.includes("/wp-content/uploads/")) return url;
    } catch {
      // Fall back to the visible primary image below.
    }
  }

  const src = firstMatch(
    html,
    /<img\b[^>]*\bclass=["'][^"']*\bimg-fluid\b[^"']*\bwp-post-image\b[^"']*["'][^>]*\bdata-src=["']([^"']+)["']/i,
  ) || firstMatch(
    html,
    /<img\b[^>]*\bdata-src=["']([^"']+)["'][^>]*\bclass=["'][^"']*\bimg-fluid\b[^"']*\bwp-post-image\b/i,
  );
  const url = officialUrl(src, pageUrl);
  return url?.includes("/wp-content/uploads/") ? url : null;
}

function modifiedAt(html) {
  const raw = firstMatch(html, /["']dateModified["']\s*:\s*["']([^"']+)["']/i);
  return raw && !Number.isNaN(Date.parse(raw)) ? new Date(raw).toISOString() : null;
}

export function showIdFromUrl(url) {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? null;
  } catch {
    return null;
  }
}

export function parseShowDetail(html, { url, referenceDate = new Date(), fallbackImageUrl = null } = {}) {
  const pageUrl = officialUrl(url);
  if (!pageUrl || !pageUrl.startsWith(`${OFFICIAL_ORIGIN}/show/`)) {
    throw new TypeError("A valid official Energylandia show URL is required");
  }

  const title = textFromHtml(
    firstMatch(html, /<section\b[^>]*\bid=["']breadcrumbs["'][^>]*>[\s\S]*?<h1\b[^>]*>([\s\S]*?)<\/h1>/i)
      || firstMatch(html, /<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i).replace(/\s+-\s+ENERGYLANDIA[\s\S]*$/i, ""),
  );
  const description = textFromHtml(firstMatch(
    html,
    /<section\b[^>]*\bid=["']desc["'][^>]*>([\s\S]*?)<\/section>/i,
  ));
  const durationLabel = parseInfoValue(html, "Czas Trwania");
  const durationMinutes = Number(durationLabel.match(/\b(\d{1,3})\b/)?.[1]) || null;
  const venue = parseInfoValue(html, "Lokalizacja");
  const infoSection = firstMatch(
    html,
    /<section\b[^>]*\bid=["']infoicons["'][^>]*>([\s\S]*?)<\/section>/i,
  );
  const mapUrl = officialUrl(
    firstMatch(infoSection, /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>\s*Zobacz na mapie/i),
    pageUrl,
  );
  const imageUrl = primaryImage(html, pageUrl) || officialUrl(fallbackImageUrl, pageUrl);
  const schedule = parseSchedule(html, referenceDate);
  const completeForScheduling = Boolean(title && description && durationMinutes && venue && schedule.length);

  return {
    id: showIdFromUrl(pageUrl),
    title,
    url: pageUrl,
    description,
    durationMinutes,
    durationLabel: durationLabel || null,
    venue: venue || null,
    mapUrl,
    imageUrl,
    officialModifiedAt: modifiedAt(html),
    schedule,
    completeForScheduling,
  };
}

export const showParserInternals = { officialUrl, toIsoDate };
