"use strict";
// Original document/database operations, sharing the canvas stores and OS renderer.
const path=require("node:path");
module.exports=function createStudioOperations({styleLibrary,studioDocuments,renderer,notify}){
async function studioMatrixOperation(input) {
    const context = await renderer("images.context", {projectId:input.projectId});
    const projectId = input.projectId || context.projectId;
    if (input.domain === "database") {
        if (!context.ok || !projectId || context.projectId !== projectId) throw Error("数据库操作必须使用当前会话所属项目。");
        const library = await styleLibrary.list();
        const records = library.styles.filter(item => !item.projectId || item.projectId === projectId);
        const item = input.id ? records.find(item => item.id === input.id) : null;
        if (input.id && !item) throw Error("数据条目不存在或属于其他项目。");
        if (input.action === "list") {
            const query = String(input.query || "").toLocaleLowerCase();
            return {
                ok: !0,
                revision: library.revision || 0,
                records: records.filter(item => !query || JSON.stringify([ item.name, item.category, item.summary, item.tags ]).toLocaleLowerCase().includes(query)).map(({history: history, descriptor: descriptor, mergedRecords: mergedRecords, ...item}) => item)
            };
        }
        if (input.action === "read") {
            if (!item) throw Error("数据条目不存在。");
            return {
                ok: !0,
                record: item
            };
        }
        if (input.action === "save") {
            const result = await styleLibrary.mutate({
                action: "save-record",
                styleId: input.id,
                projectId: projectId,
                entityKey: input.entityKey,
                files: input.files?.map(file => ({
                    path: file,
                    name: path.basename(file)
                })),
                mergeRecords: input.mergeRecords,
                name: input.name,
                category: input.category,
                descriptor: input.descriptor,
                summary: input.summary,
                tags: input.tags,
                recordRevision: input.recordRevision,
                author: "agent",
                images: input.paths === void 0 ? void 0 : input.paths.map(file => ({
                    name: path.basename(file),
                    asset: {
                        path: file
                    }
                }))
            });
            notify("database", {
                projectId: projectId
            });
            return {
                ok: !0,
                record: input.id ? result.styles.find(r => r.id === input.id) : result.styles.at(-1)
            };
        }
        if (!item) throw Error("数据条目不存在。");
        if (input.action === "delete") {
            if (input.recordRevision !== (item.revision || 1)) throw Error("数据条目已变化，请重新读取。");
            await styleLibrary.mutate({
                action: "delete",
                kind: "style",
                id: item.id,
                expectedRevision: library.revision || 0
            });
            notify("database", {});
            return {
                ok: !0,
                deleted: !0
            };
        }
        if (input.action === "use") {
            const reference = await styleLibrary.reference({
                styleId: item.id,
                projectId: projectId,
                recordRevision: input.recordRevision ?? (item.revision || 1)
            });
            return renderer("database.use", {
                projectId: projectId,
                reference: reference
            });
        }
        throw Error("未知数据库操作。");
    }
    const result = await studioDocuments.run({
        ...input,
        projectId: projectId
    }, "agent");
    result.document && [ "create", "import", "analyze" ].includes(input.action) && await renderer("documents.mount", {
        projectId: projectId,
        document: result.document
    });
    (result.document && ![ "read", "list" ].includes(input.action) || input.action === "delete") && notify("documents", {
        projectId: projectId,
        id: result.document?.id || input.id
    });
    return result;
}

return studioMatrixOperation;
};
