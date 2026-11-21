/* @file-map:start
文件: link/desktop/ui/connection.mjs
位置: 一环·完整界面模块 | 共享界面模块与页面渲染；workspace.mjs负责页面编排与业务事件。
约束: 优先复用controls、Surfaces、detail-view、native-overlays和既有设计变量；异步更新核对generation/epoch；账号变化释放旧DOM、草稿与定时器
下游: 无已解析的项目内静态导入
上游: link/desktop/ui/development.mjs, link/desktop/ui/workspace.mjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: node --test AIDEBUG/controls.test.mjs, AIDEBUG/live-review.cjs, link/DOCS/AIDEBUG-LIVE.md
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  connectionMessage | function
  homeRetryDelay | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
export /* @chain-region connectionMessage | calls: String, test, includes, message.slice */ function connectionMessage(error={}){
 const message=String(error.message||error.error||'');
 if(error.status===401)return '请重新登录';
 if(error.status===403)return '暂无访问权限';
 if(error.code==='account_unavailable'||/账号.*(?:服务|验证|响应)/.test(message))return '账号服务暂不可用';
 if(error.status===429)return /恢复/.test(message)?'连接恢复中':'请求较多，请稍后重试';
 if(error.code==='request_timeout'||/超时/.test(message))return '连接超时';
 if(/连接|fetch|network/i.test(message))return '连接中断';
 if([502,503,504].includes(error.status))return '服务暂不可用';
 return message&&!/[{}\n]/.test(message)?message.slice(0,90):'暂时无法加载';
}

export /* @chain-region homeRetryDelay | calls: Number, Math.random, Math.max */ function homeRetryDelay(error){
 const retry=Number(error.retryAfter)*1000||0;
 // Spread simultaneous homepage reads after the server's earliest retry time.
 return error.status===429?(retry||60000)+Math.random()*10000:Math.max(retry,5000);
}
