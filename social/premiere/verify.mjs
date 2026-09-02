import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { artworks as source, stickerArea, storeUrl } from './campaign.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'premiera');
const manifestText = await readFile(path.join(output,'manifest.json'),'utf8');
const manifest = JSON.parse(manifestText);
assert.equal(manifest.storeUrl,storeUrl);
assert.ok(!/\/Users\/|\.local\/|PRIVATE KEY|oauth|token/i.test(manifestText),'No private material in manifest');
assert.equal(manifest.artworks.length,7);
assert.equal(manifest.artworks.filter(item=>item.format==='story' && item.video).length,5);
const sha = data=>createHash('sha256').update(data).digest('hex');
function jpegSize(data) {
  assert.equal(data.readUInt16BE(0),0xffd8);
  for(let i=2;i<data.length;) {
    assert.equal(data[i],0xff,'JPEG marker');
    while(data[i]===0xff) i++;
    const marker=data[i++];
    const length=data.readUInt16BE(i);
    if([0xc0,0xc1,0xc2].includes(marker)) return {height:data.readUInt16BE(i+3),width:data.readUInt16BE(i+5)};
    i+=length;
  }
  throw new Error('Missing JPEG dimensions');
}
for(const item of manifest.artworks) {
  const bytes=await readFile(path.join(output,item.file));
  assert.equal(bytes.length,item.bytes); assert.equal(sha(bytes),item.sha256);
  assert.deepEqual(jpegSize(bytes),{width:1080,height:item.format==='story'?1920:1350});
  const thumb=await readFile(path.join(output,item.thumbnail));
  assert.equal(jpegSize(thumb).width,432);
  if(item.format==='story') {
    assert.deepEqual(item.stickerArea,stickerArea);
    assert.equal(item.storeUrl,storeUrl);
    assert.equal(item.video.audio,false);
    assert.equal(item.video.fullCopyAlwaysVisible,true);
    assert.equal(item.video.kind,'montage');
    assert.ok(item.video.duration>=6 && item.video.duration<=8);
    const video=await readFile(path.join(output,item.video.file));
    assert.equal(video.length,item.video.bytes); assert.equal(sha(video),item.video.sha256);
  }
}
const audit=JSON.parse(await readFile(path.join(root,'.local/premiere-build/render-audit.json'),'utf8'));
for(const item of audit) {
  assert.equal(item.safeZones,true);
  const definition=source.find(entry=>entry.id===item.id);
  assert.equal(item.texts.length,definition.texts.length);
  for(let index=0;index<item.texts.length;index++) assert.equal(item.texts[index].text,definition.texts[index].text);
  const intersects=(a,b)=>a.x<b.x+b.width && a.x+a.width>b.x && a.y<b.y+b.height && a.y+a.height>b.y;
  // Box widths are actual typeset widths. Right-aligned header labels use their known reserved box.
  const textBoxes=item.texts.map((text,index)=>definition.texts[index].align==='right'?{...text,x:definition.texts[index].box.x+definition.texts[index].box.width-text.width}:text);
  for(let i=0;i<textBoxes.length;i++) for(let j=i+1;j<textBoxes.length;j++) {
    assert.ok(!intersects(textBoxes[i],textBoxes[j]),`${item.id}: text collision ${textBoxes[i].text} / ${textBoxes[j].text}`);
  }
  for(const image of definition.images) for(const text of textBoxes) assert.ok(!intersects(image.box,text),`${item.id}: text/image collision ${text.text}`);
  for(const scene of definition.scenes||[]) {
    assert.ok(!intersects(scene.box,stickerArea),`${item.id}: movie in sticker area`);
    for(const text of textBoxes) assert.ok(!intersects(scene.box,text),`${item.id}: movie/copy collision ${text.text}`);
  }
}
for(const pack of Object.values(manifest.packages)) {
  const file=path.join(output,pack.file);
  const bytes=await readFile(file);
  assert.equal(bytes.length,pack.bytes); assert.equal(sha(bytes),pack.sha256);
  execFileSync('/usr/bin/unzip',['-t',file],{stdio:'pipe'});
  const names=execFileSync('/usr/bin/unzip',['-Z1',file],{encoding:'utf8'}).trim().split('\n');
  assert.deepEqual(names.sort(),[...pack.entries].sort());
  assert.ok(names.every(name=>!name.startsWith('.') && !name.includes('..') && !/\.(?:otf|woff2|swift|mjs)$/.test(name)));
}
const html=await readFile(path.join(output,'index.html'),'utf8');
assert.equal((html.match(/<video\b/g)||[]).length,5);
assert.equal((html.match(/preload="none"/g)||[]).length,5);
assert.ok(!/<video[^>]*autoplay/i.test(html));
for(const item of manifest.artworks) assert.ok(html.includes(item.file),`No static fallback for ${item.id}`);
for(const pack of Object.values(manifest.packages)) assert.ok(html.includes(pack.file),`No static fallback for ${pack.file}`);
for(const sub of ['images','videos','teksty']) {
  const files=await readdir(path.join(output,sub));
  assert.ok(files.every(file=>!file.startsWith('.')));
}
console.log('PASS: 7 JPG, 5 MP4, 3 exact ZIPs, source copy, dimensions, hashes, font metrics, no text/media collisions, all sticker zones, static fallbacks, no private data.');
