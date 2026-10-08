import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

function run(command, args, env = process.env, printOutput = true) {
  const result = spawnSync(command, args, { encoding: "utf8", env });
  if (printOutput && result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  return result.stdout.trim();
}

function copyGeneratedFile(source, destination) {
  if (existsSync(destination)) {
    chmodSync(destination, 0o644);
  }
  copyFileSync(source, destination);
  chmodSync(destination, 0o644);
}

const cachedGo = resolve(homedir(), ".cache/tailvnc/go1.27.1/bin/go");
const go = process.env.GO ?? (existsSync(cachedGo) ? cachedGo : "go");
const publicDir = resolve("public");
const licenseDir = resolve(publicDir, "licenses");
mkdirSync(publicDir, { recursive: true });
rmSync(licenseDir, { recursive: true, force: true });
mkdirSync(licenseDir, { recursive: true });
const wasmEnv = { ...process.env, GOOS: "js", GOARCH: "wasm" };
run(
  go,
  ["build", "-ldflags=-s -w", "-o", resolve(publicDir, "tailscale.wasm"), "./cmd/tailvnc-wasm"],
  wasmEnv,
);

const goroot = run(go, ["env", "GOROOT"]);
copyGeneratedFile(resolve(goroot, "lib/wasm/wasm_exec.js"), resolve(publicDir, "wasm_exec.js"));
copyGeneratedFile(resolve(goroot, "LICENSE"), resolve(licenseDir, "go-toolchain-LICENSE"));

const moduleRows = run(
  go,
  ["list", "-deps", "-f", "{{if .Module}}{{.Module.Path}}|{{.Module.Dir}}{{end}}", "./cmd/tailvnc-wasm"],
  wasmEnv,
  false,
);
const goModules = new Map();
for (const row of moduleRows.split("\n")) {
  const separator = row.indexOf("|");
  if (separator > 0) {
    goModules.set(row.slice(0, separator), row.slice(separator + 1));
  }
}
for (const [modulePath, moduleDir] of goModules) {
  const prefix = `go-${modulePath.replace(/[^A-Za-z0-9.-]+/g, "-")}`;
  for (const file of readdirSync(moduleDir)) {
    if (
      /^(LICENSE|COPYING|NOTICE|PATENTS)(?:$|[.-][A-Za-z0-9.-]+)$/i.test(file) &&
      !file.toLowerCase().endsWith(".go")
    ) {
      copyGeneratedFile(resolve(moduleDir, file), resolve(licenseDir, `${prefix}-${file}`));
    }
  }
}

const noVncDir = resolve("node_modules/@novnc/novnc");
copyGeneratedFile(resolve(noVncDir, "LICENSE.txt"), resolve(licenseDir, "noVNC-LICENSE.txt"));
copyGeneratedFile(resolve(noVncDir, "AUTHORS"), resolve(licenseDir, "noVNC-AUTHORS"));
copyGeneratedFile(
  resolve(noVncDir, "docs/LICENSE.MPL-2.0"),
  resolve(licenseDir, "noVNC-MPL-2.0.txt"),
);
copyGeneratedFile(
  resolve(noVncDir, "vendor/pako/LICENSE"),
  resolve(licenseDir, "noVNC-vendor-pako-LICENSE"),
);
copyGeneratedFile(
  resolve(noVncDir, "core/crypto/des.js"),
  resolve(licenseDir, "noVNC-des-source.txt"),
);
copyGeneratedFile(
  resolve("THIRD_PARTY_NOTICES.md"),
  resolve(licenseDir, "THIRD_PARTY_NOTICES.md"),
);

for (const [packagePath, outputName] of [
  ["@fontsource/ibm-plex-sans", "fontsource-ibm-plex-sans-OFL-1.1.txt"],
  ["@fontsource/ibm-plex-mono", "fontsource-ibm-plex-mono-OFL-1.1.txt"],
  ["lucide-preact", "lucide-preact-LICENSE"],
  ["preact", "preact-LICENSE"],
]) {
  copyGeneratedFile(resolve("node_modules", packagePath, "LICENSE"), resolve(licenseDir, outputName));
}