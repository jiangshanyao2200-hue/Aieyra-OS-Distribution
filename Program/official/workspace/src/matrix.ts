export type MatrixReference = { id: string; sourceProjectId: string; sourceProjectName: string; sourceNodeIds: string[]; title: string; snapshotPath?: string; count: number; signature: string; revision: number };
export type MatrixTransfer = { sourceProjectId: string; targetProjectId: string; nodeIds: string[]; mode?: "copy" | "move" };
export type MatrixResult = { ok: boolean; error?: string; copied?: boolean; moved?: boolean; nodeIds?: string[]; reference?: MatrixReference; references?: MatrixReference[]; css?: string; [key: string]: unknown };
declare global {
  interface Window {
    aieyraMatrix: {
      workspace(payload?: {canvasProjectId?:string;matrixProjectId?:string}): Promise<{ok:boolean;error?:string;configured?:boolean;projectId?:string;conversationId?:string;canvasProjectId?:string;projects?:import("./core").ProjectRecord[]}>;
      tools(payload: {projectId: string; conversationId: string; query?: string; category?: string; offset?: number; limit?: number}): Promise<{ok: boolean; error?: string; tools?: Array<{name:string;description:string}>; total?:number; matched?:number; nextOffset?:number|null}>;
      execute(payload: { projectId: string; conversationId: string; name: string; arguments: Record<string, unknown> }): Promise<MatrixResult>;
      transfer(payload: MatrixTransfer): Promise<MatrixResult>;
      references(payload: { projectId: string }): Promise<MatrixResult>;
      styles(): Promise<MatrixResult>;
      onRequest(handler: (request: { action: string; args: Record<string, any>; scope?: {projectId?:string;conversationId?:string;canvasProjectId?:string} }) => Promise<unknown>): () => void;
      onChanged(handler: (event: { kind: string; projectIds?: string[]; projectId?: string; id?: string; reload?: boolean }) => void): () => void;
    };
  }
}
