'use strict';

const SETTINGS_SCHEMA = 'aieyra.center-learning-settings/1';
const SUMMARY_SCHEMA = 'aieyra.center-health-summary/1';
const featureSpecs = {
  cpu_percent: { min: 0, max: 100, minSpread: 3, direction: 'high' },
  memory_percent: { min: 0, max: 100, minSpread: 2, direction: 'high' },
  disk_free_percent: { min: 0, max: 100, minSpread: 2, direction: 'low' },
  app_processes: { min: 0, max: 4096, minSpread: 2, direction: 'high' },
  app_resident_mib: { min: 0, max: 1048576, minSpread: 64, direction: 'high' },
  link_attention: { min: 0, max: 64, minSpread: 0.25, direction: 'high' },
  debug_background_failures: { min: 0, max: 4096, minSpread: 0.25, direction: 'high' },
  debug_foreground_failures: { min: 0, max: 4096, minSpread: 0.25, direction: 'high' },
  center_frame_p95_ms: { min: 0, max: 20000, minSpread: 3, direction: 'high' },
  center_raf_hz: { min: 0, max: 1000, minSpread: 3, direction: 'low' },
};
const summarySteps = {
  cpu_percent: 5,
  memory_percent: 5,
  disk_free_percent: 5,
  app_resident_mib: 128,
  center_frame_p95_ms: 5,
  center_raf_hz: 5,
};
const hostPlatforms = new Set(['win32', 'darwin', 'linux', 'freebsd']);
const hostArchitectures = new Set(['x64', 'arm64', 'ia32', 'arm', 'riscv64']);
const summaryModules = new Set(['core', 'browser', 'integrity', 'updates']);

function upperTier(value, tiers) {
  if (!Number.isFinite(value) || value <= 0) return null;
  return tiers.find(tier => value <= tier) ?? 'above_' + tiers.at(-1);
}

function describeEnvironment(host) {
  if (!host) return null;
  const { hardware, operatingSystem } = host;
  const platform = operatingSystem?.platform;
  const release = typeof operatingSystem?.release === 'string' ? operatingSystem.release : '';
  const version = (platform === 'win32' ? /^\d{1,3}\.\d{1,3}(?:\.\d{1,6})?/ : /^\d{1,3}\.\d{1,3}/).exec(release)?.[0];
  const refreshRates = (hardware?.displays ?? []).map(display => display.refreshHz).filter(Number.isFinite);
  return {
    platform: hostPlatforms.has(platform) ? platform : null,
    os_version: version ?? null,
    architecture: hostArchitectures.has(operatingSystem?.architecture) ? operatingSystem.architecture : null,
    cpu_threads_tier: upperTier(hardware?.cpu?.availableParallelism ?? hardware?.cpu?.logicalCores, [2, 4, 8, 16, 32, 64]),
    memory_gib_tier: upperTier(hardware?.memory?.totalBytes / 1073741824, [4, 8, 16, 32, 64, 128]),
    display_refresh_hz_tier: upperTier(Math.max(0, ...refreshRates), [60, 90, 120, 144, 165, 240]),
  };
}

function createHealthSummary({ telemetry, report, buildId, appVersion }) {
  if (!telemetry?.environment || !report?.quality?.fresh) return null;
  const measurements = {};
  for (const [name, step] of Object.entries(summarySteps)) {
    const value = report.features[name]?.last;
    const { min, max } = featureSpecs[name];
    if (Number.isFinite(value) && value >= min && value <= max) {
      measurements[name] = Math.min(max, Math.round(value / step) * step);
    }
  }
  const health = {};
  for (const { id, state } of telemetry.system?.items ?? []) {
    if (summaryModules.has(id) && ['online', 'attention', 'idle', 'unknown'].includes(state)) {
      health[id] = state;
    }
  }
  return {
    schema: SUMMARY_SCHEMA,
    environment: telemetry.environment,
    app_version: /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[a-z0-9.-]{1,24})?$/i.test(appVersion ?? '') ? appVersion : null,
    build_id: /^[a-f0-9]{8,64}$/.test(buildId ?? '') ? buildId : null,
    measurements,
    health,
  };
}

function createLearningSettings({ file, readJson, writeJson }) {
  let pending = Promise.resolve();

  function read() {
    const saved = readJson(file, { maxBytes: 4096 });
    return saved?.status === 'valid' && saved.value?.schema === SETTINGS_SCHEMA && saved.value?.allowed === true;
  }

  function set(allowed) {
    if (typeof allowed !== 'boolean') throw Error('同步选择无效');
    const commit = pending.then(() => writeJson(file, { schema: SETTINGS_SCHEMA, allowed }));
    pending = commit.catch(() => {});
    return commit;
  }

  return { read, set, flush: () => pending };
}

module.exports = { featureSpecs, describeEnvironment, createHealthSummary, createLearningSettings };
