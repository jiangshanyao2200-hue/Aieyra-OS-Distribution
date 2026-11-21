// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: scripts/AGENTS.md | ring 3
// Chains: module-local; query impact before editing
// Regions: fs; root; publicKey; signature; envelope
// Impact: python -B scripts/code-atlas.py show scripts/sign-link.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const [directory,keyFile]=process.argv.slice(2);
if(!directory||!keyFile)throw Error('Usage: node scripts/sign-link.cjs PACKAGE_DIRECTORY PRIVATE_KEY_FILE');
const root=path.resolve(__dirname,'..'),payload=fs.readFileSync(path.join(directory,'manifest.json')),manifest=JSON.parse(payload);
if(manifest.schema!=='aieyra-app/1'||manifest.app_id!=='aieyra.link')throw Error('Unexpected Link manifest');
for(const item of manifest.artifacts){
 if(path.basename(item.file)!==item.file)throw Error('Invalid artifact filename');
 const file=fs.readFileSync(path.join(directory,item.file));
 if(file.length!==item.size||crypto.createHash('sha256').update(file).digest('hex')!==item.sha256)throw Error('Artifact mismatch');
}
const publicKey=fs.readFileSync(path.join(root,'Config/release.pub.pem'));
const signature=crypto.sign(null,payload,crypto.createPrivateKey(fs.readFileSync(keyFile)));
if(!crypto.verify(null,payload,publicKey,signature))throw Error('The private key does not match the established OS publisher');
const envelope={algorithm:'Ed25519',payload:payload.toString('base64'),signature:signature.toString('base64')};
fs.writeFileSync(path.join(directory,'signed-manifest.json'),JSON.stringify(envelope)+'\n');
fs.writeFileSync(path.join(directory,'publisher.pub.pem'),publicKey);
console.log(JSON.stringify({app_id:manifest.app_id,version:manifest.version,signature_verified:true,public_key_sha256:crypto.createHash('sha256').update(publicKey).digest('hex'),artifacts:manifest.artifacts.length}));
