// 廣播一則「今日晨報已完成，點此分享」給官方帳號的「所有好友」（不會發到群組）
// 想收到提醒的同事，只要用 LINE 把官方帳號加為好友即可，不需要 User ID。
//
// 需要的環境變數：
//   LINE_CHANNEL_ACCESS_TOKEN  Messaging API 的長期 Channel access token
//   LIFF_ID                    LIFF app 的 ID
//   SITE_URL                   GitHub Pages 網址，例如 https://yourname.github.io/line-morning-brief
//   BRIEF_DATE（選填）          要提醒哪一天，不填就用 latest.json

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');

const { LINE_CHANNEL_ACCESS_TOKEN, LIFF_ID, BRIEF_DATE } = process.env;
const SITE_URL = (process.env.SITE_URL || '').replace(/\/+$/, '');

function need(name, value) {
  if (!value) {
    console.error(`❌ 缺少 ${name}，請到 GitHub → Settings → Secrets and variables → Actions 設定`);
    process.exit(1);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 等 GitHub Pages 真的把圖片放上線，不然 LINE 會顯示破圖
async function waitOnline(url, tries = 36) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      if (res.ok) return;
    } catch {}
    await sleep(5000);
  }
  throw new Error(`等了 3 分鐘圖片還沒上線：${url}`);
}

async function main() {
  need('LINE_CHANNEL_ACCESS_TOKEN', LINE_CHANNEL_ACCESS_TOKEN);
  need('LIFF_ID', LIFF_ID);
  need('SITE_URL', SITE_URL);

  const file = BRIEF_DATE ? path.join(SITE, 'brief', `${BRIEF_DATE}.json`) : path.join(SITE, 'latest.json');
  const info = JSON.parse(await fs.readFile(file, 'utf8'));

  const coverUrl = `${SITE_URL}/${info.cover}`;
  const liffUrl = `https://liff.line.me/${LIFF_ID}?date=${info.date}`;

  console.log(`⏳ 等待圖片上線：${coverUrl}`);
  await waitOnline(coverUrl);
  await waitOnline(`${SITE_URL}/${info.image}`);

  const message = {
    type: 'flex',
    altText: `📊 ${info.title} 已完成，點此分享到群組`,
    contents: {
      type: 'bubble',
      hero: {
        type: 'image',
        url: coverUrl,
        size: 'full',
        aspectRatio: '3:4',
        aspectMode: 'cover',
        action: { type: 'uri', uri: liffUrl },
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          { type: 'text', text: info.title, weight: 'bold', size: 'lg', wrap: true },
          { type: 'text', text: `${info.date}・已準備好，可以分享了`, size: 'sm', color: '#888888', wrap: true },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#06C755',
            action: { type: 'uri', label: '分享到銀行群組', uri: liffUrl },
          },
        ],
      },
    },
  };

  const res = await fetch('https://api.line.me/v2/bot/message/broadcast', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ messages: [message] }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`❌ LINE 推播失敗 (${res.status})：${body}`);
    if (res.status === 401) console.error('   → Channel access token 錯了或過期，請重新發行並更新 Secret');
    if (res.status === 400) console.error('   → 訊息格式有誤，請檢查錯誤內容');
    if (res.status === 429) console.error('   → 本月免費訊息額度用完了（廣播是按好友人數計算）');
    process.exit(1);
  }
  console.log(`✅ 已廣播提醒給所有好友：${info.title}`);
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
