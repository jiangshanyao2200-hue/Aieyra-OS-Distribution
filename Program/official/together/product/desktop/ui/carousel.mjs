/* @file-map:start
文件: link/desktop/ui/carousel.mjs
位置: 一环·完整界面模块 | 共享界面模块与页面渲染；workspace.mjs负责页面编排与业务事件。
约束: 优先复用controls、Surfaces、detail-view、native-overlays和既有设计变量；异步更新核对generation/epoch；账号变化释放旧DOM、草稿与定时器
下游: link/desktop/ui/icons.mjs, link/desktop/ui/markdown.mjs
上游: link/desktop/ui/workspace.mjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: node --test AIDEBUG/controls.test.mjs, AIDEBUG/live-review.cjs, link/DOCS/AIDEBUG-LIVE.md
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  carouselControls | function
  Carousel | class
  Carousel.constructor | method
  Carousel.set | method
  Carousel.action | method
  Carousel.tick | method
  Carousel.paint | method
  Carousel.clear | method
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
import {escape as e} from './markdown.mjs';
import {icon} from './icons.mjs';
export const /* @chain-region carouselControls | calls: icon */ carouselControls=(name)=>`<div class="carousel-controls" data-carousel-controls="${name}"><button data-carousel="${name}:prev" aria-label="上一条">${icon('back')}</button><button data-carousel="${name}:pause" aria-label="暂停轮播" aria-pressed="false">${icon('pause')}</button><span class="carousel-position"></span><button data-carousel="${name}:next" aria-label="下一条">${icon('arrow')}</button></div>`;
export /* @chain-region Carousel */ class Carousel {
  /* @chain-region Carousel.constructor | calls: matchMedia, setInterval, tick */ constructor(name,selector,interval=9000){this.name=name;this.selector=selector;this.interval=interval;this.items=[];this.index=0;this.paused=false;this.until=0;this.motion=matchMedia('(prefers-reduced-motion: reduce)');this.timer=setInterval(()=>this.tick(),1000);}
  /* @chain-region Carousel.set | calls: items.findIndex, paint */ set(items){const key=this.items[this.index]?.key;this.items=items;const found=items.findIndex(i=>i.key===key);this.index=found<0?0:found;this.paint();}
  /* @chain-region Carousel.action | calls: Date.now, paint */ action(action){if(!this.items.length)return;if(action==='pause')this.paused=!this.paused;else this.index=(this.index+(action==='next'?1:-1)+this.items.length)%this.items.length;this.until=Date.now()+this.interval;this.paint();}
  /* @chain-region Carousel.tick | calls: document.querySelector, root.closest, area.matches, area.contains, document.activeElement.matches, Date.now, action */ tick(){const root=document.querySelector(this.selector);if(!root||document.hidden||document.querySelector('dialog[open]')||this.motion.matches||this.paused||this.items.length<2)return;
    const area=root.closest('[data-carousel-area]')||root;
    if(area.matches(':hover')||area.contains(document.activeElement)||document.activeElement?.matches('input,textarea,[contenteditable=true]')){this.until=Date.now()+this.interval;return;}
    if(Date.now()<this.until)return;this.action('next');}
  /* @chain-region Carousel.paint | calls: document.querySelector, root.replaceChildren, e, animation.cancel, root.animate, Date.now, controls.querySelector, button.setAttribute … */ paint(){const root=document.querySelector(this.selector),item=this.items[this.index];if(!root)return;if(!item){root.replaceChildren();return;}
    const html=item.html||e(item.text);if(root.__slide!==html){root.__slide=html;root.innerHTML=html;
      if(!this.motion.matches&&document.documentElement.dataset.motion!=='reduced'){this.animation?.cancel();this.animation=root.animate([{opacity:0,transform:'translateY(12px)',filter:'blur(3px)'},{opacity:1,transform:'translateY(0)',filter:'blur(0)'}],{duration:650,easing:'cubic-bezier(.16,1,.3,1)'});}}
    if(!this.until)this.until=Date.now()+this.interval;
    const controls=document.querySelector(`[data-carousel-controls="${this.name}"]`);if(!controls)return;
    controls.hidden=this.items.length<2;controls.querySelector('.carousel-position').textContent=`${this.index+1} / ${this.items.length}`;
    const button=controls.querySelector('[data-carousel$=":pause"]');button.setAttribute('aria-pressed',String(this.paused));button.setAttribute('aria-label',this.paused?'继续轮播':'暂停轮播');button.innerHTML=icon(this.paused?'play':'pause');
  }
  /* @chain-region Carousel.clear */ clear(){this.items=[];this.index=0;this.paused=false;this.until=0;}
}
