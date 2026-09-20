import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderSiteHtml, root } from './package-release.mjs';
import { requireTarget } from './release-omni.mjs';
import { readCurrentVersion, syncVersion } from './bump-version.mjs';
import { selectVersion } from './build-and-release.mjs';

test('介绍页只接受独立的 Omni Link 下载 ZIP 地址', async () => {
  const html = await readFile(path.join(root, 'landing/index.html'), 'utf8');
  const url = 'https://omni-link.100bt.com/test/web-profile-windows-x64.zip';
  const rendered = renderSiteHtml(html, url, '1.2.3');
  assert.match(rendered, new RegExp(url.replaceAll('.', '\\.')));
  assert.match(rendered, /当前应用版本 v1\.2\.3/u);
  assert.doesNotMatch(rendered, /\{\{|\.\.\/dist\//u);
  for (const invalid of [
    'http://omni-link.100bt.com/test/web-profile-windows-x64.zip',
    'https://omni-link.100bt.com.evil.test/web-profile-windows-x64.zip',
    'https://omni-link.100bt.com/test/web-profile-windows-x64.zip?token=x',
  ]) assert.throws(() => renderSiteHtml(html, invalid, '1.2.3'));
});

test('用户输入版本后一次同步所有版本文件', async (context) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'web-profile-version-'));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  await mkdir(path.join(workspace, 'landing'), { recursive: true });
  await mkdir(path.join(workspace, 'src-tauri'), { recursive: true });
  for (const name of ['package.json', 'package-lock.json', 'landing/index.html', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'src-tauri/tauri.conf.json']) {
    await copyFile(path.join(root, name), path.join(workspace, name));
  }
  const current = await readCurrentVersion(workspace);
  assert.equal(selectVersion(current, current), current);
  assert.throws(() => selectVersion('1.0.0', '0.9.9'), /不能低于/u);
  await syncVersion('9.8.7', workspace);
  assert.equal(await readCurrentVersion(workspace), '9.8.7');
  assert.match(await readFile(path.join(workspace, 'landing/index.html'), 'utf8'), /当前应用版本 v9\.8\.7/u);
});

test('发布节点必须保持正确的文件名和交付模式', () => {
  const download = {
    id: 'download-id',
    shareUrl: 'https://omni-link.100bt.com/test/web-profile-windows-x64.zip',
    deliveryMode: 'download',
    status: 'active',
    hasAccessKey: false,
    originalFilename: 'web-profile-windows-x64.zip',
    canSingleFileReplace: true,
    canArchiveReplace: false,
  };
  assert.equal(requireTarget([download], { id: download.id, shareUrl: download.shareUrl }, 'download'), download);
  assert.throws(() => requireTarget([{ ...download, deliveryMode: 'site' }], download, 'download'));
});
