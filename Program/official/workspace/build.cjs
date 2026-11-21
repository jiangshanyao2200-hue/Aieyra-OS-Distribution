'use strict';
// Record the owning Program's source and generated renderer, excluding dependencies.
// Dependency versions are locked separately by package-lock.json.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=__dirname,file=path.join(root,'manifest.json'),manifest=JSON.parse(fs.readFileSync(file,'utf8'));
const entries={};
function walk(dir){for(const name of fs.readdirSync(dir).sort()){
 if(name==='node_modules'||name.startsWith('.')||dir===root&&name==='manifest.json')continue;
 const source=path.join(dir,name),stat=fs.lstatSync(source);if(stat.isSymbolicLink())throw Error('Program source must not contain symbolic links');
 if(stat.isDirectory())walk(source);else if(stat.isFile()){
  const bytes=fs.readFileSync(source);entries[path.relative(root,source).split(path.sep).join('/')]={sha256:crypto.createHash('sha256').update(bytes).digest('hex'),size:bytes.length};
 }
}}
walk(root);manifest.files=entries;fs.writeFileSync(file,JSON.stringify(manifest,null,2)+'\n');
console.log('Workspace Program: '+Object.keys(entries).length+' files');
