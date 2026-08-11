import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import process from 'node:process';

const [assetsRoot, version, repository, tag] = process.argv.slice(2);
if (!assetsRoot || !version || !repository || !tag) {
  throw new Error('用法: node generate-update-manifest.mjs <assetsRoot> <version> <repository> <tag>');
}

const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  }));
  return nested.flat();
};

/**
 * GitHub Release 上传时会把文件名中的空格替换成点号，下载 URL 必须使用替换后的名字。
 * @param {string} fileName 本地产物文件名
 * @returns {string} Release 资源名
 */
const toGitHubReleaseAssetName = (fileName) => fileName.replaceAll(' ', '.');

/**
 * 在多个签名产物中优先选择匹配当前版本号的文件。
 * @param {string[]} candidates 候选签名文件路径
 * @param {string} suffix 目标后缀，例如 `.exe.sig`
 * @param {string} releaseVersion 发布版本号
 * @returns {string | undefined}
 */
const pickSignaturePath = (candidates, suffix, releaseVersion) => {
  const matched = candidates.filter((path) => path.endsWith(suffix));
  if (matched.length === 0) {
    return undefined;
  }

  const versionMatched = matched.filter((path) => basename(path).includes(releaseVersion));
  const preferred = versionMatched.length > 0 ? versionMatched : matched;
  return preferred.toSorted((left, right) => basename(left).localeCompare(basename(right))).at(-1);
};

const files = await walk(assetsRoot);
const platformFiles = files.filter((path) => basename(path) === 'update-platform.txt');
const platforms = {};

for (const platformFile of platformFiles) {
  const platform = (await readFile(platformFile, 'utf8')).trim();
  const artifactDirectory = dirname(platformFile);
  const candidates = files.filter((path) => path.startsWith(`${artifactDirectory}/`) && path.endsWith('.sig'));
  const signaturePath = pickSignaturePath(
    candidates,
    platform.startsWith('windows-') ? '.exe.sig' : '.app.tar.gz.sig',
    version
  );
  if (!signaturePath) {
    throw new Error(`${platform} 缺少 updater 签名产物`);
  }

  const bundleName = basename(signaturePath, '.sig');
  const releaseAssetName = toGitHubReleaseAssetName(bundleName);
  platforms[platform] = {
    signature: (await readFile(signaturePath, 'utf8')).trim(),
    url: `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(releaseAssetName)}`
  };
}

if (Object.keys(platforms).length === 0) {
  throw new Error('没有找到可用的 updater 平台产物');
}

const manifest = {
  version,
  notes: `Web Profile ${version}`,
  pub_date: new Date().toISOString(),
  platforms
};

await writeFile(join(assetsRoot, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
