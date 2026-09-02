import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = Number(process.argv[2] || 8786);
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.jpg':'image/jpeg', '.png':'image/png', '.mp4':'video/mp4', '.zip':'application/zip', '.txt':'text/plain; charset=utf-8', '.woff2':'font/woff2' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') { response.writeHead(302, { Location:'/premiera/' }); response.end(); return; }
    if (pathname.endsWith('/')) pathname += 'index.html';
    const allowed = pathname.startsWith('/premiera/') || pathname.startsWith('/fonts/') || ['/icon-192.png','/felt-frog-optimized.jpg','/privacy.html','/support.html'].includes(pathname);
    const file = path.resolve(root, `.${pathname}`);
    if (!allowed || !file.startsWith(root+path.sep) || pathname.includes('/.') || !['GET','HEAD'].includes(request.method)) throw new Error('Not public');
    const info = await stat(file);
    if (!info.isFile()) throw new Error('Not a file');
    const headers = { 'Content-Type':mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Accept-Ranges':'bytes' };
    let start=0, end=info.size-1, status=200;
    if (request.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
      if (!match) { response.writeHead(416,{ 'Content-Range':`bytes */${info.size}` }); response.end(); return; }
      start = match[1] ? Number(match[1]) : Math.max(0,info.size-Number(match[2]));
      end = match[1] && match[2] ? Math.min(Number(match[2]),info.size-1) : info.size-1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start>end || start<0 || start>=info.size) { response.writeHead(416,{ 'Content-Range':`bytes */${info.size}` }); response.end(); return; }
      headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`; status=206;
    }
    headers['Content-Length']=end-start+1;
    response.writeHead(status,headers);
    if (request.method==='HEAD') response.end(); else createReadStream(file,{start,end}).pipe(response);
  } catch { response.writeHead(404,{ 'Content-Type':'text/plain' }); response.end('Not found'); }
});
server.listen(port,'127.0.0.1',()=>console.log(`ŻabHop premiere preview: http://127.0.0.1:${port}/premiera/`));
