"use strict";

const dns = require("node:dns/promises");
const http = require("node:http");
const https = require("node:https");
const { BlockList, isIP } = require("node:net");

const localAddresses = new BlockList();
for (const [address, prefix] of [["10.0.0.0", 8], ["127.0.0.0", 8], ["172.16.0.0", 12], ["192.168.0.0", 16]]) {
  localAddresses.addSubnet(address, prefix, "ipv4");
}
localAddresses.addAddress("::1", "ipv6");
localAddresses.addSubnet("fc00::", 7, "ipv6");

const reservedAddresses = new BlockList();
for (const [address, prefix] of [["0.0.0.0", 8], ["100.64.0.0", 10], ["169.254.0.0", 16], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3]]) {
  reservedAddresses.addSubnet(address, prefix, "ipv4");
}
// Never allow metadata, unspecified, link-local, transition or multicast
// addresses, even when a configured provider shares that origin.
reservedAddresses.addAddress("168.63.129.16", "ipv4");
for (const [address, prefix] of [["::", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8]]) {
  reservedAddresses.addSubnet(address, prefix, "ipv6");
}
const globalIpv6 = new BlockList();
globalIpv6.addSubnet("2000::", 3, "ipv6");
const mappedIpv4 = new BlockList();
mappedIpv4.addSubnet("::ffff:0:0", 96, "ipv6");

function addressAllowed(address, allowLocal = false) {
  const family = isIP(address);
  if (!family || address.includes("%")) return false;
  const type = family === 4 ? "ipv4" : "ipv6";
  const metadataIpv6 = new BlockList();
  metadataIpv6.addAddress("fd00:ec2::254", "ipv6");
  if (metadataIpv6.check(address, type)) return false;
  // BlockList also applies IPv4 rules to IPv4-mapped IPv6 addresses.
  if (localAddresses.check(address, type)) return allowLocal;
  if (reservedAddresses.check(address, type)) return false;
  return family === 4 || mappedIpv4.check(address, type) || globalIpv6.check(address, type);
}

function imageUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("远程图片协议不受支持。");
  if (url.username || url.password) throw new Error("远程图片地址不能包含登录凭据。");
  return url;
}

async function resolveImageTarget(value, trustedProviderOrigin = "", lookup = dns.lookup) {
  const url = imageUrl(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const allowLocal = Boolean(trustedProviderOrigin && url.origin === trustedProviderOrigin);
  const records = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (!records.length || records.some(({ address }) => !addressAllowed(address, allowLocal))) {
    const error = new Error("远程图片地址不可访问；内网图片须与当前自定义服务使用相同地址和端口。");
    error.code = "AIEYRA_IMAGE_URL_BLOCKED";
    throw error;
  }
  return { url, address: records[0].address, family: isIP(records[0].address) };
}

function requestImage(target, signal) {
  return new Promise((resolve, reject) => {
    const transport = target.url.protocol === "https:" ? https : http;
    const request = transport.request(target.url, {
      method: "GET",
      signal,
      agent: false,
      // Keep the original Host and TLS hostname, but never resolve DNS again
      // between policy validation and the actual socket connection.
      lookup: (_hostname, options, callback) => options?.all
        ? callback(null, [{ address: target.address, family: target.family }])
        : callback(null, target.address, target.family),
      headers: { accept: "image/*", "accept-encoding": "identity", "cache-control": "no-store" }
    }, resolve);
    request.once("error", reject);
    request.end();
  });
}

async function downloadRemoteImage(value, { signal, maxBytes = 128 * 1024 * 1024, trustedProviderOrigin = "" } = {}) {
  let url = imageUrl(value);
  for (let redirects = 0; ; redirects += 1) {
    signal?.throwIfAborted();
    const target = await new Promise((resolve, reject) => {
      const aborted = () => reject(signal.reason || new Error("远程图片下载已取消。"));
      signal?.addEventListener("abort", aborted, { once: true });
      resolveImageTarget(url, trustedProviderOrigin).then(resolve, reject).finally(() => signal?.removeEventListener("abort", aborted));
    });
    signal?.throwIfAborted();
    const response = await requestImage(target, signal);
    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      response.destroy();
      if (redirects >= 5 || !response.headers.location) throw new Error("远程图片重定向次数过多或缺少地址。");
      const next = imageUrl(new URL(response.headers.location, url));
      if (url.protocol === "https:" && next.protocol !== "https:") throw new Error("远程图片重定向到了不安全的协议。");
      url = next;
      continue;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      response.destroy();
      throw new Error(`远程图片下载失败（HTTP ${response.statusCode}）。`);
    }
    const sizeError = () => new Error("远程图片超过 128 MB，已取消导出。");
    if (Number(response.headers["content-length"] || 0) > maxBytes) {
      response.destroy();
      throw sizeError();
    }
    const chunks = [];
    let received = 0;
    for await (const chunk of response) {
      signal?.throwIfAborted();
      received += chunk.length;
      if (received > maxBytes) { response.destroy(); throw sizeError(); }
      chunks.push(chunk);
    }
    if (!received) throw new Error("远程图片数据为空。");
    return Buffer.concat(chunks, received);
  }
}

module.exports = { addressAllowed, resolveImageTarget, downloadRemoteImage };
