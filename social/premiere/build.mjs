import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { artworks, captions, crops, revision, stickerArea, storeUrl } from './campaign.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../..');
const output = path.join(root, 'premiera');
const build = path.join(root, '.local/premiere-build');
const mode = process.argv[2] || '--all';
assert.ok(['--all', '--images-only', '--videos-only', '--package-only'].includes(mode), 'Unknown build mode');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async (file, value) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(value, null, 2) + '\n'); };
for (const folder of [output, build, path.join(directory, 'assets'), path.join(output, 'images'), path.join(output, 'videos'), path.join(output, 'teksty')]) await mkdir(folder, { recursive: true });

// Only these two already-public screenshots may be imported. Never copy .local/app-store wholesale.
for (const name of ['02-zabka-radar.png', '03-other-stores.png']) {
  const target = path.join(directory, 'assets', name);
  try { await stat(target); } catch { await copyFile(path.join(root, '.local/app-store/screenshots', name), target); }
}

if (mode === '--all' || mode === '--images-only') {
  const plan = path.join(build, 'render-plan.json');
  await json(plan, { root, output, build, crops, artworks });
  execFileSync('xcrun', ['swift', '-module-cache-path', path.join(build, 'swift-cache'), path.join(directory, 'render.swift'), plan], { stdio: 'inherit' });
}

if (mode === '--all' || mode === '--videos-only') {
  const jobs = artworks.filter(item => item.format === 'story').map(item => ({
    id: item.id, output: path.join(build, 'videos', `${item.id}.mp4`),
    overlay: path.join(build, 'overlays', `${item.id}.png`), background: item.background,
    width: 1080, height: 1920, fps: 30, previews: path.join(build, 'video-qa/frame'),
    scenes: item.scenes.map(scene => ({ ...scene, image: path.join(root, scene.image) })),
  }));
  const plan = path.join(build, 'encode-plan.json');
  await json(plan, { jobs });
  execFileSync('xcrun', ['swift', '-module-cache-path', path.join(build, 'swift-cache'), path.join(directory, 'encode.swift'), plan], { stdio: 'inherit' });
  // AVFoundation may leave its own sidecar files. Keep them outside the public gallery.
  for (const job of jobs) await rename(job.output, path.join(output, 'videos', `${job.id}.mp4`));
}

const readme = `ŻABHOP — PAKIET PREMIEROWY\n\n5 storek 1080 × 1920 (MP4 + alternatywne JPG), 2 posty 1080 × 1350 i gotowe teksty.\n\nLINK DO APLIKACJI\n${storeUrl}\n\nJAK PUBLIKOWAĆ\n1. Wybierz storki 01–05 po kolei. Dla jednego numeru użyj MP4 albo JPG, nie obu.\n2. Dodaj prawdziwą naklejkę Link w Instagramie. Film i JPG nie zawierają klikalnych przycisków.\n3. Miejsce naklejki: środek wolnego pola na ok. 82% wysokości (x=240,y=1510,w=600,h=120 przy 1080×1920), nad małym podpisem.\n4. Filmy są bez dźwięku; muzykę możesz dobrać w Instagramie.\n5. Na iPhonie pobierz ZIP do Plików, rozpakuj, otwórz wybrany plik i użyj Udostępnij → Zapisz obraz / Zapisz wideo.\n6. Link w opisie Instagrama nie jest klikalny. Użyj naklejki albo linku w profilu.\n\nAUTENTYCZNOŚĆ\nWykorzystano oryginalne grafiki ŻabHopa oraz niezmienione zrzuty ekranów iOS użyte w App Store. Filmy są montażami z kadrowaniem i zbliżeniami, a nie nagraniami dotknięć lub spaceru. Wartości odległości, adresy, godziny i ETA to przykładowy stan z chwili wykonania zrzutów; nie są informacją na żywo. Nie zmieniano interfejsu ani danych na screenshotach.\n\nOGRANICZENIA\nŻabHop to niezależna, nieoficjalna aplikacja, bez powiązania z prezentowanymi sieciami. Strzałka wskazuje kierunek w linii prostej; trasa piesza jest w Apple Maps. Godziny otwarcia i czas dojścia mogą się zmieniać. Lokalne katalogi, kierunek i dystans działają offline; aktualizacje i usługi Apple Maps potrzebują połączenia.\n\nDane Żabek: Żabka Polska. Dane innych sklepów: © OpenStreetMap contributors, ODbL. Trasy: Apple Maps. Typografia Romie / Roobert została użyta do kompozycji; pliki fontów nie są częścią paczek ZIP.\n\nNic nie zostało automatycznie opublikowane na profilach społecznościowych.\n`;
await writeFile(path.join(output, 'CZYTAJ-MNIE.txt'), readme);
for (const caption of captions) await writeFile(path.join(output, 'teksty', `${caption.id}.txt`), caption.text + '\n');
await writeFile(path.join(output, 'teksty/stories-pelny-tekst.txt'), artworks.filter(item => item.format === 'story').map(item => `${item.title}\n\n${item.texts.map(layer => layer.text).join('\n\n')}\n\nNaklejka: ${item.stickerLabel}\n${storeUrl}`).join('\n\n---\n\n') + '\n');

