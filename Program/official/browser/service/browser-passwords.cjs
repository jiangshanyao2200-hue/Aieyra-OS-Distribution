'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {profileId} = require('./browser-profiles.cjs');

function credentialOrigin(value) {
 try {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!url.username && !url.password &&
      (url.protocol === 'https:' || (url.protocol === 'http:' && local)) &&
      !url.hostname.endsWith('.artifact.aieyra.invalid')) return url.origin;
 } catch {}
 return null;
}

function validate(value) {
 return value && typeof value.username === 'string' && value.username.length <= 320 &&
  typeof value.password === 'string' && value.password.length > 0 && value.password.length <= 4096;
}

function createBrowserPasswords(storage, safeStorage, atomicWriteJson) {
 const dir = path.join(storage, 'passwords');
 const loaded = new Map();
 const available = () => !!safeStorage?.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
 const file = profile => path.join(dir, profileId(profile) + '.json');
 function read(profile) {
  if (loaded.has(profile)) return loaded.get(profile);
  const target = file(profile);
  let result;
  try {
   const info = fs.lstatSync(target);
   if (!info.isFile() || info.isSymbolicLink() || info.size > 32 * 1024 * 1024) throw Error('Invalid password store');
   const data = JSON.parse(fs.readFileSync(target, 'utf8'));
   if (data.version !== 1 || typeof data.save !== 'boolean' || !data.entries ||
       typeof data.entries !== 'object' || Array.isArray(data.entries)) throw Error('Invalid password store');
   result = {save:data.save, entries:new Map(Object.entries(data.entries))};
  } catch (error) {
   if (error.code !== 'ENOENT') throw error;
   result = {save:true, entries:new Map()};
  }
  loaded.set(profile,result);
  return result;
 }
 function write(profile, data) {
  fs.mkdirSync(dir, {recursive:true});
  atomicWriteJson(file(profile), {version:1, save:data.save, entries:Object.fromEntries(data.entries)});
  loaded.set(profile,data);
 }
 function originFor(profile, url) {
  return profile === 'aieyra-account' ? null : credentialOrigin(url);
 }
 return {
  status(profile, url) {
   if (profile === 'aieyra-account') return {available:false};
   try {
    const data = read(profile), origin = originFor(profile, url);
    return {available:available(), save:data.save, saved:!!origin && data.entries.has(origin), origins:[...data.entries.keys()].filter(key=>credentialOrigin(key)===key).sort(), origin};
   } catch {
    return {available:false};
   }
  },
  setSaving(profile, save) {
   if (profile === 'aieyra-account' || typeof save !== 'boolean' || !available()) throw Error('Password storage is unavailable');
   const data = read(profile);
   if (save !== data.save) write(profile, {...data, save});
  },
  save(profile, url, credentials) {
   const origin = originFor(profile, url);
   if (!origin || !available() || !validate(credentials)) return false;
   const data = read(profile);
   if (!data.save) return false;
   const previous = data.entries.get(origin);
   if (previous) {
    let decoded;
    try { decoded = JSON.parse(safeStorage.decryptString(Buffer.from(previous, 'base64'))); }
    catch { return false; }
    if (decoded.username === credentials.username && decoded.password === credentials.password) return true;
   }
   const entries=new Map(data.entries);
   entries.set(origin, safeStorage.encryptString(JSON.stringify(credentials)).toString('base64'));
   write(profile, {...data,entries});
   return true;
  },
  get(profile, url) {
   const origin = originFor(profile, url);
   if (!origin || !available()) return null;
   try {
    const saved = read(profile).entries.get(origin);
    if (!saved) return null;
    const value = JSON.parse(safeStorage.decryptString(Buffer.from(saved, 'base64')));
    return validate(value) ? value : null;
   } catch {
    return null;
   }
  },
  clear(profile, url) {
   const origin = originFor(profile, url);
   if (!origin || !available()) throw Error('Password storage is unavailable');
   const data = read(profile);
   const entries=new Map(data.entries);
   if (entries.delete(origin)) write(profile, {...data,entries});
  },
 };
}

module.exports = {createBrowserPasswords,credentialOrigin};
