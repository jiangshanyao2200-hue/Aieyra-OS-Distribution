'use strict';
// Chromium requests several media devices together but checks each separately.
// Session grants remain scoped to the profile, site and exact device kind.
function permissionKeys(profile,permission,site,details={}){
 let origin;try{const address=new URL(site);if(!['http:','https:'].includes(address.protocol))return [];origin=address.origin;}catch{return [];}
 const kinds=permission==='media'?(Array.isArray(details.mediaTypes)?details.mediaTypes:[details.mediaType]):[''];
 if(!kinds.length||permission==='media'&&kinds.some(kind=>!['audio','video'].includes(kind)))return [];
 return [...new Set(kinds)].map(kind=>JSON.stringify([profile,origin,permission,kind]));
}
module.exports={permissionKeys};
