// Shared by the browser renderer and Electron's Node 24 runtime.
const clamp = (value, min, max, fallback) => Number.isFinite(Number(value))
  ? Math.max(min, Math.min(max, Math.round(Number(value)))) : fallback;

export function modelRequestPolicy(settings = {}) {
  const legacyDefault = !settings.requestPolicyVersion && [90, 180].includes(Number(settings.timeoutSeconds));
  return {
    timeoutSeconds: legacyDefault ? 600 : clamp(settings.timeoutSeconds ?? 600, 15, 7200, 600),
    modelMaxRetries: clamp(settings.modelMaxRetries ?? 4, 0, 6, 4),
    requestPolicyVersion: 1
  };
}
