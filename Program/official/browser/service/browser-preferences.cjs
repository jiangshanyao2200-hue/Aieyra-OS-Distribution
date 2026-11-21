'use strict';
const fs=require('node:fs'),path=require('node:path');
const ENGINES=Object.freeze({baidu:'https://www.baidu.com/s?wd=',google:'https://www.google.com/search?q=',bing:'https://www.bing.com/search?q=',duckduckgo:'https://html.duckduckgo.com/html/?q='});
const SELECTORS=Object.freeze({baidu:'#content_left h3 a',google:'#search h3',bing:'#b_results .b_algo h2 a',duckduckgo:'.result__a'});
const reachableErrors=new Set(['ERR_NAME_NOT_RESOLVED','ERR_CONNECTION_TIMED_OUT','ERR_CONNECTION_REFUSED','ERR_CONNECTION_RESET','ERR_ADDRESS_UNREACHABLE','ERR_INTERNET_DISCONNECTED','ERR_PROXY_CONNECTION_FAILED','ERR_TUNNEL_CONNECTION_FAILED','ERR_TIMED_OUT','browser_search_timeout']);
async function searchEngines(query,choice,navigate,wait){
 if(typeof query!=='string'||!query.trim()||query.length>2000)throw Error('Invalid search query');
 if(choice!=='auto'&&!Object.hasOwn(ENGINES,choice))throw Error('Unknown search engine');
 const attempts=[];
 for(const engine of choice==='auto'?['google','baidu']:[choice]){
  const receipt={engine,state:'reached'};attempts.push(receipt);
  let page;
  try{page=await navigate(ENGINES[engine]+encodeURIComponent(query),10000);}
  catch(error){
   const code=error?.code||/^ERR_[A-Z_]+/.exec(error?.message||'')?.[0];
   if(!reachableErrors.has(code))throw error;
   receipt.state='unreachable';receipt.code=code;continue;
  }
  const result=page.dialog?page:await wait(SELECTORS[engine]);
  return {...result,search_engine:engine,results_visible:result.condition_met===true,search_attempts:attempts};
 }
 return {ok:false,error:'search_engines_unreachable',search_engine:attempts.at(-1).engine,results_visible:false,search_attempts:attempts};
}
const DEFAULT_NEW_TAB='https://www.baidu.com/';
const validProfile=id=>typeof id==='string'&&/^[a-z0-9_-]{1,48}$/.test(id)&&id!=='aieyra-account';
function homepage(value){if(value==='about:blank')return value;const u=new URL(value);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.href.length>4096)throw Error('Invalid browser homepage');return u.href;}
const tabDestination=value=>value==='homepage'?value:homepage(value);
function createBrowserPreferences(storage,{atomicWriteJson,legacyHome}={}){
 const file=path.join(storage,'preferences.json');let state={search_engine:'auto',homepage:DEFAULT_NEW_TAB,new_tab:'homepage'},error='';
 try{const info=fs.lstatSync(file);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)throw Error('invalid preferences');const v=JSON.parse(fs.readFileSync(file,'utf8'));if(v.search_engine!=='auto'&&!Object.hasOwn(ENGINES,v.search_engine))throw Error('invalid search engine');
 const saved=homepage(v.homepage||DEFAULT_NEW_TAB);
 state={search_engine:v.search_engine,homepage:!v.version&&legacyHome&&saved===homepage(legacyHome)?DEFAULT_NEW_TAB:saved,new_tab:!v.version&&v.new_tab===DEFAULT_NEW_TAB?'homepage':tabDestination(v.new_tab??'homepage')};
 }catch(e){if(e.code!=='ENOENT')error='浏览器设置暂不可读，原文件已保留；本次使用默认设置。';}
 return {read:()=>({...state,search_engines:['auto',...Object.keys(ENGINES)],...(error?{error}:{})}),update(value){if(error)throw Error(error);if(!value||Object.keys(value).some(k=>!['search_engine','homepage','new_tab'].includes(k))||value.search_engine!==undefined&&value.search_engine!=='auto'&&!Object.hasOwn(ENGINES,value.search_engine))throw Error('无效的浏览器设置');const next={...state,...value};next.homepage=homepage(next.homepage);next.new_tab=tabDestination(next.new_tab);atomicWriteJson(file,{version:1,...next});state=next;return this.read();},
 cookiePolicy(profile){return {available:validProfile(profile),mode:'retain'};},
 setCookiePolicy(profile,mode){
  if(!validProfile(profile)||mode!=='retain')throw Error('Cookie 自动保存，清理请使用浏览器菜单');
  return this.cookiePolicy(profile);
 }};
}
module.exports={createBrowserPreferences,ENGINES,searchEngines};
