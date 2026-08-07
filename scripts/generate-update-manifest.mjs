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

const files = await walk(assetsRoot);
const platformFiles = files.filter((path) => basename(path) === 'update-platform.txt');
const platforms = {};

for (const platformFile of platformFiles) {
  const platform = (await readFile(platformFile, 'utf8')).trim();
  const artifactDirectory = dirname(platformFile);
  const candidates = files.filter((path) => path.startsWith(`${artifactDirectory}/`) && path.endsWith('.sig'));
  const signaturePath = candidates.find((path) =>
    platform.startsWith('windows-') ? path.endsWith('.exe.sig') : path.endsWith('.app.tar.gz.sig')
  );
  if (!signaturePath) {
    throw new Error(`${platform} 缺少 updater 签名产物`);
  }

  const bundleName = basename(signaturePath, '.sig');
  platforms[platform] = {
    signature: (await readFile(signaturePath, 'utf8')).trim(),
    url: `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(bundleName)}`
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
