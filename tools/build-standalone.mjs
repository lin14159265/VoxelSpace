// 构建单一自包含可玩文件 VOXELSPACE.html：
//   - 将 style.css 内联为 <style>
//   - 用 esbuild 把 src/main.js（含 three.js 整个模块图）打包成 IIFE 并内联为 <script>
//   - 结果：双击该 HTML 即可在浏览器游玩，无需 Node.js / 服务器 / npm install
// 用法: node tools/build-standalone.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const indexHtml = readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = readFileSync(path.join(root, 'style.css'), 'utf8');

  const result = await build({
    entryPoints: [path.join(root, 'src', 'main.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome100', 'edge100', 'firefox100', 'safari15'],
    minify: true,
    write: false,
    logLevel: 'silent',
    legalComments: 'none',
  });
  const js = result.outputFiles[0].text;

  let out = indexHtml;
  out = out.replace('<link rel="stylesheet" href="style.css" />', () => `<style>\n${css}\n</style>`);
  out = out.replace(/<script type="importmap">[\s\S]*?<\/script>/, '');
  out = out.replace(
    '<script type="module" src="src/main.js"></script>',
    () => `<!-- inline bundle (built by tools/build-standalone.mjs) -->\n<script>\n${js}\n</script>`,
  );

  const outPath = path.join(root, 'VOXELSPACE.html');
  writeFileSync(outPath, out);
  console.log(`wrote ${path.relative(root, outPath)}  (${(out.length / 1024).toFixed(1)} KB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
