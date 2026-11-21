// 外壳页面的提示框：系统 title 提示不用，统一自绘。浏览器外壳夹着网页视图，提示框画在原生小窗里才不会被压住。
import {setupTooltips,configureTooltips} from '../ui/tooltip.mjs';
setupTooltips(document);
const native=window.aieyraBrowser?.tip;
if(native)configureTooltips(document,{native:()=>native});
