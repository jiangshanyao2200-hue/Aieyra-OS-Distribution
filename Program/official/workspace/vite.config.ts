import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const WRITING_TEMPLATE_REGISTRY_VIRTUAL_PREFIX = "\0aieyra-writing-template-registry/";
const WRITING_TEMPLATE_REGISTRY_MODULES = {
    workbench: "virtual:aieyra-writing-template-registry/workbench"
} as const;
function writingTemplateRegistryProjectionPlugin(): Plugin {
    const registryPath = fileURLToPath(new URL("./shared/config/writing-template-registry.json", import.meta.url));
    const canvasRoleOrder = ["writing-request", "world-building", "outline", "character-list", "character-state", "chapter", "review", "document"];
    const projection = (registry: any) => {
        return {
            templates: registry.templates.map(({ id, label, placeholder, canvasRoles, kinds }: any) => ({
                id,
                label,
                requestPlaceholder: placeholder,
                roleMask: canvasRoles.reduce((mask: number, role: string) => mask | (1 << canvasRoleOrder.indexOf(role)), 0),
                kinds: Object.fromEntries(Object.entries(kinds).map(([artifactKind, value]: any) => [artifactKind, {
                        label: value.label,
                        short: value.short
                    }]))
            }))
        };
    };
    return {
        name: "aieyra-writing-template-registry-projections",
        resolveId(source) {
            const match = Object.entries(WRITING_TEMPLATE_REGISTRY_MODULES).find(([, moduleId]) => moduleId === source);
            return match ? `${WRITING_TEMPLATE_REGISTRY_VIRTUAL_PREFIX}${match[0]}` : undefined;
        },
        load(id) {
            if (!id.startsWith(WRITING_TEMPLATE_REGISTRY_VIRTUAL_PREFIX))
                return undefined;
            const kind = id.slice(WRITING_TEMPLATE_REGISTRY_VIRTUAL_PREFIX.length) as keyof typeof WRITING_TEMPLATE_REGISTRY_MODULES;
            if (!(kind in WRITING_TEMPLATE_REGISTRY_MODULES))
                return undefined;
            this.addWatchFile(registryPath);
            const registry = JSON.parse(readFileSync(registryPath, "utf8"));
            return `export default ${JSON.stringify(projection(registry))};`;
        }
    };
}
const studioIconPlugin: Plugin = {
    name: "aieyra-workspace-build-icon",
    apply: "build" as const,
    buildStart() {
        this.emitFile({
            type: "asset",
            fileName: "aieyra-workspace.png",
            source: readFileSync(new URL("./public/aieyra-workspace.png", import.meta.url))
        });
    }
};
// Chromium loads the packaged renderer from an ASAR file:// origin. An empty
// crossorigin attribute on Vite's module and modulepreload tags makes that
// origin go through a CORS fetch in the packaged window, which can leave the
// boot shell in place without surfacing a renderer exception. Keep the
// generated HTML compatible with Electron's local file origin.
const electronFileProtocolPlugin: Plugin = {
    name: "aieyra-electron-file-protocol",
    transformIndexHtml(html) {
        return html.replace(/\s+crossorigin(?:="")?/g, "");
    }
};
function moduleHostPlugin(): Plugin {
    const shared: Record<string, {
        slot: string;
        names: string[];
        default?: boolean;
    }> = {
        "react": { slot: "react", default: true, names: ["Children", "Component", "Fragment", "Profiler", "PureComponent", "StrictMode", "Suspense", "cloneElement", "createContext", "createElement", "createFactory", "createRef", "forwardRef", "isValidElement", "lazy", "memo", "startTransition", "useCallback", "useContext", "useDebugValue", "useDeferredValue", "useEffect", "useId", "useImperativeHandle", "useInsertionEffect", "useLayoutEffect", "useMemo", "useReducer", "useRef", "useState", "useSyncExternalStore", "useTransition", "version"] },
        "react/jsx-runtime": { slot: "jsx", names: ["jsx", "jsxs", "Fragment"] },
        "react-dom": { slot: "reactDom", names: ["createPortal", "flushSync"] },
        "ui": { slot: "ui", names: ["ErrorBoundary", "SurfaceDock", "DialogShell", "DrawerShell", "SurfaceHeader", "SurfaceBody", "SurfaceFooter", "SurfaceSection", "Field", "CheckboxControl", "CodeField", "InlineNotice", "StatusLine", "ButtonBase", "MenuItem", "MenuSeparator", "MenuSummary", "MenuGroup", "ActionButton", "IconActionButton", "SegmentedControl", "SegmentButton", "SearchField", "MenuSurface", "OverflowTooltipLayer", "useFloatingDialogInteractions"] },
        "canvas-platform": { slot: "canvasPlatform", names: ["CanvasPlatformBackdrop", "CanvasPlatformFooter", "CanvasPlatformEmptyState", "useArtifactWorkflowCommit"] },
        "canvas-platform-viewport": { slot: "viewport", names: ["CANVAS_PLATFORM_MIN_SCALE", "CANVAS_PLATFORM_MAX_SCALE", "CANVAS_PLATFORM_ZOOM_FACTOR", "CANVAS_PLATFORM_ZOOM_OUT_FACTOR", "CANVAS_PLATFORM_OVERVIEW_SCALE", "CANVAS_PLATFORM_DETAIL_SCALE", "clampCanvasPlatformScale", "normalizeCanvasPlatformViewport", "canvasPlatformRectIsRendered", "canvasPlatformContainmentDelta", "completeArtifactWorkflowLayout", "canvasPlatformArtifactWorkflowNodeSize", "canvasPlatformMoveArtifactWorkflowNode", "canvasPlatformArtifactWorkflowBounds", "isPristineArtifactWorkflowViewport", "rebaseArtifactWorkflowViewportForResize", "alignCanvasPlatformViewportForRender", "canvasPlatformViewportTransform", "canvasPlatformClarityBand", "canvasPlatformWorldPoint", "canvasPlatformViewportAtPoint", "canvasPlatformViewportFromFactor", "canvasPlatformViewportFromWheel", "canvasPlatformFitViewport", "rebaseCanvasPlatformViewportForResize", "observeCanvasPlatformResizeRebase", "canvasPlatformBoundsFromRectangles"] },
        "artifact-workflow-canvas": { slot: "artifactCanvas", names: ["ArtifactWorkflowCanvas"] },
        "../workspace-references.mjs": { slot: "references", names: ["workspaceReferenceCode", "workspaceMentionTokens", "writingReferenceCandidates", "resolveWorkspaceReferences", "workspaceReferenceError"] },
        "image-mention-context": { slot: "mentions", names: ["ImageMentionContext", "renderImageMentions"] }
    };
    return { name: "aieyra-module-host", enforce: "pre",
        resolveId(source) { const key = source.startsWith("./") ? source.slice(2) : source; return key in shared ? "\0module-host/" + key : undefined; },
        load(id) { if (!id.startsWith("\0module-host/"))
            return; const spec = shared[id.slice(13)]; if (!spec)
            return; return `const host=window.__aieyraModuleHost.${spec.slot};` + spec.names.map(name => `export const ${name}=host.${name};`).join("") + (spec.default ? "export default host;" : ""); }
    };
}
export default defineConfig(({ command, mode }) => ({
    base: "./",
    plugins: [...(mode === "writing-module" ? [moduleHostPlugin()] : []), writingTemplateRegistryProjectionPlugin(), react(), studioIconPlugin, electronFileProtocolPlugin],
    define: {
        __AIEYRA_DEV__: JSON.stringify(command === "serve"),
        __AIEYRA_PERF_PROBE__: JSON.stringify(command === "build" && mode === "performance")
    },
    build: {
        ...(mode === "writing-module" ? { lib: { entry: fileURLToPath(new URL("./src/writing-workbench.tsx", import.meta.url)), formats: ["es" as const], fileName: () => "workbench.js", cssFileName: "style" } } : {}),
        copyPublicDir: false,
        cssTarget: "chrome142",
        cssMinify: "lightningcss",
        minify: "terser",
        terserOptions: {
            maxWorkers: 1,
            ecma: 2020,
            module: true,
            toplevel: true,
            compress: {
                passes: 6,
                hoist_funs: true,
                drop_console: true,
                drop_debugger: true,
                // Three.js constructs local factory functions with `new`. Converting
                // them to arrows breaks WebGLRenderer only in the production build.
                unsafe_arrows: false
            },
            mangle: {
                toplevel: true
            },
            format: {
                comments: false
            }
        },
        rolldownOptions: {
            output: {
                // Runtime bytes are signed by the Program manifest. Keep the
                // document dependency chunk's exact public reviews at one path.
                entryFileNames: "assets/[name].js",
                chunkFileNames: chunk => chunk.name === "studio" ? "assets/studio.js" : "assets/[name]-[hash].js"
            }
        }
    },
    server: {
        host: "127.0.0.1",
        port: 5173,
        strictPort: true,
        watch: {
            // Generated installer binaries are not renderer source and may be held
            // open by the local installer/smoke flow. Excluding them keeps a Vite
            // watcher error from tearing down an otherwise healthy development run.
            ignored: ["**/.diagnostics/**", "**/.release-tools/**", "**/release/**", "**/config/**", "**/output/**", "**/dist/**", "**/tools/windows-installer/**"]
        }
    }
}));
