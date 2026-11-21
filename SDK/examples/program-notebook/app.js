'use strict';
const note=document.querySelector('#note'),status=document.querySelector('#status');
note.value=localStorage.getItem('note')||'';
function save(){localStorage.setItem('note',note.value);status.textContent='已保存';}
note.addEventListener('input',save);
globalThis.aieyraProgram={
 snapshot:()=>({text:note.value}),
 invoke(operation,args){if(operation!=='set_text'||typeof args?.text!=='string'||args.text.length>16000)throw Error('需要不超过 16000 字符的便签内容');note.value=args.text;save();return {text:note.value};}
};