const manifest = {
  title: 'ŻabHop · pakiet premierowy', revision, generatedOn: new Date().toISOString(), storeUrl,
  disclosure: 'Montaże oryginalnych grafik i rzeczywistych ekranów aplikacji, nie nagrania gestów. Dane na ekranach są historycznymi przykładami.',
  artworks: [], captions,
  sources: await Promise.all(['social/premiere/assets/02-zabka-radar.png', 'social/premiere/assets/03-other-stores.png', 'felt-frog.png', 'felt-compass.png'].map(async file => ({ file: path.basename(file), sha256: hash(await readFile(path.join(root, file))) }))),
};
for (const item of artworks) {
  const file = `images/${item.id}.jpg`;
  const image = await readFile(path.join(output, file));
  const entry = {
    id: item.id, title: item.title, format: item.format, lead: item.lead, body: item.body, alt: item.alt,
    file, thumbnail: `images/${item.id}-preview.jpg`, width: item.width, height: item.height,
    bytes: image.length, sha256: hash(image), storeUrl,
    ...(item.format === 'story' ? { stickerLabel: item.stickerLabel, stickerArea } : {}),
  };
  const movie = `videos/${item.id}.mp4`;
  if (item.format === 'story' && mode !== '--images-only') {
    const data = await readFile(path.join(output, movie));
    entry.video = { file: movie, mime: 'video/mp4', codec: 'H.264', kind: 'montage', width:1080, height:1920, fps:30,
      duration: item.scenes.reduce((sum, scene) => sum + scene.duration, 0), bytes:data.length, sha256:hash(data), audio:false, fullCopyAlwaysVisible:true };
  }
  manifest.artworks.push(entry);
}

if (mode !== '--images-only') {
  const texts = ['CZYTAJ-MNIE.txt', ...captions.map(item => `teksty/${item.id}.txt`), 'teksty/stories-pelny-tekst.txt'];
  const stills = manifest.artworks.filter(item => item.format === 'story').map(item => item.file);
  const movies = manifest.artworks.filter(item => item.video).map(item => item.video.file);
  const packageLists = {
    stories: { file: 'zabhop-stories.zip', entries: [...stills, ...movies, ...texts] },
    jpg: { file: 'zabhop-stories-jpg.zip', entries: [...stills, 'CZYTAJ-MNIE.txt', 'teksty/stories-linki.txt', 'teksty/stories-pelny-tekst.txt'] },
    full: { file: 'zabhop-premiera.zip', entries: [...manifest.artworks.map(item => item.file), ...movies, ...texts] },
  };
  manifest.packages = {};
  for (const [key, pack] of Object.entries(packageLists)) {
    const temporary = `.package-${key}-${Date.now()}.zip`;
    execFileSync('/usr/bin/zip', ['-q', temporary, ...pack.entries], { cwd: output });
    execFileSync('/usr/bin/unzip', ['-t', temporary], { cwd: output, stdio: 'pipe' });
    await rename(path.join(output, temporary), path.join(output, pack.file));
    const bytes = await readFile(path.join(output, pack.file));
    manifest.packages[key] = { file: pack.file, bytes: bytes.length, sha256: hash(bytes), entries: pack.entries };
  }
}
await json(path.join(output, 'manifest.json'), manifest);
console.log(`Prepared ${manifest.artworks.length} images and ${manifest.artworks.filter(item => item.video).length} videos in premiera/.`);
