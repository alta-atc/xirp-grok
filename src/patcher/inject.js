// Applies (and reverses) the Grok harness patch to an installed Xirp.app.
//
// apply():   back up the registry chunk (once), append an import that wires
//            registerGrok(rt, ot) into it, drop the built harness module next
//            to it, then verify the squab CLI still loads and reports a
//            "grok" harness.
// remove():  restore the registry chunk byte-for-byte from its backup and
//            delete the harness module + backup + state marker.
//
// Both are idempotent: calling apply() twice, or remove() with nothing
// applied, is a safe no-op with a clear message rather than an error.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  copyFileSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { locate, LocateError } from "./locate.js";
import { readState, writeState, clearState } from "./state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

export const IMPORT_LINE =
  '\nimport { registerGrok } from "./grok-harness.js"; registerGrok(rt, ot);\n';

export const HARNESS_FILENAME = "grok-harness.js";

export class PatchError extends Error {
  constructor(message, { code = 1 } = {}) {
    super(message);
    this.name = "PatchError";
    this.code = code;
  }
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Resolve the harness module to install: the built dist/grok-harness.js if
 * WS2's build has run, otherwise the raw src/harness/grok-harness.js source
 * (or, in tests, an explicit override path). Fails loudly if neither exists.
 */
export function resolveHarnessSource({ repoRoot = REPO_ROOT, override } = {}) {
  if (override) {
    if (!existsSync(override)) {
      throw new PatchError(`Harness override not found at ${override}`);
    }
    return override;
  }
  const distPath = path.join(repoRoot, "dist", "grok-harness.js");
  if (existsSync(distPath)) return distPath;

  const srcPath = path.join(repoRoot, "src", "harness", "grok-harness.js");
  if (existsSync(srcPath)) return srcPath;

  throw new PatchError(
    `No harness module found. Expected a built module at ${distPath} ` +
      `(run \`npm run build\`) or source at ${srcPath}.`,
  );
}

/**
 * Read the version declared in package.json (the "patch version" recorded in
 * state, so future runs can tell which version of xirp-grok applied a patch).
 */
function readPatchVersion(repoRoot = REPO_ROOT) {
  const pkg = JSON.parse(
    readFileSync(path.join(repoRoot, "package.json"), "utf8"),
  );
  return pkg.version;
}

/**
 * Verify the patched squab CLI still runs and now reports a "grok" harness.
 */
function verify({ nodePath, cliPath }) {
  let availableRaw;
  try {
    availableRaw = execFileSync(nodePath, [cliPath, "--available-harnesses"], {
      encoding: "utf8",
    });
  } catch (err) {
    throw new PatchError(
      `Verification failed: \`${nodePath} ${cliPath} --available-harnesses\` did not run: ${err.message}`,
    );
  }

  let available;
  try {
    available = JSON.parse(availableRaw);
  } catch {
    throw new PatchError(
      `Verification failed: --available-harnesses did not print JSON:\n${availableRaw}`,
    );
  }
  // Real squab prints an object ({schema, count, harnesses: [...]}); accept a
  // bare array too for robustness (and for lightweight test fakes).
  const harnessList = Array.isArray(available)
    ? available
    : Array.isArray(available?.harnesses)
      ? available.harnesses
      : null;
  if (!harnessList) {
    throw new PatchError(
      `Verification failed: --available-harnesses output has neither an array ` +
        `nor a "harnesses" array:\n${availableRaw}`,
    );
  }
  const hasGrok = harnessList.some((h) => h && h.agentName === "grok");
  if (!hasGrok) {
    throw new PatchError(
      `Verification failed: no harness with agentName "grok" in --available-harnesses output:\n${availableRaw}`,
    );
  }

  let versionRaw;
  try {
    versionRaw = execFileSync(nodePath, [cliPath, "--version"], {
      encoding: "utf8",
    }).trim();
  } catch (err) {
    throw new PatchError(
      `Verification failed: \`${nodePath} ${cliPath} --version\` did not run: ${err.message}`,
    );
  }
  if (!/^\d+\.\d+\.\d+/.test(versionRaw)) {
    throw new PatchError(
      `Verification failed: --version did not print semver, got: ${versionRaw}`,
    );
  }

  return { available, version: versionRaw };
}

/**
 * Confirm the chunk actually has the `rt`/`ot` identifiers this patch wires
 * into, near the registry signature. If a future Xirp release renamed them,
 * fail loudly rather than silently injecting into the wrong scope.
 */
function assertRegistrySymbolsPresent(chunk) {
  if (!/\brt\s*\(/.test(chunk.content) || !/\bot\s*\(/.test(chunk.content)) {
    throw new LocateError(
      `Chunk ${chunk.path} has the registry signature but is missing the ` +
        `expected rt(...)/ot(...) calls. This Xirp version is unsupported.`,
      { code: 2 },
    );
  }
}

/**
 * Apply the Grok harness patch. Idempotent: if the chunk already contains
 * the import line, this is a no-op (unless `force`, which re-copies the
 * harness module and refreshes state without re-appending the import).
 */
export function apply({
  app,
  force = false,
  env = process.env,
  repoRoot = REPO_ROOT,
  home,
  harnessOverride,
} = {}) {
  const loc = locate({ app, env });
  const { chunk, chunksDir, cliPath, nodePath, version, appPath } = loc;
  const harnessDest = path.join(chunksDir, HARNESS_FILENAME);
  const backupPath = `${chunk.path}.orig`;

  const alreadyPatched = chunk.content.includes(IMPORT_LINE);

  if (alreadyPatched && !force) {
    writeState(
      {
        xirpVersion: version,
        chunkPath: chunk.path,
        chunkSha256Original: existsSync(backupPath)
          ? sha256(readFileSync(backupPath))
          : null,
        chunkSha256Patched: sha256(chunk.content),
        harnessSha256: existsSync(harnessDest)
          ? sha256(readFileSync(harnessDest, "utf8"))
          : null,
        patchVersion: readPatchVersion(repoRoot),
        appliedAt: readState(home)?.appliedAt ?? new Date().toISOString(),
      },
      home,
    );
    return {
      action: "noop",
      reason: "already-applied",
      appPath,
      version,
      chunkPath: chunk.path,
    };
  }

  assertRegistrySymbolsPresent(chunk);

  const harnessSource = resolveHarnessSource({
    repoRoot,
    override: harnessOverride,
  });

  let baseContent = chunk.content;
  if (alreadyPatched && force) {
    // Refresh path: strip the existing import line so we don't duplicate it,
    // then re-append below with (possibly) an updated harness.
    baseContent = chunk.content.split(IMPORT_LINE).join("");
  }

  const backupCreatedThisRun = !existsSync(backupPath);
  if (backupCreatedThisRun) {
    // Preserve the exact original bytes before touching anything. When the
    // chunk on disk is exactly `chunk.path`'s current content (the normal,
    // non-refresh path), copy it byte-for-byte rather than round-tripping
    // through a decoded string.
    if (alreadyPatched && force) {
      writeFileSync(backupPath, baseContent, "utf8");
    } else {
      copyFileSync(chunk.path, backupPath);
    }
  }

  const newContent = baseContent + IMPORT_LINE;

  try {
    copyFileSync(harnessSource, harnessDest);
    writeFileSync(chunk.path, newContent, "utf8");
    verify({ nodePath, cliPath });
  } catch (err) {
    // Never leave Xirp in a broken half-patched state: restore the chunk,
    // drop the harness copy, and remove the backup only if we created it
    // in this run (a pre-existing backup is still needed for a future
    // `remove`).
    writeFileSync(chunk.path, readFileSync(backupPath));
    if (existsSync(harnessDest)) unlinkSync(harnessDest);
    if (backupCreatedThisRun) unlinkSync(backupPath);
    throw new PatchError(`Rolled back: ${err.message}`, {
      code: err.code ?? 1,
    });
  }

  const backupBuffer = readFileSync(backupPath);
  const state = {
    xirpVersion: version,
    chunkPath: chunk.path,
    chunkSha256Original: sha256(backupBuffer),
    chunkSha256Patched: sha256(newContent),
    harnessSha256: sha256(readFileSync(harnessDest, "utf8")),
    patchVersion: readPatchVersion(repoRoot),
    appliedAt: new Date().toISOString(),
  };
  writeState(state, home);

  return {
    action: alreadyPatched ? "refreshed" : "applied",
    appPath,
    version,
    chunkPath: chunk.path,
    state,
  };
}

/**
 * Remove the patch: restore the registry chunk from its backup byte-for-byte,
 * delete the harness module and backup, and clear the state marker.
 * No-op (not an error) if there's nothing to remove.
 */
export function remove({ app, env = process.env, home } = {}) {
  const state = readState(home);
  if (!state) {
    return { action: "noop", reason: "no-state" };
  }

  const { chunkPath } = state;
  const backupPath = `${chunkPath}.orig`;

  if (!existsSync(chunkPath)) {
    throw new PatchError(
      `Recorded chunk not found at ${chunkPath} (Xirp may have been updated or moved). ` +
        `Run \`xirp-grok doctor\` to inspect the current install.`,
    );
  }
  if (!existsSync(backupPath)) {
    throw new PatchError(
      `Backup not found at ${backupPath}; cannot restore. Nothing was changed.`,
    );
  }

  const backupBuffer = readFileSync(backupPath);
  const backupHash = sha256(backupBuffer);

  copyFileSync(backupPath, chunkPath);

  const restoredHash = sha256(readFileSync(chunkPath));
  if (restoredHash !== backupHash) {
    throw new PatchError(
      `Restore verification failed: ${chunkPath} does not match its backup after writing. ` +
        `Refusing to delete the backup at ${backupPath}.`,
    );
  }

  const harnessPath = path.join(path.dirname(chunkPath), HARNESS_FILENAME);
  if (existsSync(harnessPath)) unlinkSync(harnessPath);
  unlinkSync(backupPath);
  clearState(home);

  return { action: "removed", chunkPath };
}
