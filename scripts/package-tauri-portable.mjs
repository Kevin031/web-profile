import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { arch, platform } from 'node:os';
import { resolve } from 'node:path';

const appName = 'Web Profile';
const rootDirectory = resolve(import.meta.dirname, '..');
const releaseRoot = resolve(rootDirectory, 'release');
const architecture = arch() === 'arm64' ? 'arm64' : 'x64';
const outputDirectory = resolve(releaseRoot, `${appName}-portable-${architecture}`);

const assertExists = async (path) => {
  try {
    return await stat(path);
  } catch {
    throw new Error(`未找到 Tauri release 产物：${path}`);
  }
};

if (!outputDirectory.startsWith(`${releaseRoot}/`) && outputDirectory !== releaseRoot) {
  throw new Error(`拒绝清理 release 目录外路径：${outputDirectory}`);
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

if (platform() === 'darwin') {
  const sourceApp = resolve(rootDirectory, 'src-tauri/target/release/bundle/macos', `${appName}.app`);
  const outputApp = resolve(outputDirectory, `${appName}.app`);
  await assertExists(sourceApp);
  await cp(sourceApp, outputApp, { recursive: true });

  // Tauri 未配置 Apple Developer 证书时，产物中的 Mach-O 只有链接器签名。
  // 对完整应用包进行 ad-hoc 签名，避免 Finder/Gatekeeper 将其判定为损坏。
  const signingResult = spawnSync('codesign', [
    '--force',
    '--deep',
    '--sign',
    '-',
    outputApp
  ], { stdio: 'inherit' });

  if (signingResult.error) {
    throw signingResult.error;
  }
  if (signingResult.status !== 0) {
    throw new Error(`macOS 应用签名失败，退出码：${signingResult.status ?? 'unknown'}`);
  }
} else {
  const extension = platform() === 'win32' ? '.exe' : '';
  const sourceExecutable = resolve(rootDirectory, 'src-tauri/target/release', `web-profile${extension}`);
  await assertExists(sourceExecutable);
  const outputExecutable = resolve(outputDirectory, `${appName}${extension}`);
  await cp(sourceExecutable, outputExecutable);
}

console.log(`Tauri portable build generated: ${outputDirectory}`);
