import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

const rootDirectory = resolve(import.meta.dirname, '..');

/**
 * 读取 JSON 文件。
 * @param {string} relativePath 相对于项目根目录的文件路径
 * @returns {Promise<Record<string, unknown>>} JSON 对象
 */
const readJson = async (relativePath) => {
  const content = await readFile(resolve(rootDirectory, relativePath), 'utf8');
  return JSON.parse(content);
};

/**
 * 写入格式化后的 JSON 文件。
 * @param {string} relativePath 相对于项目根目录的文件路径
 * @param {Record<string, unknown>} value JSON 对象
 * @returns {Promise<void>}
 */
const writeJson = async (relativePath, value) => {
  await writeFile(resolve(rootDirectory, relativePath), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

/**
 * 将语义化版本的补丁号加一。
 * @param {string} version 当前版本号
 * @returns {string} 新版本号
 */
const incrementPatchVersion = (version) => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`不支持的版本号格式: ${version}`);
  }

  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
};

const packageJson = await readJson('package.json');
const currentVersion = packageJson.version;
if (typeof currentVersion !== 'string') {
  throw new Error('package.json 中缺少有效的 version 字段');
}

const requestedVersion = process.env.APP_VERSION;
if (requestedVersion !== undefined && !/^\d+\.\d+\.\d+$/.test(requestedVersion)) {
  throw new Error(`APP_VERSION 不是有效的语义化版本号: ${requestedVersion}`);
}
const nextVersion = requestedVersion ?? incrementPatchVersion(currentVersion);
packageJson.version = nextVersion;

const packageLock = await readJson('package-lock.json');
packageLock.version = nextVersion;
const lockPackages = packageLock.packages;
if (typeof lockPackages === 'object' && lockPackages !== null && '' in lockPackages) {
  const rootPackage = lockPackages[''];
  if (typeof rootPackage === 'object' && rootPackage !== null) {
    rootPackage.version = nextVersion;
  }
}

const tauriConfig = await readJson('src-tauri/tauri.conf.json');
tauriConfig.version = nextVersion;

const cargoPath = resolve(rootDirectory, 'src-tauri/Cargo.toml');
const cargoToml = await readFile(cargoPath, 'utf8');
const cargoVersionPattern = /(^\[package\][\s\S]*?^version\s*=\s*")[^"]+("\s*$)/m;
if (!cargoVersionPattern.test(cargoToml)) {
  throw new Error('未能更新 src-tauri/Cargo.toml 中的 package.version');
}
const nextCargoToml = cargoToml.replace(cargoVersionPattern, `$1${nextVersion}$2`);

await Promise.all([
  writeJson('package.json', packageJson),
  writeJson('package-lock.json', packageLock),
  writeJson('src-tauri/tauri.conf.json', tauriConfig),
  writeFile(cargoPath, nextCargoToml, 'utf8')
]);
