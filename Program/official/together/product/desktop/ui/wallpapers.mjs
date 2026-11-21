/* @file-map:start
文件: link/desktop/ui/wallpapers.mjs
位置: 一环·完整界面模块 | 共享界面模块与页面渲染；workspace.mjs负责页面编排与业务事件。
约束: 优先复用controls、Surfaces、detail-view、native-overlays和既有设计变量；异步更新核对generation/epoch；账号变化释放旧DOM、草稿与定时器
下游: 无已解析的项目内静态导入
上游: link/desktop/ui/appearance.mjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: node --test AIDEBUG/controls.test.mjs, AIDEBUG/live-review.cjs, link/DOCS/AIDEBUG-LIVE.md
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
// Shared with the Aieyra OS official website scene catalog.
export const wallpapers=[
  {
    "id": "os-scene-10",
    "url": "https://os.aieyra.cn/backgrounds/scene-10-desktop-1920-023c3436cf0a.webp",
    "thumbnail": "./backgrounds/os-scene-10.webp"
  },
  {
    "id": "os-scene-17",
    "url": "https://os.aieyra.cn/backgrounds/scene-17-desktop-1920-8ea5496b1cc2.webp",
    "thumbnail": "./backgrounds/os-scene-17.webp"
  },
  {
    "id": "os-scene-21",
    "url": "https://os.aieyra.cn/backgrounds/scene-21-desktop-1920-20f55b166376.webp",
    "thumbnail": "./backgrounds/os-scene-21.webp"
  },
  {
    "id": "os-scene-04",
    "url": "https://os.aieyra.cn/backgrounds/scene-04-desktop-1920-ac4cb83b5944.webp",
    "thumbnail": "./backgrounds/os-scene-04.webp"
  },
  {
    "id": "os-scene-08",
    "url": "https://os.aieyra.cn/backgrounds/scene-08-desktop-1920-acfb6dabc2e8.webp",
    "thumbnail": "./backgrounds/os-scene-08.webp"
  },
  {
    "id": "os-scene-12",
    "url": "https://os.aieyra.cn/backgrounds/scene-12-desktop-1920-4ff9eef8a9de.webp",
    "thumbnail": "./backgrounds/os-scene-12.webp"
  },
  {
    "id": "os-scene-18",
    "url": "https://os.aieyra.cn/backgrounds/scene-18-desktop-1920-2a364d803ba1.webp",
    "thumbnail": "./backgrounds/os-scene-18.webp"
  },
  {
    "id": "os-scene-01",
    "url": "https://os.aieyra.cn/backgrounds/scene-01-desktop-1920-99aec5770baf.webp",
    "thumbnail": "./backgrounds/os-scene-01.webp"
  },
  {
    "id": "os-scene-13",
    "url": "https://os.aieyra.cn/backgrounds/scene-13-desktop-1920-660ea77f6aed.webp",
    "thumbnail": "./backgrounds/os-scene-13.webp"
  },
  {
    "id": "os-scene-16",
    "url": "https://os.aieyra.cn/backgrounds/scene-16-desktop-1920-620cd6a4f768.webp",
    "thumbnail": "./backgrounds/os-scene-16.webp"
  },
  {
    "id": "os-scene-11",
    "url": "https://os.aieyra.cn/backgrounds/scene-11-desktop-1920-ea814ea223a4.webp",
    "thumbnail": "./backgrounds/os-scene-11.webp"
  },
  {
    "id": "os-scene-14",
    "url": "https://os.aieyra.cn/backgrounds/scene-14-desktop-1920-86f0e54921e6.webp",
    "thumbnail": "./backgrounds/os-scene-14.webp"
  },
  {
    "id": "os-scene-02",
    "url": "https://os.aieyra.cn/backgrounds/scene-02-desktop-1920-c7efff2c64de.webp",
    "thumbnail": "./backgrounds/os-scene-02.webp"
  },
  {
    "id": "os-scene-15",
    "url": "https://os.aieyra.cn/backgrounds/scene-15-desktop-1920-55c43ec06ed1.webp",
    "thumbnail": "./backgrounds/os-scene-15.webp"
  },
  {
    "id": "os-scene-03",
    "url": "https://os.aieyra.cn/backgrounds/scene-03-desktop-1920-f1382dfcb5af.webp",
    "thumbnail": "./backgrounds/os-scene-03.webp"
  },
  {
    "id": "os-scene-07",
    "url": "https://os.aieyra.cn/backgrounds/scene-07-desktop-1920-43df7154f390.webp",
    "thumbnail": "./backgrounds/os-scene-07.webp"
  },
  {
    "id": "os-scene-19",
    "url": "https://os.aieyra.cn/backgrounds/scene-19-desktop-1920-0538bd01de05.webp",
    "thumbnail": "./backgrounds/os-scene-19.webp"
  },
  {
    "id": "os-scene-09",
    "url": "https://os.aieyra.cn/backgrounds/scene-09-desktop-1920-304e1b055482.webp",
    "thumbnail": "./backgrounds/os-scene-09.webp"
  },
  {
    "id": "os-scene-05",
    "url": "https://os.aieyra.cn/backgrounds/scene-05-desktop-1920-993476b827a0.webp",
    "thumbnail": "./backgrounds/os-scene-05.webp"
  },
  {
    "id": "os-scene-06",
    "url": "https://os.aieyra.cn/backgrounds/scene-06-desktop-1920-de03d15c4cb6.webp",
    "thumbnail": "./backgrounds/os-scene-06.webp"
  },
  {
    "id": "os-scene-20",
    "url": "https://os.aieyra.cn/backgrounds/scene-20-desktop-1920-e0108ec74fe1.webp",
    "thumbnail": "./backgrounds/os-scene-20.webp"
  }
];
