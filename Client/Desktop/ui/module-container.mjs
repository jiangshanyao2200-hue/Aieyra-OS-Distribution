// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: mountContainer
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/module-container.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {setupNavigation} from './navigation.mjs';
import {setupBrowser} from './browser.mjs';
import {setupControl} from './control.mjs';
import {setupSettingsPage} from './settings-page.mjs';
import {setupModulePage} from './module-page.mjs';
import {setupModuleDock} from './module-dock.mjs';
import {setupContacts} from './contacts.mjs';
import {setupAppPages} from './app-pages.mjs';
import {setupExitAsk} from './exit-ask.mjs';
import {subscribeWindowTheme} from './window-theme.mjs';
// This shell is revealed only while the one home renderer is in its own window.
// It never bootstraps a chat, greets, writes a composer draft or owns model work.
export async function mountContainer(api){
 document.body.classList.add('module-container','awakened');
 const $=id=>document.getElementById(id),navigation=setupNavigation();let active=false;
 const notice=text=>{$('notice').hidden=false;$('notice').textContent=text;};
 const check=r=>{if(r?.ok===false)throw Error(r.error);return r;};
 const theme=subscribeWindowTheme(api,document.body);await theme.refresh();
 const contacts=setupContacts(api,navigation,{onError:notice});
 const browser=setupBrowser(api,navigation),control=setupControl(api,navigation),settings=setupSettingsPage(api,navigation,{onError:notice});
 const contactsPage=setupModulePage(api,navigation,{key:'contacts',title:'联系人',onError:notice}),appPages=setupAppPages(api,navigation,{onError:notice});
 const placeholder=document.createElement('section');placeholder.id='module-placeholder';
 const message=document.createElement('p');message.textContent='Eyra 已在独立窗口打开';const focus=document.createElement('button');focus.className='quiet';focus.textContent='打开 Eyra';focus.onclick=()=>void api.moduleAction({module:'home',action:'open'}).then(check).catch(e=>notice(e.message));placeholder.append(message,focus);document.body.append(placeholder);
 const navigate=async({page})=>{if(!active)return;if(page==='home'){navigation.home();}else if(page==='browser'){if(!navigation.is('browser-view'))$('browser-bubble').click();}else if(page==='contacts')await contactsPage.open();else if(appPages.has(page))await appPages.open(page);else if(page==='settings')await settings.open();else if(page==='link'||page==='control')await control.open({toggle:false});};
 api.onNavigate(p=>void navigate(p).catch(e=>notice(e.message)));
 api.onModuleState(s=>{active=s.modules?.home?.detached===true;if(!active)navigation.home();});
 document.addEventListener('workspace-view-change',()=>{placeholder.hidden=!!navigation.current;document.body.dataset.desktopPage=navigation.current||'home';});
 $('dock-home').onclick=()=>focus.click();$('dock-contacts').onclick=()=>void contactsPage.open();$('api-bubble').onclick=()=>void settings.open();$('dock-link').onclick=()=>void api.openLinkApp();
 setupModuleDock(api,{tabs:{home:$('dock-home'),browser:$('browser-bubble'),contacts:$('dock-contacts'),settings:$('api-bubble'),link:$('dock-link'),...appPages.tabs},current:()=>document.body.dataset.desktopPage,goHome:()=>navigation.home(),onError:notice});
 setupExitAsk(api);
 for(const [id,method]of [['minimize-window','minimizeWindow'],['maximize-window','toggleMaximize'],['close-window','closeWindow']])$(id).onclick=()=>void api[method]().then(check).catch(e=>notice(e.message));
 active=(await api.moduleState()).modules?.home?.detached===true;
 window.addEventListener('beforeunload',()=>{theme.close();contacts.close();contactsPage.close();appPages.close();browser.close();control.close();settings.close();},{once:true});
}
