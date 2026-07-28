import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { minify } from 'terser';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...s) => join(root, ...s);

const pkg = JSON.parse(await readFile(p('package.json'), 'utf8'));
const core = await readFile(p('src', 'core.js'), 'utf8');

const slug = pkg.repository.url.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
const raw = `https://raw.githubusercontent.com/${slug}/main/dist/${pkg.name}.user.js`;

await mkdir(p('dist'), { recursive: true });

/* ---- 1. 油猴脚本：保持可读，便于审阅与 Tampermonkey 自动更新 ---- */

const banner = `// ==UserScript==
// @name         LHW Award Helper
// @namespace    ${pkg.homepage}
// @version      ${pkg.version}
// @description  ${pkg.description}
// @author       ${slug.split('/')[0]}
// @match        *://www.lhw.com/*
// @match        *://*.lhw.com/*
// @run-at       document-start
// @grant        none
// @homepageURL  ${pkg.homepage}
// @supportURL   ${pkg.homepage}/issues
// @downloadURL  ${raw}
// @updateURL    ${raw}
// ==/UserScript==

`;

const userscript = banner + core;
await writeFile(p('dist', `${pkg.name}.user.js`), userscript);

/* ---- 2. Bookmarklet：压缩后整体 URI 编码 ---- */

const { code, error } = await minify(core, {
    compress: { passes: 2 },
    mangle: true,
    format: { comments: false },
});
if (error) throw error;

// 追加 void 0，确保 javascript: URL 求值为 undefined，页面不会被返回值替换
const bookmarklet = 'javascript:' + encodeURIComponent(`${code};void 0;`);
await writeFile(p('dist', 'bookmarklet.txt'), bookmarklet + '\n');

/* ---- 3. 安装页：可拖拽的书签链接 ---- */

const html = `<!doctype html>
<html lang="zh">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LHW Award Helper — 安装</title>
<style>
  body { max-width: 720px; margin: 48px auto; padding: 0 20px;
         font: 15px/1.7 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #23282e; }
  h1 { font-size: 24px; margin-bottom: 4px; }
  .sub { color: #6a6f76; margin-top: 0; }
  .drag { display: inline-block; margin: 20px 0; padding: 12px 22px;
          background: #2c4a63; color: #fff; border-radius: 8px;
          font-weight: 700; text-decoration: none; cursor: grab; }
  .hint { background: #f6f7f9; border-left: 3px solid #2c4a63;
          padding: 12px 16px; border-radius: 0 6px 6px 0; }
  textarea { width: 100%; height: 120px; margin-top: 8px; font: 11px/1.4 ui-monospace, monospace;
             border: 1px solid #d6dae0; border-radius: 6px; padding: 10px; }
  code { background: #f2f3f5; padding: 1px 5px; border-radius: 4px; font-size: 13px; }
</style>

<h1>LHW Award Helper</h1>
<p class="sub">${pkg.description}</p>

<div class="hint">把下面的按钮<strong>拖到浏览器书签栏</strong>。之后在 lhw.com 的搜索页或房型页点一下它即可。</div>

<p><a class="drag" href="${bookmarklet}">LHW CPP</a></p>

<p>拖不动的话（部分浏览器禁止拖拽 <code>javascript:</code> 链接），手动新建一个书签，把下面这段粘贴到「网址」栏：</p>
<textarea readonly onclick="this.select()">${bookmarklet}</textarea>

<p>需要每次自动运行、无需手点，请改用<a href="${pkg.homepage}#安装">油猴脚本版本</a>。</p>
</html>
`;
await writeFile(p('dist', 'install.html'), html);

/* ---- 输出 ---- */

const kb = s => (Buffer.byteLength(s, 'utf8') / 1024).toFixed(1) + ' KB';
console.log(`userscript   dist/${pkg.name}.user.js   ${kb(userscript)}`);
console.log(`bookmarklet  dist/bookmarklet.txt       ${kb(bookmarklet)}  (${bookmarklet.length} chars)`);
console.log(`install page dist/install.html          ${kb(html)}`);
