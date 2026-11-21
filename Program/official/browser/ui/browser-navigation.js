'use strict';
// Shared by browser chrome and the host; parsing does not navigate or run code.
(function(root){
 function address(value,engine='baidu'){
  const text=String(value||'').trim();if(!text)return null;
  if(text==='about:blank')return text;
  if(/^https?:\/\//i.test(text)){const u=new URL(text);if(!u.hostname)throw Error('Invalid URL');return u.href;}
  if(/^[a-z][\w+.-]*:/i.test(text)&&!/^((localhost|[\w.-]+\.[\w.-]+):\d+|\[[\da-f:]+\]:\d+)/i.test(text))throw Error('Only HTTP(S) URLs supported');
  const host=/^(localhost|(?:\d{1,3}\.){3}\d{1,3}|\[[\da-f:]+\])(?::\d+)?(?:[/?#]|$)/i.test(text);
  if(host||/^[^\s/:?#]+\.[^\s/:?#]+(?::\d+)?(?:[/?#]|$)/u.test(text))return new URL((host?'http://':'https://')+text).href;
  if(engine==='auto')return null;
  const engines={baidu:'https://www.baidu.com/s?wd=',google:'https://www.google.com/search?q=',bing:'https://www.bing.com/search?q=',duckduckgo:'https://html.duckduckgo.com/html/?q='};if(!Object.hasOwn(engines,engine))throw Error('Unknown search engine');return engines[engine]+encodeURIComponent(text);
 }
 function shortcut(input){
  if(input.isComposing||input.keyCode===229||input.code==='Process')return null;
  const key=String(input.key||'').toLowerCase(),ctrl=input.control||input.ctrlKey||input.meta||input.metaKey,alt=input.alt||input.altKey,shift=input.shift||input.shiftKey;
  if(ctrl&&!alt){
   if(key==='tab'||key==='pagedown'||key==='pageup')return (key==='pageup'||shift)?'previous_tab':'next_tab';
   if(/^[1-9]$/.test(key))return 'tab_'+key;
   return {l:'address',t:'new_tab',w:'close',d:'bookmark_toggle',r:'reload',j:'downloads',f:'find_in_page'}[key]||null;
  }
  if(alt)return {arrowleft:'back',arrowright:'forward'}[key]||null;
  return {f5:'reload',escape:'stop',f3:shift?'find_previous':'find_next'}[key]||null;
 }
 function keySpec(value){
  if(typeof value!=='string'||value.length>80)throw Error('Unsupported key');
  const parts=value.split('+'),raw=parts.pop(),aliases={Ctrl:'Control',Cmd:'Meta',Command:'Meta',Option:'Alt'},modifiers={Alt:1,Control:2,Meta:4,Shift:8};let mask=0;
  for(const part of parts){const bit=modifiers[aliases[part]||part];if(!bit||mask&bit)throw Error('Unsupported key modifier');mask|=bit;}
  const named={Enter:[13,'Enter'],Tab:[9,'Tab'],Escape:[27,'Escape'],ArrowLeft:[37,'ArrowLeft'],ArrowUp:[38,'ArrowUp'],ArrowRight:[39,'ArrowRight'],ArrowDown:[40,'ArrowDown'],Home:[36,'Home'],End:[35,'End'],PageUp:[33,'PageUp'],PageDown:[34,'PageDown'],Backspace:[8,'Backspace'],Delete:[46,'Delete'],Space:[32,'Space']};
  const pair=named[raw]||(/^[a-z0-9]$/i.test(raw)?[raw.toUpperCase().charCodeAt(0),/^[a-z]$/i.test(raw)?'Key'+raw.toUpperCase():'Digit'+raw]:null);
  if(!pair)throw Error('Unsupported key');
  return {key:raw==='Space'?' ':raw,code:pair[1],windowsVirtualKeyCode:pair[0],modifiers:mask};
 }
 const api={address,shortcut,keySpec};if(typeof module==='object'&&module.exports)module.exports=api;else root.aieyraBrowserNavigation=api;
})(globalThis);
