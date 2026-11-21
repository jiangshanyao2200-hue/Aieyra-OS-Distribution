"use strict";

const PRODUCT_IDENTITY_VERSION = 1;

const CURRENT_PRODUCT_IDENTITY = Object.freeze({
  productName: "Aieyra Workspace",
  displayName: "Aieyra Workspace",
  slug: "aieyra-workspace",
  packageName: "@aieyra/aieyra-workspace",
  applicationId: "cn.aieyra.workspace",
  windowsInstallerGuid: "64ec3036-09a8-5a55-9638-9deebcde300a",
  accountPartition: "persist:aieyra-workspace-account-v2",
  releaseProduct: "aieyra-workspace",
  downloadPathPrefix: "/downloads/aieyra-workspace/",
  userDataDirectoryName: "Aieyra Workspace",
  setupArtifactPrefix: "Aieyra-Workspace-Setup-",
  restartArtifactPrefix: "Aieyra-Workspace-Restart-Update-"
});

// These values are migration inputs only. They must never be used to name a
// new window, package, repository, installer, shortcut, release or user-data
// root. Frozen historical release documents may still quote them verbatim.
const LEGACY_PRODUCT_IDENTITIES = Object.freeze([
  Object.freeze({
    productName: "iiimage Studio",
    slug: "iiimage-studio",
    packageName: "@aieyra/iiimage-studio",
    applicationId: "cn.aieyra.iiimage-studio",
    windowsInstallerGuid: "887890c3-49de-5e86-9a32-28781d680b7f",
    accountPartition: "persist:iiimage-aieyra-account-v1",
    releaseProduct: "iiimage-studio",
    downloadPathPrefix: "/downloads/iiimage-studio/",
    userDataDirectoryName: "iiimage Studio",
    setupArtifactPrefix: "iiimage-Studio-Setup-",
    restartArtifactPrefix: "iiimage-Studio-Restart-Update-"
  })
]);

// This spelling was emitted by an earlier local development shell. It is a
// read-only migration audit input only: it must never become a current
// package, window, installer, shortcut, release or user-facing label.
const TRANSITIONAL_PRODUCT_IDENTITIES = Object.freeze([
  Object.freeze({
    productName: "Aieyra WorkSpace",
    userDataDirectoryName: "Aieyra WorkSpace"
  })
]);

function normalizeProductIdentityText(value) {
  return String(value || "").trim().toLowerCase();
}

function isCurrentOrLegacyReleaseProduct(value) {
  const normalized = normalizeProductIdentityText(value);
  return normalized === CURRENT_PRODUCT_IDENTITY.releaseProduct
    || LEGACY_PRODUCT_IDENTITIES.some((identity) => normalized === identity.releaseProduct);
}

function isCurrentOrLegacyManagedTokenName(value) {
  const normalized = normalizeProductIdentityText(value);
  if (normalized === CURRENT_PRODUCT_IDENTITY.productName.toLowerCase()) return true;
  return LEGACY_PRODUCT_IDENTITIES.some((identity) => {
    const legacyName = identity.productName.toLowerCase();
    return normalized === legacyName || normalized === `${legacyName} desktop`;
  });
}

module.exports = {
  CURRENT_PRODUCT_IDENTITY,
  LEGACY_PRODUCT_IDENTITIES,
  TRANSITIONAL_PRODUCT_IDENTITIES,
  PRODUCT_IDENTITY_VERSION,
  isCurrentOrLegacyManagedTokenName,
  isCurrentOrLegacyReleaseProduct
};
