export const MINIMUM_NODE_VERSION = '22.20.0';

function parseNodeVersion(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  const parts = match.slice(1, 4).map(Number);
  if (!parts.every(Number.isSafeInteger)) return null;
  return { parts, prerelease: Boolean(match[4]) };
}

export function nodeVersionFailure(value = process.versions.node) {
  const current = parseNodeVersion(value);
  const minimum = [22, 20, 0];
  const comparison = current
    ? current.parts.findIndex((part, index) => part !== minimum[index])
    : -1;
  const supported = current && !current.prerelease && (
    comparison === -1 || (comparison >= 0 && current.parts[comparison] > minimum[comparison])
  );
  if (supported) return null;
  return `Unsupported Node.js version ${String(value)}; AKE requires Node.js >=${MINIMUM_NODE_VERSION}. Upgrade the Node.js runtime used by AKE and rerun. No AKE operation was started.`;
}

export function nodeVersionIsSupported(value = process.versions.node) {
  return nodeVersionFailure(value) === null;
}

export function updateVersionFailure(message, { dryRun = false } = {}) {
  return {
    status: 'failed',
    stage: 'preflight',
    errorCode: 'NODE_VERSION',
    message,
    dryRun,
    installationBefore: null,
    installationAfter: null,
    sourceUrl: null,
    defaultBranch: null,
    oldCommit: null,
    targetCommit: null,
    customization: null,
    baseline: null,
    backupPath: null,
    rollback: 'not_needed',
    warnings: [],
    initiatedBy: null,
    scopeBefore: null,
    bootstrap: false,
    reloadNotice: null,
  };
}

export function nodeVersionCliFailure(message) {
  return { ok: false, error: message, errors: 1, warnings: 0 };
}

export function formatNodeVersionError(message) {
  return `NODE_VERSION: ${message}`;
}

export function compareNodeVersions(left, right) {
  const a = parseNodeVersion(left), b = parseNodeVersion(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index++) {
    if (a.parts[index] !== b.parts[index]) return a.parts[index] < b.parts[index] ? -1 : 1;
  }
  if (a.prerelease === b.prerelease) return 0;
  return a.prerelease ? -1 : 1;
}
