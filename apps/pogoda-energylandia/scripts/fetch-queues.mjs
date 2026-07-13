import { access, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const source = "https://queue-times.com/parks/317/queue_times.json";
const destination = resolve("public/live-queues.json");

try {
  const response = await fetch(source, {
    headers: { "user-agent": "PogodaPark/1.0 (+https://github.com/jakiesluchawki/zabhop/tree/main/apps/pogoda-energylandia)" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload.rides) && !Array.isArray(payload.lands)) {
    throw new Error("Nieoczekiwany format danych");
  }
  payload.snapshot_generated_at = new Date().toISOString();
  await writeFile(destination, `${JSON.stringify(payload)}\n`, "utf8");
  console.log(`Zapisano ${destination}`);
} catch (error) {
  try {
    await access(destination);
    console.warn(`Nie odświeżono kolejek (${error.message}); używam poprzedniej migawki.`);
  } catch {
    throw error;
  }
}
