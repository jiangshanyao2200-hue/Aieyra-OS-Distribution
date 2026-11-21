"use strict";

const { createHash, randomBytes } = require("node:crypto");
const { renameSync } = require("node:fs");
const path = require("node:path");

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,179}$/;

class DataReportWritingSnapshotError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "DataReportWritingSnapshotError";
    this.code = code;
  }
}

function snapshotFailure(code, message, cause) {
  return new DataReportWritingSnapshotError(code, message, cause);
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function comparablePath(value) {
  const resolved = path.resolve(String(value || ""));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function canonicalDigest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeRequest(value, projectsDir) {
  if (!plainObject(value) || !plainObject(value.source) || !plainObject(value.target)) {
    throw snapshotFailure("REPORT_SNAPSHOT_REQUEST_INVALID", "内部 snapshot 请求缺少 source 或 target identity。");
  }
  const source = value.source;
  const target = value.target;
  const sourceProjectId = String(source.sourceProjectId || "");
  const sourceArtifactId = String(source.sourceArtifactId || "");
  const sourceRevision = Number(source.sourceRevision);
  const sourceArtifactSha256 = String(source.sourceArtifactSha256 || "").toLowerCase();
  const canonicalMarkdownSha256 = String(source.canonicalMarkdownSha256 || "").toLowerCase();
  const requestKey = String(value.requestKey || "").toLowerCase();
  if (
    !SHA256_PATTERN.test(requestKey)
    || !ID_PATTERN.test(sourceProjectId)
    || !ID_PATTERN.test(sourceArtifactId)
    || !Number.isSafeInteger(sourceRevision)
    || sourceRevision < 1
    || !SHA256_PATTERN.test(sourceArtifactSha256)
    || !SHA256_PATTERN.test(canonicalMarkdownSha256)
  ) {
    throw snapshotFailure("REPORT_SNAPSHOT_REQUEST_INVALID", "内部 snapshot 来源 identity 无效。");
  }
  if (
    !ID_PATTERN.test(String(target.id || ""))
    || target.kind !== "writing"
    || typeof target.path !== "string"
    || typeof target.sessionPath !== "string"
    || comparablePath(target.path) !== comparablePath(path.join(projectsDir, target.id))
    || comparablePath(target.sessionPath) !== comparablePath(path.join(target.path, "session.json"))
  ) {
    throw snapshotFailure("REPORT_SNAPSHOT_REQUEST_INVALID", "内部 snapshot Writing 目标 identity 无效。");
  }
  const identity = {
    requestKey,
    source: {
      sourceProjectId,
      sourceArtifactId,
      sourceRevision,
      sourceArtifactSha256,
      canonicalMarkdownSha256
    },
    target: { ...target }
  };
  return { ...identity, requestDigest: canonicalDigest(identity) };
}

function createDataReportWritingSnapshotCoordinator(options = {}) {
  const projectsDir = path.resolve(String(options.projectsDir || ""));
  const importManager = options.importManager;
  if (!options.projectsDir || !importManager) {
    throw snapshotFailure("REPORT_SNAPSHOT_OPTIONS_INVALID", "snapshot coordinator 缺少 projectsDir 或 import manager。");
  }
  for (const callback of ["buildStaging", "validateStaged", "revalidateSource", "findRegisteredMatch", "registerProject", "validatePublished"]) {
    if (typeof options[callback] !== "function") {
      throw snapshotFailure("REPORT_SNAPSHOT_OPTIONS_INVALID", `snapshot coordinator 缺少 ${callback} callback。`);
    }
  }
  const inFlight = new Map();

  function invokeCheckpoint(name, details) {
    if (typeof options.checkpoint === "function") options.checkpoint(name, Object.freeze({ ...details }));
  }

  async function run(identity) {
    const registeredBefore = await options.findRegisteredMatch(identity);
    if (registeredBefore) {
      await options.validatePublished(identity, registeredBefore);
      return { idempotent: true, project: registeredBefore.project, session: registeredBefore.session, transactionId: "" };
    }

    const transactionId = `${process.pid}-${randomBytes(10).toString("hex")}`;
    const stagingPath = path.join(projectsDir, `.iiimage-import-${transactionId}`);
    const finalPath = path.resolve(identity.target.path);
    const transaction = importManager.begin({
      transactionId,
      projectId: identity.target.id,
      projectKind: "writing",
      stagingPath,
      finalPath
    }, { checkpoint: options.checkpoint });
    let registered = null;

    try {
      invokeCheckpoint("before-build-staging", { transactionId, projectId: identity.target.id });
      await options.buildStaging(identity, transaction);
      importManager.verifyOwnership(transactionId, "staging");
      await options.validateStaged(identity, transaction);
      invokeCheckpoint("after-staged-readback", { transactionId, projectId: identity.target.id });

      await options.revalidateSource(identity);
      importManager.verifyOwnership(transactionId, "staging");
      invokeCheckpoint("before-publish", { transactionId, projectId: identity.target.id });
      renameSync(stagingPath, finalPath);
      invokeCheckpoint("after-final-rename", { transactionId, projectId: identity.target.id });
      importManager.markPublished(transactionId);
      invokeCheckpoint("after-publish", { transactionId, projectId: identity.target.id });

      const published = await options.validatePublished(identity, { project: identity.target });
      registered = await options.registerProject(identity, published, transactionId);
      invokeCheckpoint("after-register", { transactionId, projectId: identity.target.id });
      const finalReadback = await options.validatePublished(identity, registered);
      importManager.finalize(transactionId, identity.target, registered.projectList, {
        requireRegistration: true,
        checkpoint: options.checkpoint
      });
      invokeCheckpoint("after-finalize", { transactionId, projectId: identity.target.id });
      return {
        idempotent: false,
        project: identity.target,
        session: finalReadback.session,
        transactionId
      };
    } catch (error) {
      if (error?.aieyraProjectImportHardCrash === true) throw error;

      let registeredMatch = registered;
      if (!registeredMatch) {
        try { registeredMatch = await options.findRegisteredMatch(identity); } catch {}
      }
      if (registeredMatch) {
        // Registration is the durable commit point. A cleanup/readback error
        // must not provoke a second project on user retry; startup recovery
        // will preserve the registered final and finish transaction cleanup.
        try {
          const finalReadback = await options.validatePublished(identity, registeredMatch);
          return {
            idempotent: true,
            cleanupPending: true,
            project: registeredMatch.project,
            session: finalReadback.session,
            transactionId
          };
        } catch {
          throw snapshotFailure("REPORT_SNAPSHOT_TRANSACTION_FAILED", "已注册 snapshot 未通过最终严格回读。", error);
        }
      }

      try {
        importManager.rollback(transactionId);
      } catch (rollbackError) {
        throw snapshotFailure("REPORT_SNAPSHOT_ROLLBACK_UNSAFE", "snapshot 失败且 ownership 无法证明，已保留事务现场。", rollbackError);
      }
      throw error;
    }
  }

  function submit(value) {
    const identity = normalizeRequest(value, projectsDir);
    const existing = inFlight.get(identity.requestKey);
    if (existing) {
      // requestKey is derived by Main from the authoritative source identity,
      // canonical Markdown SHA, target name and template. A second renderer
      // click may have allocated a different provisional target record, but it
      // must join the first durable operation instead of creating a duplicate.
      return existing.promise;
    }
    const promise = Promise.resolve().then(() => run(identity));
    const entry = { requestDigest: identity.requestDigest, promise };
    inFlight.set(identity.requestKey, entry);
    promise.finally(() => {
      if (inFlight.get(identity.requestKey) === entry) inFlight.delete(identity.requestKey);
    }).catch(() => undefined);
    return promise;
  }

  function recover(projectList) {
    return importManager.recover(projectList);
  }

  return Object.freeze({ recover, submit, activeCount: () => inFlight.size });
}

module.exports = {
  DataReportWritingSnapshotError,
  createDataReportWritingSnapshotCoordinator
};
