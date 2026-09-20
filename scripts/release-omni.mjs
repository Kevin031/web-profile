import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadFilename, packageRelease, requireDownloadUrl, root, siteFilename } from './package-release.mjs';

/** 连接官方 Omni Link MCP，凭证由公司 SSO 登录态管理。 */
async function connectOmni() {
  const client = new Client({ name: 'web-profile-release', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(import.meta.resolve('@baioo-zc/omni-link-mcp')), '--base-url', 'https://omni.100bt.com'],
    stderr: 'ignore',
  });
  await client.connect(transport);
  return {
    /** 调用 Omni Link 工具并只返回 JSON 结果。 @param {string} name @param {Record<string, unknown>} [args] */
    async call(name, args = {}) {
      const result = await client.callTool(
        { name: `omni_link_${name}`, arguments: args },
        undefined,
        { timeout: 300_000 },
      );
      if (result.isError) throw new Error(`Omni Link ${name} 失败，请检查授权和平台状态；未自动重试`);
      return JSON.parse(result.content.find((item) => item.type === 'text')?.text ?? 'null');
    },
    close: () => client.close(),
  };
}

/** 校验已有发布节点，防止误覆盖其他资源。 @param {Array<Record<string, any>>} items @param {{id:string,shareUrl:string}} target @param {'download'|'site'} mode */
export function requireTarget(items, target, mode) {
  const item = items.find((candidate) => candidate.id === target.id);
  const isSite = mode === 'site';
  if (
    !item ||
    item.shareUrl !== target.shareUrl ||
    item.deliveryMode !== (isSite ? 'site' : 'download') ||
    item.status !== 'active' ||
    item.hasAccessKey !== false ||
    item.originalFilename !== (isSite ? siteFilename : downloadFilename) ||
    !(isSite ? item.canArchiveReplace : item.canSingleFileReplace)
  ) {
    throw new Error(`${mode} 发布身份、文件名、模式或状态不匹配，已停止`);
  }
  if (!isSite) requireDownloadUrl(item.shareUrl);
  return item;
}

/** 原子保存固定发布节点，只记录 ID、分享地址与中断标记。 @param {Record<string, any>} config */
async function saveConfig(config) {
  const file = path.join(root, 'release.local.json');
  await writeFile(`${file}.tmp`, `${JSON.stringify(config, null, 2)}\n`);
  await rename(`${file}.tmp`, file);
}

/** 创建或更新一个固定发布节点。 @param {ReturnType<typeof connectOmni> extends Promise<infer T> ? T : never} omni @param {Record<string, any>} config @param {'download'|'site'} mode @param {string} filePath */
async function publishArtifact(omni, config, mode, filePath) {
  const target = config[mode];
  const autoExtractZip = mode === 'site';
  if (target) {
    await omni.call('update_content', { releaseId: target.id, filePath, autoExtractZip });
  } else {
    config.pending = mode;
    await saveConfig(config);
    const response = await omni.call('publish', {
      filePath,
      title: mode === 'download' ? 'Web Profile · Windows 下载' : 'Web Profile · 介绍页',
      autoExtractZip,
    });
    const created = response?.release ?? response;
    if (typeof created?.id !== 'string' || typeof created?.shareUrl !== 'string') {
      throw new Error(`${mode} 发布未返回 ID 和分享地址，已保留 pending 标记，请先核对平台结果`);
    }
    config[mode] = { id: created.id, shareUrl: created.shareUrl };
    delete config.pending;
    await saveConfig(config);
  }
  const items = (await omni.call('list_releases')).items;
  return requireTarget(items, config[mode], mode);
}

/** 打包并按下载资源、介绍页的顺序发布两个独立节点。 */
export async function release() {
  const configPath = path.join(root, 'release.local.json');
  const config = JSON.parse(await readFile(configPath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return '{}';
    throw error;
  }));
  if (config.pending) throw new Error(`上次 ${config.pending} 创建结果待核对，禁止重复创建`);
  const omni = await connectOmni();
  try {
    let auth = await omni.call('auth_status');
    if (!auth?.authenticated) {
      console.log('请在浏览器完成公司 SSO 登录。');
      await omni.call('login');
      auth = await omni.call('auth_status');
    }
    if (!auth?.authenticated) throw new Error('Omni Link 未授权');
    const existing = (await omni.call('list_releases')).items;
    for (const mode of ['download', 'site']) {
      if (config[mode]) requireTarget(existing, config[mode], mode);
    }
    const downloadZip = await packageRelease('download');
    const download = await publishArtifact(omni, config, 'download', downloadZip);
    const siteZip = await packageRelease('site', { downloadUrl: download.shareUrl });
    const site = await publishArtifact(omni, config, 'site', siteZip);
    console.log(`发布完成\n介绍页：${site.shareUrl}\n下载资源：${download.shareUrl}\n授权期限：${auth.expiresAt}`);
  } finally {
    await omni.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  release().catch((error) => {
    console.error(`发布停止：${error.message}`);
    process.exitCode = 1;
  });
}
