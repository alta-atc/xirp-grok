// Builds a fake Xirp.app tree under a temp directory for tests, mirroring
// just enough of the real app's shape (Info.plist, bundled node runtime,
// squab CLI, chunks dir) for src/patcher to locate and patch it.

import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const SIGNATURE = 'flag: "--launch-cursor"';

const FAKE_NODE_SCRIPT = `#!/bin/sh
for arg in "$@"; do
  case "$arg" in
    --version) echo "0.10.12"; exit 0 ;;
    --available-harnesses) echo '[{"agentName":"cursor"},{"agentName":"grok"}]'; exit 0 ;;
  esac
done
echo "fake node: unrecognized args: $@" >&2
exit 1
`;

function infoPlist(version) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleShortVersionString</key>
  <string>${version}</string>
  <key>CFBundleIdentifier</key>
  <string>com.spotify.xirp</string>
</dict>
</plist>
`;
}

/**
 * Create a fake Xirp.app under a fresh temp directory.
 *
 * @param {object} opts
 * @param {string} [opts.version] - CFBundleShortVersionString
 * @param {boolean} [opts.withSignature] - include the --launch-cursor signature in the chunk
 * @param {boolean} [opts.withRtOt] - include rt(...)/ot(...) calls in the chunk
 * @param {string} [opts.chunkName] - filename for the registry chunk
 * @returns {{tmpDir, appPath, nodePath, cliPath, chunksDir, chunkPath}}
 */
export function createFakeApp({
  version = "0.32.0",
  withSignature = true,
  withRtOt = true,
  chunkName = "index-abc.js",
} = {}) {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "xirp-grok-test-"));
  const appPath = path.join(tmpDir, "Xirp.app");

  mkdirSync(path.join(appPath, "Contents"), { recursive: true });
  writeFileSync(
    path.join(appPath, "Contents", "Info.plist"),
    infoPlist(version),
    "utf8",
  );

  const nodeRuntimeDir = path.join(
    appPath,
    "Contents",
    "Resources",
    "node-runtime",
  );
  mkdirSync(nodeRuntimeDir, { recursive: true });
  const nodePath = path.join(nodeRuntimeDir, "node");
  writeFileSync(nodePath, FAKE_NODE_SCRIPT, "utf8");
  chmodSync(nodePath, 0o755);

  const squabDir = path.join(
    appPath,
    "Contents",
    "Resources",
    "app.asar.unpacked",
    "node_modules",
    "@chirp",
    "squab",
    "dist",
  );
  const chunksDir = path.join(squabDir, "chunks");
  mkdirSync(chunksDir, { recursive: true });

  const cliPath = path.join(squabDir, "cli.js");
  writeFileSync(cliPath, "// fake squab cli\n", "utf8");

  const rtOt = withRtOt ? "function Fi(){ rt(a); ot(b); }" : "// no rt/ot here";
  const signature = withSignature ? SIGNATURE : "flag: \"--not-it\"";
  const chunkContent = `// synthetic squab chunk\nconst CURSOR = { ${signature}, agentName: "cursor" };\n${rtOt}\n`;

  const chunkPath = path.join(chunksDir, chunkName);
  writeFileSync(chunkPath, chunkContent, "utf8");

  return { tmpDir, appPath, nodePath, cliPath, chunksDir, chunkPath, chunkContent };
}

export function fakeHome(tmpDir) {
  const home = path.join(tmpDir, "home");
  mkdirSync(home, { recursive: true });
  return home;
}
