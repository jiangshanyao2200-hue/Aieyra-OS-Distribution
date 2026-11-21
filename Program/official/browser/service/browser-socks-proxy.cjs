'use strict';

const http = require('node:http');
const {randomBytes, timingSafeEqual} = require('node:crypto');
const {once} = require('node:events');

function forwardedHeaders(headers) {
 const result = {...headers};
 const hop = String(result.connection || '').toLowerCase().split(',').map(value => value.trim());
 for (const name of [...hop, 'connection', 'keep-alive', 'proxy-authenticate',
  'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade']) {
  delete result[name];
 }
 return result;
}

function target(address, tunnel) {
 const url = new URL(tunnel ? 'https://' + address : address);
 if (url.username || url.password || !url.hostname || url.hash ||
     (tunnel ? url.pathname !== '/' || url.search : url.protocol !== 'http:')) {
  throw new Error('Invalid proxy destination');
 }
 return {
  hostname: url.hostname.replace(/^\[|\]$/g, ''),
  port: Number(url.port || (tunnel ? 443 : 80)),
  path: url.pathname + url.search,
  host: url.host,
 };
}

async function startSocksProxy(profile, connect) {
 const proxy = new URL(profile.proxy);
 const auth = {username: 'browser', password: randomBytes(24).toString('base64url')};
 const expected = Buffer.from('Basic ' + Buffer.from(auth.username + ':' + auth.password).toString('base64'));
 const proxyChallenge = 'Basic realm="Aieyra browser proxy"';
 const clients = new Set();
 let closed = false;

 function authorized(request) {
  const presented = Buffer.from(request.headers['proxy-authorization'] || '');
  return presented.length === expected.length && timingSafeEqual(presented, expected);
 }

 async function dial(destination) {
  const {socket} = await connect({
   proxy: {
    host: proxy.hostname.replace(/^\[|\]$/g, ''),
    port: Number(proxy.port),
    type: 5,
    userId: profile.proxy_auth.username,
    password: profile.proxy_auth.password,
   },
   destination: {host: destination.hostname, port: destination.port},
   command: 'connect',
   timeout: 8000,
  });
  if (closed) {
   socket.destroy();
   throw new Error('Proxy closed');
  }
  return socket;
 }

 const server = http.createServer({maxHeaderSize: 32768}, async (request, response) => {
  if (!authorized(request)) {
   response.writeHead(407, {'Proxy-Authenticate': proxyChallenge, Connection: 'close'}).end();
   return;
  }
  let destination, upstream;
  try {
   destination = target(request.url, false);
  } catch {
   response.writeHead(400).end();
   return;
  }
  try {
   upstream = await dial(destination);
   if (response.destroyed) {
    upstream.destroy();
    return;
   }
   const forwarded = http.request({
    host: destination.hostname, port: destination.port, path: destination.path, method: request.method,
    headers: {...forwardedHeaders(request.headers), host: destination.host},
    createConnection: () => upstream,
   }, result => {
    response.writeHead(result.statusCode, forwardedHeaders(result.headers));
    result.on('error', () => response.destroy());
    result.pipe(response);
   });
   forwarded.once('error', () => {
    if (response.headersSent) response.destroy();
    else response.writeHead(502).end();
   });
   response.once('close', () => forwarded.destroy());
   request.once('error', () => forwarded.destroy());
   request.pipe(forwarded);
  } catch {
   upstream?.destroy();
   if (!response.destroyed) response.writeHead(502).end();
  }
 });
 server.on('connect', async (request, client, head) => {
  if (!authorized(request)) {
   client.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: ' + proxyChallenge +
    '\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
   return;
  }
  let destination, upstream;
  try {
   destination = target(request.url, true);
  } catch {
   client.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
   return;
  }
  try {
   upstream = await dial(destination);
   if (client.destroyed) {
    upstream.destroy();
    return;
   }
   upstream.once('error', () => client.destroy());
   upstream.once('close', () => client.destroy());
   client.once('close', () => upstream.destroy());
   client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
   if (head.length) upstream.write(head);
   client.pipe(upstream).pipe(client);
  } catch {
   upstream?.destroy();
   client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
  }
 });
 server.on('connection', client => {
  clients.add(client);
  client.once('close', () => clients.delete(client));
  client.on('error', () => client.destroy());
 });
 server.maxConnections = 128;
 server.listen(0, '127.0.0.1');
 await once(server, 'listening');
 const port = server.address().port;
 return {
  port,
  auth,
  rules: 'http://127.0.0.1:' + port,
  close() {
   if (closed) return;
   closed = true;
   server.close();
   for (const client of clients) client.destroy();
  },
 };
}

module.exports = {startSocksProxy};
