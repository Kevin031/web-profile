import { spawnSync } from 'node:child_process';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('..', import.meta.url));
export const downloadFilename = 'web-profile-windows-x64.zip';
export const siteFilename = 'web-profile-site.zip';
const siteFiles = ['index.html', 'assets/app-icon.svg', 'assets/app-overview.png', 'assets/app-compact.png'];

/** 校验 Omni Link 下载资源地址，避免把站点按钮替换为未知来源。 @param {string} value */
export function requireDownloadUrl(value) {
  const url = new URL(value);
  if (
    url.origin !== 'https://omni-link.100bt.com' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.endsWith(`/${downloadFilename}`)
  ) {
    throw new Error(`下载地址必须是 Omni Link 的 ${downloadFilename} 公开链接`);
  }
  return url.href;
}

/** 将本地下载链接和版本标记替换为发布值。 @param {string} html @param {string} downloadUrl @param {string} version */
export function renderSiteHtml(html, downloadUrl, version) {
  const marker = 'href="../dist/web-profile-windows-x64.zip" data-release-href="{{DOWNLOAD_URL}}"';
  if (html.split(marker).length !== 2) throw new Error('介绍页下载链接标记缺失或重复');
  const versionMarker = /<div class="version" data-release-version="\{\{VERSION\}\}">当前应用版本 v[^<]+<\/div>/u;
  if (!versionMarker.test(html)) throw new Error('介绍页版本标记缺失');
  const rendered = html
    .replace(marker, `href="${requireDownloadUrl(downloadUrl)}"`)
    .replace(versionMarker, `<div class="version">当前应用版本 v${version}</div>`);
  if (rendered.includes('{{DOWNLOAD_URL}}') || rendered.includes('../dist/')) {
    throw new Error('介绍页仍包含未替换的本地下载地址');
  }
  return rendered;
}

/** 找到最新的 Windows NSIS 安装包。 */
async function findInstaller() {
  const directory = path.join(root, 'src-tauri/target/release/bundle/nsis');
  const candidates = await Promise.all(
    (await readdir(directory))
      .filter((name) => /^Web Profile_.+_x64-setup\.exe$/u.test(name))
      .map(async (name) => ({ path: path.join(directory, name), modified: (await stat(path.join(directory, name))).mtimeMs })),
  );
  candidates.sort((left, right) => right.modified - left.modified);
  if (!candidates[0]) throw new Error('未找到 Windows NSIS 安装包，请先运行 npm run build');
  return candidates[0].path;
}

/** 校验介绍页白名单资源均为普通文件。 */
async function validateSiteFiles() {
  for (const relative of siteFiles) {
    const info = await lstat(path.join(root, 'landing', relative));
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`介绍页资源无效：${relative}`);
  }
}

/** 调用 PowerShell 生成 ZIP。 @param {string} source @param {string} destination */
function archive(source, destination) {
  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(root, 'scripts/archive-release.ps1'),
    '-Source',
    source,
    '-Destination',
    destination,
  ], { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`ZIP 打包失败：${result.error?.message ?? result.stderr}`);
  return result.stdout.trim();
}

/** 生成下载包或介绍页包。 @param {'download' | 'site'} mode @param {{downloadUrl?: string}} [options] */
export async function packageRelease(mode, { downloadUrl } = {}) {
  if (!['download', 'site'].includes(mode)) throw new Error('打包模式必须是 download 或 site');
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'web-profile-release-'));
  const stage = path.join(temporary, 'stage');
  const filename = mode === 'download' ? downloadFilename : siteFilename;
  const temporaryZip = path.join(temporary, filename);
  try {
    await mkdir(stage, { recursive: true });
    if (mode === 'download') {
      const installer = await findInstaller();
      const portable = path.join(root, 'release/Web Profile-portable-x64/Web Profile.exe');
      const portableInfo = await lstat(portable);
      if (!portableInfo.isFile() || portableInfo.isSymbolicLink()) throw new Error('未找到便携版，请先运行 npm run build:portable');
      await copyFile(installer, path.join(stage, 'Web Profile Installer.exe'));
      await copyFile(portable, path.join(stage, 'Web Profile Portable.exe'));
      await writeFile(
        path.join(stage, '使用说明.txt'),
        'Web Profile\n\n推荐运行 Web Profile Installer.exe 完成安装。\n如不希望安装，可直接运行 Web Profile Portable.exe。\n\n运行要求：Windows 10/11 x64、Git、Node.js，以及项目所使用的包管理器。\n便携版要求系统已安装 Microsoft Edge WebView2 Runtime。\n',
        'utf8',
      );
    } else {
      if (!downloadUrl) throw new Error('打包介绍页必须提供独立下载链接');
      await validateSiteFiles();
      for (const relative of siteFiles.filter((file) => file !== 'index.html')) {
        await mkdir(path.dirname(path.join(stage, relative)), { recursive: true });
        await copyFile(path.join(root, 'landing', relative), path.join(stage, relative));
      }
      const html = await readFile(path.join(root, 'landing/index.html'), 'utf8');
      const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
      await writeFile(path.join(stage, 'index.html'), renderSiteHtml(html, downloadUrl, version), 'utf8');
    }
    const summary = archive(stage, temporaryZip);
    const dist = path.join(root, 'dist');
    const target = path.join(dist, filename);
    await mkdir(dist, { recursive: true });
    await copyFile(temporaryZip, `${target}.tmp`);
    await rm(target, { force: true });
    await rename(`${target}.tmp`, target);
    if (mode === 'site') {
      const preview = path.join(dist, 'site');
      await rm(preview, { recursive: true, force: true });
      await mkdir(path.join(preview, 'assets'), { recursive: true });
      for (const relative of siteFiles) {
        await mkdir(path.dirname(path.join(preview, relative)), { recursive: true });
        await copyFile(path.join(stage, relative), path.join(preview, relative));
      }
    }
    console.log(`${filename} · ${summary}`);
    return target;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, downloadUrl] = process.argv.slice(2);
  packageRelease(mode, { downloadUrl }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
