// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: assert; http; net; connect
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/browser-socks-proxy.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';

const assert = require('node:assert/strict');
const {once} = require('node:events');
const http = require('node:http');
const net = require('node:net');
const {test} = require('node:test');
const {SocksClient} = require('socks');
const {socksFixture} = require('../../../AIDEBUG/fixtures/browser-socks.cjs');
const {startSocksProxy} = require('../../../Program/official/browser/service/browser-socks-proxy.cjs');

function connect(port, authorization) {
 return new Promise((resolve, reject) => {
  const request = http.request({
   method: 'CONNECT', host: '127.0.0.1', port, path: 'destination.test:443',
   headers: authorization ? {'Proxy-Authorization': authorization} : {},
  });
  request.once('connect', (response, socket) => resolve({response, socket}));
  request.once('error', reject);
  request.end();
 });
}

test('SOCKS5 bridge challenges before opening a tunnel and closes the tunnel with its owner', {timeout: 15000}, async t => {
 const origin = net.createServer(socket => socket.pipe(socket));
 origin.listen(0, '127.0.0.1');
 await once(origin, 'listening');
 const fixture = await socksFixture({
  username: 'sample-user', password: 'sample-password', host: 'destination.test', port: 443,
  localPort: origin.address().port,
 });
 const bridge = await startSocksProxy({
  proxy: 'socks5://127.0.0.1:' + fixture.port,
  proxy_auth: {username: 'sample-user', password: 'sample-password'},
 }, options => SocksClient.createConnection(options));
 t.after(async () => {
  bridge.close();
  await fixture.close();
  await new Promise(resolve => origin.close(resolve));
 });

 const unauthorized = await connect(bridge.port, null);
 assert.equal(unauthorized.response.statusCode, 407);
 unauthorized.socket.destroy();
 assert.deepEqual(fixture.attempts, []);

 const authorization = 'Basic ' + Buffer.from(bridge.auth.username + ':' + bridge.auth.password).toString('base64');
 const tunnel = await connect(bridge.port, authorization);
 assert.equal(tunnel.response.statusCode, 200);
 assert.deepEqual(fixture.attempts, [{verified:true}, {destination:'destination.test', port:443}]);
 const received = once(tunnel.socket, 'data');
 tunnel.socket.write('through the tunnel');
 assert.equal(String((await received)[0]), 'through the tunnel');
 const released = once(tunnel.socket, 'close');
 bridge.close();
 await released;
 await assert.rejects(connect(bridge.port, authorization), {code:'ECONNREFUSED'});
});
