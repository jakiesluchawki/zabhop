const DEFAULT_STORE_URL = "https://apps.apple.com/pl/app/%C5%BCabhop/id6789961777";
const BASE_URL = new URL("./", window.location.href);
const notice = document.querySelector("#notice");
const storeField = document.querySelector("#store-link");
const preparedShares = new Map();
const MAX_PREPARED_FILES = 2;
const MAX_SHARE_BYTES = 120 * 1024 * 1024;
let noticeTimer;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function announce(message) {
  clearTimeout(noticeTimer);
  notice.textContent = message;
  notice.hidden = false;
  noticeTimer = setTimeout(() => { notice.hidden = true; }, 6500);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 1) return "";
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("pl-PL", { maximumFractionDigits: 1 })} MB`;
}

function assetURL(path, kind) {
  const patterns = {
    image: /^images\/[a-zA-Z0-9._-]+\.(?:jpg|jpeg|png|webp)$/,
    video: /^videos\/[a-zA-Z0-9._-]+\.mp4$/,
    package: /^[a-zA-Z0-9._-]+\.zip$/,
  };
  if (typeof path !== "string" || !patterns[kind]?.test(path)) throw new Error("Invalid asset path");
  const url = new URL(path, BASE_URL);
  if (url.origin !== BASE_URL.origin || !url.pathname.startsWith(BASE_URL.pathname)) throw new Error("Invalid asset origin");
  return url.href;
}

function appStoreURL(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && url.hostname === "apps.apple.com" && /\/id6789961777\/?$/.test(url.pathname)) return url.href;
  } catch { /* Keep the known public App Store destination. */ }
  return DEFAULT_STORE_URL;
}

function normalizeManifest(raw) {
  if (!raw || !Array.isArray(raw.artworks) || !Array.isArray(raw.captions) || !raw.packages) throw new Error("Incomplete manifest");
  const seen = new Set();
  const storeUrl = appStoreURL(raw.storeUrl);
  const artworks = raw.artworks.map((artwork) => {
    if (!artwork || typeof artwork.id !== "string" || !/^[a-z0-9-]+$/.test(artwork.id) || seen.has(artwork.id) || !["story", "post"].includes(artwork.format)) throw new Error("Invalid artwork");
    seen.add(artwork.id);
    if (typeof artwork.title !== "string" || typeof artwork.alt !== "string") throw new Error("Missing artwork description");
    const width = Number(artwork.width);
    const height = Number(artwork.height);
    if (width !== 1080 || height !== (artwork.format === "story" ? 1920 : 1350)) throw new Error("Unexpected artwork dimensions");
    const item = {
      ...artwork,
      width,
      height,
      url: assetURL(artwork.file, "image"),
      previewURL: assetURL(artwork.thumbnail, "image"),
      storeUrl: appStoreURL(artwork.storeUrl || storeUrl),
      stickerLabel: typeof artwork.stickerLabel === "string" ? artwork.stickerLabel : "Pobierz ŻabHopa",
    };
    if (artwork.video) {
      if (artwork.video.mime !== "video/mp4" || artwork.video.kind !== "montage" || artwork.video.fullCopyAlwaysVisible !== true) throw new Error("Unexpected video format");
      item.video = { ...artwork.video, url: assetURL(artwork.video.file, "video") };
    }
    return item;
  });
  if (!artworks.some((item) => item.format === "story") || !artworks.some((item) => item.format === "post")) throw new Error("Missing artwork group");
  const packages = Object.fromEntries(["full", "stories", "jpg"].map((key) => {
    const pack = raw.packages[key];
    if (!pack) throw new Error("Missing package");
    return [key, { ...pack, url: assetURL(pack.file, "package") }];
  }));
  const captions = raw.captions.map((caption, index) => {
    if (!caption || typeof caption.text !== "string" || typeof caption.title !== "string") throw new Error("Invalid caption");
    return { ...caption, id: `caption-${index}`, platform: String(caption.platform || "") };
  });
  return { ...raw, storeUrl, artworks, packages, captions };
}

async function copyText(text, field) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
    await navigator.clipboard.writeText(text);
    announce("Skopiowane. Możesz wkleić.");
  } catch {
    if (field) {
      field.focus();
      field.select();
      field.setSelectionRange(0, field.value.length);
      announce("Tekst jest zaznaczony. Wybierz systemowe „Kopiuj”.");
    } else {
      announce("Kopiowanie jest niedostępne. Przytrzymaj tekst i wybierz „Kopiuj”.");
    }
  }
}

function copyButton(label, getText, field, className = "button button-light") {
  const button = element("button", className, label);
  button.type = "button";
  button.addEventListener("click", () => { void copyText(getText(), field); });
  return button;
}

function linkButton(text, url, { primary = false, download = false, newTab = false } = {}) {
  const link = element("a", `button ${primary ? "button-primary" : "button-light"}`, text);
  link.href = url;
  if (download) link.download = "";
  if (newTab) {
    link.target = "_blank";
    link.rel = "noopener";
  }
  return link;
}

function supportsFileSharing(name, mime) {
  if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function" || typeof File !== "function") return false;
  try {
    return navigator.canShare({ files: [new File([""], name, { type: mime })] });
  } catch { return false; }
}

function rememberShare(key, entry) {
  preparedShares.set(key, entry);
  while (preparedShares.size > MAX_PREPARED_FILES) {
    const oldestKey = preparedShares.keys().next().value;
    const oldest = preparedShares.get(oldestKey);
    preparedShares.delete(oldestKey);
    if (oldest.button.isConnected) oldest.button.textContent = oldest.initialLabel;
  }
}

function makeShareButton(artwork) {
  const target = artwork.video || artwork;
  const mime = artwork.video ? "video/mp4" : "image/jpeg";
  const format = artwork.video ? "MP4" : "JPG";
  const name = target.file.split("/").pop();
  if (!supportsFileSharing(name, mime) || target.bytes > MAX_SHARE_BYTES) return null;
  const initialLabel = `Przygotuj zapis ${format}`;
  const button = element("button", "button button-light share-file", initialLabel);
  button.type = "button";
  button.addEventListener("click", async () => {
    const prepared = preparedShares.get(artwork.id);
    if (prepared) {
      try {
        // This branch runs directly inside the second tap's user activation.
        await navigator.share({ files: [prepared.file] });
      } catch (error) {
        if (error.name !== "AbortError") announce(`Nie udało się udostępnić pliku. Użyj „Otwórz ${format}” i menu udostępniania przeglądarki.`);
      }
      return;
    }

    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.textContent = "Przygotowuję plik…";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    announce(`Pobieram wybrany ${format}${formatBytes(target.bytes) ? ` (${formatBytes(target.bytes)})` : ""}. Pozostałe filmy nie są pobierane.`);
    try {
      // A full media file is fetched only after this explicit user request.
      const response = await fetch(target.url, { signal: controller.signal, credentials: "same-origin" });
      if (!response.ok) throw new Error("Media unavailable");
      const receivedMime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
      if (receivedMime && ![mime, "application/octet-stream"].includes(receivedMime)) throw new Error("Unexpected media type");
      const declaredSize = Number(response.headers.get("content-length"));
      if (declaredSize > MAX_SHARE_BYTES) throw new Error("File too large");
      const blob = await response.blob();
      if (!blob.size || blob.size > MAX_SHARE_BYTES) throw new Error("Invalid media size");
      const file = new File([blob], name, { type: mime });
      if (!navigator.canShare({ files: [file] })) throw new Error("File sharing unavailable");
      rememberShare(artwork.id, { file, button, initialLabel });
      button.textContent = `Zapisz / udostępnij ${format}`;
      announce("Gotowe. Dotknij teraz „Zapisz / udostępnij”, aby otworzyć menu systemowe.");
    } catch {
      button.textContent = initialLabel;
      announce(`Nie udało się przygotować pliku. Użyj „Pobierz ${format}” lub „Otwórz ${format}”.`);
    } finally {
      clearTimeout(timeout);
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  });
  return button;
}

function makeStickerKit(artwork) {
  const details = element("details", "card-copy");
  details.append(element("summary", "", "Link i tekst naklejki"));
  const inputId = `sticker-${artwork.id}`;
  const label = element("label", "", "Tekst na naklejce Link");
  label.htmlFor = inputId;
  const input = element("input");
  input.id = inputId;
  input.readOnly = true;
  input.value = artwork.stickerLabel;
  const actions = element("div", "copy-actions");
  actions.append(copyButton("Kopiuj tekst", () => input.value, input, "button button-text"));
  actions.append(copyButton("Kopiuj link App Store", () => artwork.storeUrl, storeField, "button button-text"));
  details.append(label, input, actions);
  return details;
}

function makeArtworkCard(artwork) {
  const card = element("article", "asset-card");
  const titleId = `title-${artwork.id}`;
  card.setAttribute("aria-labelledby", titleId);
  if (artwork.video) {
    const video = element("video");
    video.controls = true;
    video.playsInline = true;
    video.preload = "none";
    video.poster = artwork.previewURL;
    video.width = artwork.width;
    video.height = artwork.height;
    video.setAttribute("aria-label", `${artwork.title}. Montaż bez dźwięku. ${artwork.alt}`);
    const source = element("source");
    source.src = artwork.video.url;
    source.type = "video/mp4";
    video.append(source, document.createTextNode("Użyj linku do MP4 poniżej, jeśli film nie jest obsługiwany."));
    video.addEventListener("play", () => {
      document.querySelectorAll(".gallery video").forEach((other) => { if (other !== video) other.pause(); });
    });
    card.append(video);
  } else {
    const link = element("a", "poster-link");
    link.href = artwork.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.setAttribute("aria-label", `Otwórz pełny JPG: ${artwork.title}`);
    const image = element("img");
    image.src = artwork.previewURL;
    image.alt = artwork.alt;
    image.loading = "lazy";
    image.decoding = "async";
    image.width = artwork.width;
    image.height = artwork.height;
    link.append(image);
    card.append(link);
  }

  const body = element("div", "asset-body");
  body.append(element("p", "asset-kicker", artwork.video ? "STORKA · MONTAŻ / BEZ DŹWIĘKU" : artwork.format === "story" ? "STORKA · JPG" : "POST · JPG"));
  const heading = element("h3", "", artwork.title);
  heading.id = titleId;
  body.append(heading);
  const actions = element("div", "asset-actions");
  if (artwork.video) {
    actions.append(linkButton("Pobierz MP4", artwork.video.url, { primary: true, download: true }));
    actions.append(linkButton("Otwórz MP4", artwork.video.url, { newTab: true }));
  }
  actions.append(linkButton("Pobierz JPG", artwork.url, { primary: !artwork.video, download: true }));
  actions.append(linkButton("Otwórz JPG", artwork.url, { newTab: true }));
  body.append(actions);
  const meta = [];
  if (artwork.video) {
    const duration = Number(artwork.video.duration);
    if (Number.isFinite(duration) && duration > 0) meta.push(`${duration.toLocaleString("pl-PL", { maximumFractionDigits: 1 })} s`);
    if (formatBytes(artwork.video.bytes)) meta.push(`MP4 ${formatBytes(artwork.video.bytes)}`);
  }
  if (formatBytes(artwork.bytes)) meta.push(`JPG ${formatBytes(artwork.bytes)}`);
  if (meta.length) body.append(element("p", "asset-meta", meta.join(" · ")));
  const shareButton = makeShareButton(artwork);
  if (shareButton) body.append(shareButton);
  if (artwork.id === "story-03-otwarte") body.append(element("p", "small-note", "Godziny widoczne na zrzucie są historyczne. Sprawdź aktualne przed wyjściem."));
  if (artwork.format === "story") body.append(makeStickerKit(artwork));
  card.append(body);
  return card;
}

function makeCaptionCard(caption) {
  const article = element("article", "caption-card");
  if (caption.platform && caption.platform.toLocaleLowerCase("pl-PL") !== caption.title.toLocaleLowerCase("pl-PL")) article.append(element("p", "caption-platform", caption.platform));
  const title = element("h3", "", caption.title);
  const titleId = `${caption.id}-title`;
  title.id = titleId;
  const field = element("textarea");
  field.id = caption.id;
  field.readOnly = true;
  field.rows = 10;
  field.value = caption.text;
  field.setAttribute("aria-labelledby", titleId);
  article.append(title, field, copyButton("Kopiuj tekst", () => field.value, field));
  return article;
}

function enhanceStaticCopy() {
  const storeActions = document.querySelector("#store-link-actions");
  storeActions.prepend(copyButton("Kopiuj link App Store", () => storeField.value, storeField, "button button-primary"));
  document.querySelectorAll("#caption-list .caption-card").forEach((card) => {
    const field = card.querySelector("textarea");
    if (field) card.append(copyButton("Kopiuj tekst", () => field.value, field));
  });
}

function renderManifest(manifest) {
  // Build everything first: a malformed manifest must never erase the usable HTML fallback.
  const stories = document.createDocumentFragment();
  const posts = document.createDocumentFragment();
  const captions = document.createDocumentFragment();
  manifest.artworks.forEach((artwork) => { (artwork.format === "story" ? stories : posts).append(makeArtworkCard(artwork)); });
  manifest.captions.forEach((caption) => { captions.append(makeCaptionCard(caption)); });
  document.querySelector("#story-grid").replaceChildren(stories);
  document.querySelector("#post-grid").replaceChildren(posts);
  if (manifest.captions.length) document.querySelector("#caption-list").replaceChildren(captions);
  storeField.value = manifest.storeUrl;
  document.querySelectorAll("[data-store-link]").forEach((link) => { link.href = manifest.storeUrl; });
  Object.entries(manifest.packages).forEach(([key, pack]) => {
    const link = document.querySelector(`[data-package="${key}"]`);
    const size = document.querySelector(`[data-package-size="${key}"]`);
    if (link) link.href = pack.url;
    if (size) size.textContent = formatBytes(pack.bytes) ? `· ${formatBytes(pack.bytes)}` : "";
  });
}

async function loadManifest() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(new URL("manifest.json", BASE_URL), { signal: controller.signal, credentials: "same-origin", cache: "no-cache" });
    if (!response.ok) throw new Error("Manifest unavailable");
    const manifest = normalizeManifest(await response.json());
    renderManifest(manifest);
  } catch {
    document.querySelector("#manifest-warning").hidden = false;
  } finally {
    clearTimeout(timeout);
  }
}

enhanceStaticCopy();
void loadManifest();
