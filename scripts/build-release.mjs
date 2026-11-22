import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tauriDir = join(repoRoot, "src-tauri");
const { values } = parseArgs({
  options: {
    "output-directory": { type: "string", default: "D:\\MOD\\EndfieldModManager" },
    "portable-only": { type: "boolean" },
    "publish-only": { type: "boolean" },
    "repo": { type: "string", default: "carrotluo5/EndfieldModManager" },
    "notes": { type: "string", default: "" },
    "notes-file": { type: "string", default: "" },
  },
});
const outputRoot = resolve(values["output-directory"]);
const version = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).version;
const defaultCargo = join(homedir(), ".cargo", "bin", "cargo.exe");
const env = { ...process.env };
if (existsSync(defaultCargo)) {
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  env[pathKey] = dirname(defaultCargo) + delimiter + (env[pathKey] ?? "");
}

function run(program, args, capture = false) {
  const result = spawnSync(program, args, {
    cwd: repoRoot,
    env,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${basename(program)} exited with code ${result.status}`);
  return result.stdout;
}

function publishFile(source, destination) {
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    copyFileSync(source, temporary);
    renameSync(temporary, destination);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function main() {
  if (!values["publish-only"]) {
    const args = [join(repoRoot, "node_modules", "@tauri-apps", "cli", "tauri.js"), "build"];
    if (values["portable-only"]) args.push("--no-bundle");
    run(process.execPath, args);
  }

  const metadata = JSON.parse(run("cargo.exe", [
    "metadata", "--format-version", "1", "--no-deps", "--locked", "--offline",
    "--manifest-path", join(tauriDir, "Cargo.toml"),
  ], true));
  const release = join(metadata.target_directory, "release");
  const executable = join(release, "endfield-mod-manager.exe");
  if (!existsSync(executable)) throw new Error(`Release executable not found: ${executable}`);

  const installerDir = join(release, "bundle", "nsis");
  const installers = values["portable-only"] ? [] : readdirSync(installerDir).filter(
    (name) => name.startsWith(`EndfieldModManager_${version}_`) && name.endsWith("-setup.exe")
  );
  if (!values["portable-only"] && installers.length === 0) {
    throw new Error(`No installer for ${version} found in ${installerDir}`);
  }

  mkdirSync(outputRoot, { recursive: true });
  const application = "EndfieldModManager.exe";
  try {
    publishFile(executable, join(outputRoot, application));
  } catch (error) {
    throw new Error(`Could not publish ${join(outputRoot, application)}. Close any running copy at that path and retry.`, { cause: error });
  }
  const portableFlag = join(outputRoot, "portable.flag");
  if (!existsSync(portableFlag)) writeFileSync(portableFlag, "portable=1\r\n");

  const updateZipEntries = [application];
  const portableZipEntries = [application, "portable.flag"];
  for (const name of ["7za.exe", "UnRAR.exe"]) {
    const source = join(tauriDir, "bin", name);
    const destination = join(outputRoot, "bin", name);
    if (existsSync(source)) {
      mkdirSync(dirname(destination), { recursive: true });
      publishFile(source, destination);
    }
    if (existsSync(destination)) {
      updateZipEntries.push(`bin/${name}`);
      portableZipEntries.push(`bin/${name}`);
    }
  }
  console.log(`Application: ${join(outputRoot, application)}`);

  for (const installer of installers) {
    publishFile(join(installerDir, installer), join(outputRoot, installer));
    console.log(`Installer: ${join(outputRoot, installer)}`);
  }
  if (!values["portable-only"]) {
    const createZip = (fileName, entries) => {
      const zipPath = join(outputRoot, fileName);
      const temporary = `${zipPath}.${randomUUID()}.zip`;
      try {
        run("tar.exe", ["-a", "-cf", temporary, "-C", outputRoot, ...entries]);
        renameSync(temporary, zipPath);
      } finally {
        rmSync(temporary, { force: true });
      }
      return zipPath;
    };

    const portableZip = createZip(
      `EndfieldModManager-v${version}-windows-x64-portable.zip`,
      portableZipEntries
    );
    console.log(`Portable ZIP: ${portableZip}`);

    const updateZip = createZip(
      `EndfieldModManager-v${version}-windows-x64-update.zip`,
      updateZipEntries
    );
    console.log(`Update ZIP: ${updateZip}`);

    const repoSlug = (values.repo || "carrotluo5/EndfieldModManager").trim().replace(/^\/+|\/+$/g, "");
    const tag = `v${version}`;
    const downloadBase = `https://github.com/${repoSlug}/releases/download/${tag}`;
    const notes =
      values["notes-file"] && existsSync(values["notes-file"])
        ? readFileSync(values["notes-file"], "utf8").trim()
        : (values.notes || "").trim() || `EndfieldModManager ${tag}`;

    const describeAsset = (filePath) => {
      const fileName = basename(filePath);
      const content = readFileSync(filePath);
      return {
        fileName,
        size: content.length,
        sha256: createHash("sha256").update(content).digest("hex"),
        url: `${downloadBase}/${fileName}`,
      };
    };

    // Cross-version update contract:
    // Every update.zip MUST remain a complete, self-contained runtime package (never a delta patch
    // against only v(N-1)), and latest.json MUST keep schema v1 fields so any client from v0.1.0+
    // can upgrade directly across multiple versions.
    const manifestPath = join(outputRoot, "latest.json");
    const manifest = {
      schemaVersion: 1,
      minSupportedClientVersion: "0.1.0",
      version,
      tag,
      pubDate: new Date().toISOString(),
      notes,
      releaseUrl: `https://github.com/${repoSlug}/releases/tag/${tag}`,
      updatePackage: describeAsset(updateZip),
      portablePackage: describeAsset(portableZip),
      installerPackage: installers[0] ? describeAsset(join(outputRoot, installers[0])) : null,
    };
    const tempManifest = `${manifestPath}.${randomUUID()}.tmp`;
    try {
      writeFileSync(tempManifest, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      renameSync(tempManifest, manifestPath);
    } finally {
      rmSync(tempManifest, { force: true });
    }
    console.log(`Manifest: ${manifestPath}`);
  }
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
