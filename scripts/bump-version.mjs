import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const rootDirectory = fileURLToPath(new URL('..', import.meta.url));
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

/** 校验并返回 x.y.z 版本号。 @param {string} version */
export function validateVersion(version) {
  if (!versionPattern.test(version)) throw new Error('版本号必须是 x.y.z，例如 0.2.0');
  return version;
}

/** 将补丁版本加一。 @param {string} version */
export function incrementPatchVersion(version) {
  const parts = validateVersion(version).split('.').map(Number);
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}

/** 读取并校验项目各处版本一致。 @param {string} [workspace] */
export async function readCurrentVersion(workspace = rootDirectory) {
  const packageJson = JSON.parse(await readFile(path.join(workspace, 'package.json'), 'utf8'));
  const packageLock = JSON.parse(await readFile(path.join(workspace, 'package-lock.json'), 'utf8'));
  const tauriConfig = JSON.parse(await readFile(path.join(workspace, 'src-tauri/tauri.conf.json'), 'utf8'));
  const cargoToml = await readFile(path.join(workspace, 'src-tauri/Cargo.toml'), 'utf8');
  const cargoLock = await readFile(path.join(workspace, 'src-tauri/Cargo.lock'), 'utf8');
  const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(cargoToml)?.[1];
  const cargoLockVersion = /\[\[package\]\]\r?\nname = "web-profile"\r?\nversion = "([^"]+)"/u.exec(cargoLock)?.[1];
  const versions = [packageJson.version, packageLock.version, packageLock.packages?.['']?.version, tauriConfig.version, cargoVersion, cargoLockVersion];
  if (versions.some((version) => version !== versions[0])) throw new Error(`项目版本不一致：${versions.join(', ')}`);
  return validateVersion(versions[0]);
}

/** 一次性同步 npm、Tauri、Cargo 和介绍页版本。 @param {string} version @param {string} [workspace] */
export async function syncVersion(version, workspace = rootDirectory) {
  validateVersion(version);
  const current = await readCurrentVersion(workspace);
  const jsonFiles = ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json'];
  const jsonValues = await Promise.all(jsonFiles.map(async (name) => JSON.parse(await readFile(path.join(workspace, name), 'utf8'))));
  jsonValues[0].version = version;
  jsonValues[1].version = version;
  jsonValues[1].packages[''].version = version;
  jsonValues[2].version = version;

  const cargoPath = path.join(workspace, 'src-tauri/Cargo.toml');
  const cargoLockPath = path.join(workspace, 'src-tauri/Cargo.lock');
  const cargoToml = await readFile(cargoPath, 'utf8');
  const cargoLock = await readFile(cargoLockPath, 'utf8');
  const nextCargoToml = cargoToml.replace(/(^\[package\][\s\S]*?^version\s*=\s*")[^"]+("\s*$)/m, `$1${version}$2`);
  const nextCargoLock = cargoLock.replace(
    /(\[\[package\]\]\r?\nname = "web-profile"\r?\nversion = ")[^"]+("\r?$)/mu,
    `$1${version}$2`,
  );
  const landingPath = path.join(workspace, 'landing/index.html');
  const landing = await readFile(landingPath, 'utf8');
  const nextLanding = landing.replace(
    /(<div class="version" data-release-version="\{\{VERSION\}\}">当前应用版本 v)[^<]+(<\/div>)/u,
    `$1${version}$2`,
  );
  if (nextCargoToml === cargoToml && version !== current) throw new Error('未能更新 Cargo.toml 版本');
  if (nextCargoLock === cargoLock && version !== current) throw new Error('未能更新 Cargo.lock 版本');
  if (nextLanding === landing && !landing.includes(`当前应用版本 v${version}</div>`)) throw new Error('未能更新介绍页版本');

  await Promise.all([
    ...jsonFiles.map((name, index) => writeFile(path.join(workspace, name), `${JSON.stringify(jsonValues[index], null, 2)}\n`, 'utf8')),
    writeFile(cargoPath, nextCargoToml, 'utf8'),
    writeFile(cargoLockPath, nextCargoLock, 'utf8'),
    writeFile(landingPath, nextLanding, 'utf8'),
  ]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const current = await readCurrentVersion();
  await syncVersion(process.env.APP_VERSION ?? incrementPatchVersion(current));
}
