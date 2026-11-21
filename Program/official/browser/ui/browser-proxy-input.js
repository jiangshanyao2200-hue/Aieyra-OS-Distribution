'use strict';

(function (root) {
 const protocols = ['http', 'https', 'socks4', 'socks5'];
 const hostPattern = /^(?:\[[0-9a-f:]+\]|[a-z0-9.-]+)$/i;
 const endpointPattern = /^(\[[0-9a-f:]+\]|[a-z0-9.-]+):([0-9]{1,5})(?::([\s\S]*))?$/i;

 function invalid() {
  return new Error('Invalid proxy address or credentials');
 }

 function format({protocol, host, port, username = '', password = ''}) {
  if (!host && !port && !username && !password) return '';
  if (!protocols.includes(protocol) || !hostPattern.test(host) ||
      !/^[0-9]{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535 ||
      (!username && password) || username.length > 256 || password.length > 1024 ||
      /[\r\n\0]/.test(username + password)) throw invalid();
  const canonicalHost = new URL('http://' + host).hostname;
  const auth = username ? encodeURIComponent(username) + ':' + encodeURIComponent(password) + '@' : '';
  return protocol + '://' + auth + canonicalHost + ':' + Number(port);
 }

 function endpoint(value) {
  const match = endpointPattern.exec(value);
  if (!match || match[3] !== undefined) throw invalid();
  return {host: match[1], port: match[2]};
 }

 function credentials(value) {
  const colon = value.indexOf(':');
  if (colon < 1) throw invalid();
  return {username: value.slice(0, colon), password: value.slice(colon + 1)};
 }

 function parse(input, protocol = 'http') {
  let host, port, username = '', password = '';
  const value = input.trim();
  const at = value.lastIndexOf('@');
  const suffix = at === -1 ? null : endpointPattern.exec(value.slice(at + 1).trim());
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
   if (!/^[a-z][a-z0-9+.-]*:\/\/[^/?#\\\s]+\/?$/i.test(value)) throw invalid();
   const url = new URL(value);
   protocol = url.protocol.slice(0, -1);
   host = url.hostname;
   const explicitPort = /:([0-9]{1,5})\/?$/.exec(value)?.[1];
   port = url.port || explicitPort || ({http: '80', https: '443', socks4: '1080', socks5: '1080'})[protocol];
   username = decodeURIComponent(url.username);
   password = decodeURIComponent(url.password);
  } else if (/\r?\n/.test(value)) {
   const lines = value.split(/\r?\n/);
   ({host, port} = endpoint(lines[0].trim()));
   if (lines.length === 2) ({username, password} = credentials(lines[1]));
   else if (lines.length === 3) [, username, password] = lines;
   else throw invalid();
  } else if (suffix && suffix[3] === undefined) {
   [, host, port] = suffix;
   ({username, password} = credentials(value.slice(0, at)));
  } else {
   const match = endpointPattern.exec(value);
   if (!match) throw invalid();
   [, host, port] = match;
   if (match[3] !== undefined) ({username, password} = credentials(match[3]));
  }
  const result = {protocol, host, port, username, password};
  format(result);
  return result;
 }

 const api = {protocols, parse, format};
 if (typeof module === 'object' && module.exports) module.exports = api;
 else root.aieyraBrowserProxyInput = api;
})(globalThis);
