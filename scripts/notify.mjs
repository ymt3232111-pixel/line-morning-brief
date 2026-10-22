// 廣播晨報卡片給官方帳號的「所有好友」（不會發到群組）
// 想收到提醒的同事，只要用 LINE 把官方帳號加為好友即可，不需要 User ID。
// 測試模式：在 GitHub Actions 手動按「Run workflow」時，只推給你自己（LINE_USER_ID），不發給同事。
// 卡片和群組收到的一模一樣，只是最上面多一顆「分享到銀行群組」按鈕。
//
// 需要的環境變數：
//   LINE_CHANNEL_ACCESS_TOKEN  Messaging API 的長期 Channel access token
//   LIFF_ID                    LIFF app 的 ID
//   LINE_USER_ID               你自己的 User ID（測試模式用，只發給你）
//   SITE_URL                   GitHub Pages 網址，例如 https://yourname.github.io/line-morning-brief
//   BRIEF_DATE（選填）          要提醒哪一天，不填就用 latest.json

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCard } from '../site/card.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');

const { LINE_CHANNEL_ACCESS_TOKEN, LINE_USER_ID, LIFF_ID, BRIEF_DATE } = process.env;
// 手動 Run workflow = 測試，只發給自己；每天自動上傳晨報觸發的 = 正式，廣播給所有好友
const TEST_MODE = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch';
const SITE_URL = (process.env.SITE_URL || '').replace(/\/+$/, '');

function need(name, value) {
  if (!value) {
    console.error(`❌ 缺少 ${name}，請到 GitHub → Settings → Secrets and variables → Actions 設定`);
    process.exit(1);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 等 GitHub Pages 真的把檔案放上線，不然 LINE 會顯示破圖
async function waitOnline(url, tries = 36) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      if (res.ok) return;
    } catch {}
    await sleep(5000);
  }
  throw new Error(`等了 3 分鐘還沒上線：${url}`);
}

async function main() {
  need('LINE_CHANNEL_ACCESS_TOKEN', LINE_CHANNEL_ACCESS_TOKEN);
  need('LIFF_ID', LIFF_ID);
  need('SITE_URL', SITE_URL);
  if (TEST_MODE) need('LINE_USER_ID', LINE_USER_ID);

  const file = BRIEF_DATE ? path.join(SITE, 'brief', `${BRIEF_DATE}.json`) : path.join(SITE, 'latest.json');
  const info = JSON.parse(await fs.readFile(file, 'utf8'));
  const liffUrl = `https://liff.line.me/${LIFF_ID}?date=${info.date}`;

  const mustBeOnline = [info.image, info.page, info.logo && info.logo.path].filter(Boolean);
  for (const p of mustBeOnline) {
    console.log(`⏳ 等待上線：${SITE_URL}/${p}`);
    await waitOnline(`${SITE_URL}/${p}`);
  }

  const repo = process.env.GITHUB_REPOSITORY;
  const withdrawUrl = repo ? `https://github.com/${repo}/actions/workflows/withdraw.yml` : undefined;
  const message = buildCard(info, SITE_URL, { shareUrl: liffUrl, withdrawUrl });
  message.altText = `📊 ${info.title} 已完成，點此分享到群組`;

  const endpoint = TEST_MODE ? 'push' : 'broadcast';
  // 晨報有「三秒看懂市場」摘要時，先送摘要文字、再送卡片
  const shareText = info.summary && info.summary.shareText;
  const msgs = shareText ? [{ type: 'text', text: shareText.slice(0, 5000) }, message] : [message];
  const payload = TEST_MODE ? { to: LINE_USER_ID.trim(), messages: msgs } : { messages: msgs };
  console.log(TEST_MODE ? '🧪 測試模式：只推給你自己' : '📣 正式模式：廣播給所有好友');

  const res = await fetch(`https://api.line.me/v2/bot/message/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN.trim()}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`❌ LINE 推播失敗 (${res.status})：${body}`);
    if (res.status === 401) console.error('   → Channel access token 錯了或過期，請重新發行並更新 Secret');
    if (res.status === 400) console.error('   → 常見原因：卡片格式有誤、或測試模式的 User ID 填錯（請把上面整行錯誤給 Claude 看）');
    if (res.status === 429) console.error('   → 本月免費訊息額度用完了（廣播是按好友人數計算）');
    process.exit(1);
  }
  console.log(TEST_MODE ? `✅ 已推播測試給你自己：${info.title}` : `✅ 已廣播提醒給所有好友：${info.title}`);
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
