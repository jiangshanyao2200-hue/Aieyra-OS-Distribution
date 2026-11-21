// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: setupChatAttachmentViewer
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/chat-attachment-viewer.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {setupImageViewer} from './image-viewer.mjs';
import {setupMediaViewer,canPreviewMedia} from '../../../Theme/runtime/media.mjs';
import {previewWebReference} from './attachments.mjs';

// Readers are bound by the host to the current conversation. A changed scope
// closes the original viewer before a late response can paint another chat.
export function setupChatAttachmentViewer({read,attachItems,onError=()=>{},subscribeVisibility}){
 const image=setupImageViewer({call:p=>read('imageLibrary',p),attachItems,onError});
 const media=setupMediaViewer({read:attachment=>read('attachmentMedia',{attachment}),subscribeVisibility});
 const preview=(attachment,all=[attachment])=>{
  if(attachment.web_reference)return previewWebReference(attachment);
  if(canPreviewMedia(attachment))return media.show(attachment);
  if(attachment.kind==='image'){const images=all.filter(a=>a.kind==='image');return image.show(images,Math.max(0,images.findIndex(a=>a.sha256===attachment.sha256)));}
 };
 // previewWebReference is synchronous, while media/image readers are async.
 const onPreview=e=>{Promise.resolve(preview(e.detail.attachment,e.detail.attachments)).catch(e=>onError(e.message));};
 for(const name of ['eyra-attachment','eyra-media','eyra-web-reference'])document.addEventListener(name,onPreview);
 return {preview,close(){image.close();media.close();},dispose(){image.close();image.viewer.remove();media.dispose();for(const name of ['eyra-attachment','eyra-media','eyra-web-reference'])document.removeEventListener(name,onPreview);}};
}
