// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Theme/official/AGENTS.md | ring 3
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Theme/official/default/chat-layout-schema.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Shared layout fields for the renderer and settings API.
export default [
  {
    "tab": "people",
    "key": "eyraAvatar",
    "label": "Eyra 头像",
    "min": 100,
    "max": 200,
    "unit": "px",
    "value": 120,
    "css": "--eyra-avatar",
    "step": 0.01
  },
  {
    "tab": "people",
    "key": "eyraName",
    "label": "Eyra 名字字号",
    "min": 10,
    "max": 50,
    "unit": "px",
    "value": 25,
    "css": "--chat-name",
    "step": 0.01
  },
  {
    "tab": "people",
    "key": "userAvatar",
    "label": "你的头像",
    "min": 50,
    "max": 150,
    "unit": "px",
    "value": 80,
    "css": "--user-avatar",
    "step": 0.01
  },
  {
    "tab": "people",
    "key": "userName",
    "label": "你的名字字号",
    "min": 10,
    "max": 50,
    "unit": "px",
    "value": 25,
    "css": "--chat-name-user",
    "step": 0.01
  },
  {
    "tab": "text",
    "key": "textSize",
    "label": "字号",
    "min": 14,
    "max": 20,
    "unit": "px",
    "value": 16,
    "css": "--chat-text",
    "step": 0.01
  },
  {
    "tab": "text",
    "key": "lineHeight",
    "label": "行距",
    "min": 1,
    "max": 2.5,
    "step": 0.01,
    "unit": "",
    "value": 1.3,
    "css": "--chat-leading"
  },
  {
    "tab": "layout",
    "key": "top",
    "label": "顶部留白",
    "min": 0,
    "max": 120,
    "unit": "px",
    "value": 20,
    "css": "--chat-top",
    "step": 0.01
  },
  {
    "tab": "layout",
    "key": "left",
    "label": "左边距（自动）",
    "min": 0,
    "max": 240,
    "unit": "px",
    "value": 60,
    "css": "--chat-left",
    "legacy": true,
    "step": 0.01
  },
  {
    "tab": "layout",
    "key": "right",
    "label": "右边距（自动）",
    "min": 0,
    "max": 240,
    "unit": "px",
    "value": 80,
    "css": "--chat-right",
    "legacy": true,
    "step": 0.01
  },
  {
    "tab": "layout",
    "key": "maxWidth",
    "label": "正文宽度",
    "min": 480,
    "max": 1200,
    "step": 0.01,
    "unit": "px",
    "value": 800,
    "css": "--chat-max"
  },
  {
    "tab": "layout",
    "key": "position",
    "label": "水平位置",
    "min": 0,
    "max": 100,
    "step": 0.01,
    "unit": "%",
    "value": 25,
    "css": "--chat-position"
  },
  {
    "tab": "layout",
    "key": "gap",
    "label": "额外消息间距",
    "min": 0,
    "max": 40,
    "unit": "px",
    "value": 5,
    "css": "--chat-gap",
    "step": 0.01
  },
  {
    "tab": "layout",
    "key": "panelClear",
    "label": "侧栏透明度（旧配置）",
    "legacy": true,
    "min": 0,
    "max": 100,
    "step": 0.01,
    "unit": "%",
    "value": 100,
    "css": "--panel-clear"
  },
  {
    "tab": "ring",
    "key": "ring",
    "label": "工作与其他页面的光圈（沿用头像）",
    "legacy": true,
    "min": 100,
    "max": 200,
    "unit": "px",
    "value": 120,
    "css": "--eyra-ring-size",
    "step": 0.01
  }
];
