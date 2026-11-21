// The tool owns its readonly snapshot view; the host injects scoped asset reads.
import {activityData} from '../../../../presentation/receipt.mjs';
const live=item=>['queued','running'].includes(item.state);
const failedItem=(item,data)=>['failed','timed_out','interrupted','cancelled'].includes(item.state)||data.ok===false;
const base=path=>String(path||'').split(String.fromCharCode(92)).join('/').split('/').filter(Boolean).pop()||'';
const svgNS='http://www.w3.org/2000/svg';
function icon(doc,d){const svg=doc.createElementNS(svgNS,'svg'),path=doc.createElementNS(svgNS,'path');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');path.setAttribute('d',d);svg.append(path);return svg;}
const EYE='M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12zM12 9.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6z';
export function setupImageView({load,scopeOf,doc,make,activityOutcome}) {
  const images=new Map();
  function loadImage(scope,id,key){
    if(images.has(key))return images.get(key);
    const promise=Promise.resolve().then(()=>load({...scope,image_id:id})).then(r=>{
      if(!r||r.ok===false||r.image_id!==id||!/^image[/](png|jpeg|gif|webp)$/.test(r.mime)||typeof r.data!=='string')throw Error(r?.error?.message||r?.error||'图片快照不可用');
      return 'data:'+r.mime+';base64,'+r.data;
    });
    images.set(key,promise);promise.catch(()=>{if(images.get(key)===promise)images.delete(key);});
    while(images.size>8)images.delete(images.keys().next().value);
    return promise;
  }
  function imageView(p){
    if(p.view)return p.view;
    const view=make('div','image-view'),frame=make('div','image-frame'),img=doc.createElement('img'),lens=make('div','image-lens'),eye=make('span','image-eye'),caption=make('p','image-caption');
    img.alt='';img.decoding='async';frame.append(img);eye.append(icon(doc,EYE));lens.append(eye.cloneNode(true));view.append(frame,lens,eye,caption);
    p.body.replaceChildren(view);p.view={view,img,lens,eye,caption,src:''};
    // 窗口太小（比如三栏并排）时不硬塞整张图，换成"眼睛"：图在圆里慢慢移动。
    if(doc.defaultView.ResizeObserver){const observer=new doc.defaultView.ResizeObserver(([entry])=>{const r=entry.contentRect;view.classList.toggle('compact',r.width<280||r.height<170);});observer.observe(p.body);p.view.observer=observer;}
    return p.view;
  }
  function fillImage(p,items,snapshot,STATES){
    const item=items.at(-1),data=activityData(item),failed=failedItem(item,data);
    const scope=scopeOf(snapshot),id=data.image_id;
    const key=JSON.stringify([snapshot?.core_epoch,scope?.task_id,scope?.agent_id,scope?.generation,id]);
    const signature=JSON.stringify([key,item.key||item.id,item.state,item.revision,items.length]);if(signature===p.signature)return;p.signature=signature;
    const revision=p.imageRevision=(p.imageRevision||0)+1;
    p.state.textContent=live(item)?'正在看':failed?'没看成':data.observation_source==='windows_ocr'?'文字已提取':data.observation_source==='vision_model'?'已转述':items.length>1?'看了 '+items.length+' 张':'看过了';
    p.node.dataset.state=live(item)?'running':failed?'failed':'completed';
    const v=imageView(p),path=data.path||item.targets?.[0]||'';
    if(v.key!==key||live(item)||failed||!id||!scope){v.src='';v.img.removeAttribute('src');v.lens.style.setProperty('--src','none');v.view.classList.remove('arrived');}v.key=key;
    v.view.dataset.state=live(item)?'looking':failed?'failed':'seen';
    v.caption.textContent=failed?activityOutcome(item)||'图片没有读成':[item.title||data.description||base(path),data.width&&data.height?data.width+' × '+data.height:''].filter(Boolean).join(' · ');
    v.caption.title=path;
    if(live(item)||failed||!id||!scope)return;
    loadImage(scope,id,key).then(url=>{
      if(p.suspended||p.imageRevision!==revision)return;
      if(v.src===url)return;v.src=url;v.img.src=url;v.lens.style.setProperty('--src','url("'+url+'")');
      v.view.classList.remove('arrived');void v.view.offsetWidth;v.view.classList.add('arrived');
    },error=>{if(!p.suspended&&p.imageRevision===revision)v.caption.textContent='图片快照读取失败：'+error.message;});
  }

 function suspend(p){p.suspended=true;p.imageRevision=(p.imageRevision||0)+1;if(p.view)p.signature='';p.view?.observer?.disconnect();}
 return {fill(p,...args){if(p.suspended)p.view?.observer?.observe(p.body);p.suspended=false;return fillImage(p,...args);},suspend,close(p){suspend(p);images.clear();}};
}
