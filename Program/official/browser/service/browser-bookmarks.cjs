'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function createBookmarks(storage){
 const file=path.join(storage,'bookmarks.json');let data={version:1,profiles:{}};
 const checkProfile=p=>{if(!/^[a-zA-Z0-9_-]{1,48}$/.test(p))throw Error('Invalid bookmark profile');};
 const address=target=>{const u=new URL(target);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('Only ordinary website addresses can be bookmarked');return u;};
 try{const raw=fs.readFileSync(file,'utf8');if(raw.length>1<<20)throw Error('Bookmark storage is too large');const saved=JSON.parse(raw);if(saved.version!==1||!saved.profiles||typeof saved.profiles!=='object'||Array.isArray(saved.profiles))throw Error('Invalid bookmark storage');for(const [profile,rows] of Object.entries(saved.profiles)){checkProfile(profile);if(!Array.isArray(rows)||rows.length>200)throw Error('Invalid bookmark list');const ids=new Set();for(const row of rows){if(!row||!/^([a-f0-9]{16})$/.test(row.id)||ids.has(row.id)||typeof row.title!=='string'||row.title.length>160||typeof row.url!=='string')throw Error('Invalid bookmark');ids.add(row.id);address(row.url);}}data=saved;}catch(e){if(e.code!=='ENOENT')throw Error('Bookmarks could not be loaded; the original file was preserved');}
 const key=p=>{checkProfile(p);const aliases=Object.keys(data.profiles).filter(k=>k.toLowerCase()===p.toLowerCase());if(aliases.length>1)throw Error('Conflicting bookmark identities; original file preserved');return aliases[0]||p.toLowerCase();};
 const list=p=>{p=key(p);return (Array.isArray(data.profiles[p])?data.profiles[p]:[]).map(x=>({...x}));};
 const save=(p,rows)=>{p=key(p);const next={version:1,profiles:{...data.profiles,[p]:rows}};fs.mkdirSync(storage,{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(next,null,2));fs.renameSync(file+'.tmp',file);data=next;return list(p);};
 return {list,toggle(profile,target,title){checkProfile(profile);const u=address(target);const rows=list(profile),index=rows.findIndex(x=>x.url===u.href);if(index>=0)rows.splice(index,1);else{if(rows.length>=200)throw Error('Bookmark limit (200)');rows.push({id:crypto.randomBytes(8).toString('hex'),url:u.href,title:String(title||u.hostname).slice(0,160)});}return save(profile,rows);},remove(profile,id){return save(profile,list(profile).filter(x=>x.id!==id));}};
}
module.exports={createBookmarks};
