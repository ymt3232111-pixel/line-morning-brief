// 撤回／恢復某一天的晨報
//
// 用法：
//   node scripts/withdraw.mjs 撤回 2026-10-08
//   node scripts/withdraw.mjs 恢復 2026-10-08
//   （日期留空 = 今天，台北時間）
//
// 撤回：晨報網頁換成「本期晨報已撤回」，分享頁也會停止分享。
// 恢復：放回原本的晨報網頁。

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { noticePage } from './notice.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');
const LIST = path.join(ROOT, 'withdrawn.json');

const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

const action = (process.argv[2] || '').trim();
const date = (process.argv[3] || '').trim() || today();

async function readJSON(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

async function setFlag(file, value) {
  const j = await readJSON(file, null);
  if (!j || j.date !== date) return;
  if (value) j.withdrawn = true; else delete j.withdrawn;
  await fs.writeFile(file, JSON.stringify(j, null, 2) + '\n');
}

async function main() {
  if (!['撤回', '恢復'].includes(action)) throw new Error('第一個參數要是「撤回」或「恢復」');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`日期格式要是 YYYY-MM-DD，收到：${date}`);

  const list = new Set(await readJSON(LIST, []));
  const pageFile = path.join(SITE, 'b', `${date}.html`);
  const info = await readJSON(path.join(SITE, 'brief', `${date}.json`), null);
  if (!info) throw new Error(`找不到 ${date} 的晨報（site/brief/${date}.json）`);

  if (action === '撤回') {
    list.add(date);
    const logo = info.logo ? info.logo.path.replace(/^b\//, '') : null;
    await fs.writeFile(pageFile, noticePage(date, { logo }));
  } else {
    list.delete(date);
    // 恢復：重新跑 render 會比較完整，這裡先放回原檔並補上分頁隱藏規則
    let html = await fs.readFile(path.join(ROOT, 'briefs', `${date}.html`), 'utf8');
    if (!/<!doctype/i.test(html.slice(0, 200))) {
      html = '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<style>[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>\n' + html + '\n</body></html>';
    }
    await fs.writeFile(pageFile, html);
  }

  await fs.writeFile(LIST, JSON.stringify([...list].sort(), null, 2) + '\n');
  await setFlag(path.join(SITE, 'brief', `${date}.json`), action === '撤回');
  await setFlag(path.join(SITE, 'latest.json'), action === '撤回');
  console.log(`✅ 已${action} ${date} 的晨報`);
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
