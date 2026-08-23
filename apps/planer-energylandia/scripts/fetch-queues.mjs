import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { queueRidesFromPayload } from "../src/queues.js";

const source = "https://queue-times.com/parks/317/queue_times.json";
const destination = resolve("public/live-queues.json");
const temporaryDestination = `${destination}.tmp`;

try {
  const response = await fetch(source, {
    headers: { "user-agent": "PogodaPark/1.0 (+https://github.com/jakiesluchawki/zabhop/tree/main/apps/pogoda-energylandia)" },
    signal: AbortSignal.timeout(18_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  const rides = queueRidesFromPayload(payload);
  if (!rides.length) throw new Error("Źródło nie zwróciło żadnej rozpoznawalnej atrakcji");
  payload.snapshot_generated_at = new Date().toISOString();
  await writeFile(temporaryDestination, `${JSON.stringify(payload)}\n`, "utf8");
  await rename(temporaryDestination, destination);
  console.log(`Zapisano ${destination}: ${rides.length} rozpoznawalnych atrakcji.`);
} catch (error) {
  try {
    const previous = JSON.parse(await readFile(destination, "utf8"));
    if (!queueRidesFromPayload(previous).length) throw new Error("Poprzednia migawka nie zawiera żadnej atrakcji");
    console.warn(`Nie odświeżono kolejek (${error.message}); używam poprzedniej migawki.`);
  } catch {
    throw error;
  }
} finally {
  await unlink(temporaryDestination).catch(() => {});
}
