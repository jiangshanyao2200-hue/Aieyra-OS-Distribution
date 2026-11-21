"use strict";

const projectCapabilityRegistry = require("../../shared/config/project-capabilities.json");

const projectCapabilitiesByKind = new Map(
  (Array.isArray(projectCapabilityRegistry.projects) ? projectCapabilityRegistry.projects : [])
    .filter((capability) => capability && typeof capability.kind === "string")
    .map((capability) => [capability.kind.trim().toLowerCase(), capability])
);

const PROJECT_SURFACES = Object.freeze(["public", "development"]);

function normalizedProjectSurface(value) {
  return String(value || "").trim().toLowerCase() === "development" ? "development" : "public";
}

function resolveProjectSurface(options = {}) {
  // Packaged builds are always the public product. Development capabilities
  // require both an unpackaged runtime and an explicit opt-in so a stale
  // shell environment can never turn them into an accidental release feature.
  if (options.isPackaged === true) return "public";
  return normalizedProjectSurface(options.requested);
}

function projectCapabilityIsAvailable(capability) {
  return Boolean(capability) && capability.status === "available";
}

function projectCapabilityIsVisible(capability, surface = "public") {
  if (!projectCapabilityIsAvailable(capability)) return false;
  const visibility = capability.releaseVisibility;
  if (!new Set(["public", "development"]).has(visibility)) return false;
  return visibility === "public" || normalizedProjectSurface(surface) === "development";
}

function normalizedProjectKind(value, persistedQuarantine = null) {
  const rawKind = typeof value === "string" ? value.trim() : "";
  const migratedLegacyKind = !rawKind;
  const requested = (rawKind || "image").toLowerCase();
  const capability = projectCapabilitiesByKind.get(requested);

  if (!capability) {
    const originalKind = migratedLegacyKind ? "image" : rawKind;
    return {
      // Unknown non-empty kinds are opaque data. Preserve the exact persisted
      // value and never downgrade it to image: doing so would route the
      // session through an unrelated saver and irreversibly remove artifacts.
      kind: originalKind,
      supportedKind: null,
      quarantine: {
        originalKind,
        reason: migratedLegacyKind ? "capability-disabled" : "unknown-project-kind",
        readOnly: true
      },
      migratedLegacyKind
    };
  }

  if (!migratedLegacyKind && ["unknown-kind", "unknown-project-kind"].includes(persistedQuarantine?.reason) && persistedQuarantine?.originalKind) {
    const originalKind = String(persistedQuarantine.originalKind).trim() || rawKind;
    return {
      kind: originalKind,
      supportedKind: null,
      quarantine: {
        originalKind,
        reason: "unknown-project-kind",
        readOnly: true
      },
      migratedLegacyKind: false
    };
  }

  if (!projectCapabilityIsAvailable(capability)) {
    return {
      kind: requested,
      supportedKind: requested,
      quarantine: { originalKind: requested, reason: "capability-disabled", readOnly: true },
      migratedLegacyKind
    };
  }

  return { kind: requested, supportedKind: requested, quarantine: null, migratedLegacyKind };
}

function projectCreationCapability(value, options = {}) {
  const requested = typeof value === "string" ? value.trim().toLowerCase() : "image";
  const capability = projectCapabilitiesByKind.get(requested);
  if (!capability) return { ok: false, error: "未知的项目类型，已停止创建。" };
  if (!projectCapabilityIsAvailable(capability)) {
    return { ok: false, error: `${capability.label}仍在开发中，完整工作流交付后才可创建。`, capability };
  }
  const surface = normalizedProjectSurface(options.surface);
  if (!projectCapabilityIsVisible(capability, surface)) {
    return { ok: false, error: `${capability.label}未在当前产品版本开放。`, capability, surface };
  }
  return { ok: true, capability, surface };
}

module.exports = {
  PROJECT_SURFACES,
  normalizedProjectKind,
  normalizedProjectSurface,
  projectCapabilitiesByKind,
  projectCapabilityIsAvailable,
  projectCapabilityIsVisible,
  projectCapabilityRegistry,
  projectCreationCapability,
  resolveProjectSurface
};
