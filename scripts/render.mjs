// 把 briefs/YYYY-MM-DD.html 轉成 LINE 可以傳的圖片
//
// 用法：
//   node scripts/render.mjs              → 轉 briefs/ 裡日期最新的那份
//   node scripts/render.mjs 2026-10-08   → 轉指定日期
//
// 自動處理：
//   ・寬度：表格太寬會自動加寬版面，不會被切掉（540～1200px，輸出 2 倍解析度）
//   ・分頁：晨報裡有分頁（例如「行情快搜」「焦點新聞」）時，每個分頁各輸出一張圖
//   ・一律用淺色模式截圖，不受深色模式影響
//
// 產出（都在 site/ 底下，會被部署到 GitHub Pages）：
//   site/brief/DATE-1.png, DATE-2.png …   每個分頁一張原圖（只有一頁時檔名是 DATE.png）
//   site/brief/DATE-1_preview.jpg …       對應的預覽圖（< 1MB，LINE 聊天室縮圖用）
//   site/brief/DATE_cover.jpg             封面（3:4，每日提醒卡片上方的圖）
//   site/brief/DATE.json                  這一天的資料
//   site/latest.json                      最新一天的資料（LIFF 頁面預設讀這個）
//   site/config.json                      LIFF ID（從環境變數 LIFF_ID 帶入）

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { noticePage } from './notice.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRIEFS = path.join(ROOT, 'briefs');
const SITE = path.join(ROOT, 'site');
const OUT = path.join(SITE, 'brief');

const MIN_WIDTH = Number(process.env.BRIEF_MIN_WIDTH || 540);   // 最窄版面寬度（CSS px）
const MAX_WIDTH = Number(process.env.BRIEF_MAX_WIDTH || 1200);  // 最寬版面寬度
const SCALE = 2;                                                // 2 倍解析度，放大看也清楚
const MAX_ORIGINAL = 9.5 * 1024 * 1024; // LINE 原圖上限 10MB
const MAX_PREVIEW = 1000 * 1024;        // LINE 預覽圖上限 1MB
const MAX_IMAGES = 4;                   // LINE 一次最多 5 則訊息，留 1 則給文字

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function pickDate() {
  const arg = (process.argv[2] || '').trim();
  if (arg) {
    if (!DATE_RE.test(arg)) throw new Error(`日期格式要是 YYYY-MM-DD，收到：${arg}`);
    return arg;
  }
  const files = (await fs.readdir(BRIEFS)).filter((f) => /^\d{4}-\d{2}-\d{2}\.html$/.test(f)).sort();
  if (!files.length) throw new Error('briefs/ 裡沒有任何 YYYY-MM-DD.html 晨報檔');
  return files.at(-1).slice(0, 10);
}

const size = async (file) => (await fs.stat(file)).size;

async function open(context, src, scale) {
  const page = await context.newPage({});
  await page.setViewportSize({ width: MIN_WIDTH, height: 200 }); // 高度設小，整頁截圖才不會多出空白
  await page.goto(pathToFileURL(src).href, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.waitForTimeout(800);
  return page;
}

// 找出晨報裡的分頁；沒有分頁就回傳一個「整頁」
async function listPanels(page) {
  return page.evaluate(() => {
    const panels = [...document.querySelectorAll('[role="tabpanel"]')];
    return panels.map((p, i) => {
      const labelEl =
        (p.getAttribute('aria-labelledby') && document.getElementById(p.getAttribute('aria-labelledby'))) ||
        (p.id && document.querySelector(`[aria-controls="${p.id}"]`));
      return (labelEl && labelEl.textContent.trim()) || `第 ${i + 1} 頁`;
    });
  });
}

// 只顯示第 idx 個分頁，並把分頁按鈕列藏起來（圖片上不能點，留著沒意義）
async function showPanel(page, idx) {
  await page.evaluate((idx) => {
    const panels = [...document.querySelectorAll('[role="tabpanel"]')];
    panels.forEach((p, i) => {
      p.hidden = i !== idx;
      p.style.display = i === idx ? '' : 'none';
    });
    document.querySelectorAll('[role="tablist"]').forEach((t) => {
      (t.closest('nav') || t).style.display = 'none';
    });
  }, idx);
  await page.waitForTimeout(150);
}

// 量出需要多寬：把所有「可以左右捲動」的區塊攤開所需的寬度
async function neededWidth(page) {
  let width = page.viewportSize().width;
  for (let i = 0; i < 4; i++) {
    const extra = await page.evaluate(() => {
      let m = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      for (const el of document.querySelectorAll('body *')) {
        if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
        const ox = getComputedStyle(el).overflowX;
        if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 1) {
          m = Math.max(m, el.scrollWidth - el.clientWidth);
        }
      }
      return m;
    });
    if (extra <= 0 || width >= MAX_WIDTH) break;
    width = Math.min(MAX_WIDTH, width + extra + 2);
    await page.setViewportSize({ width, height: 200 });
    await page.waitForTimeout(200);
  }
  return width;
}


// ---- 分享用精簡圖：行情一張（股市左右兩欄、匯市與債市並排）、新聞一張（兩欄）----
const SHARE_WIDTH = 1500;  // CSS px，比例接近正方形，手機點開好讀
const SHARE_SCALE = 1.5;

async function compactLayout(page, idx) {
  await page.evaluate((idx) => {
    const panels = [...document.querySelectorAll('[role="tabpanel"]')];
    panels.forEach((p, i) => { p.hidden = i !== idx; p.style.display = i === idx ? '' : 'none'; });
    document.querySelectorAll('[role="tablist"]').forEach((t) => { (t.closest('nav') || t).style.display = 'none'; });
    const css = document.createElement('style');
    css.textContent = `
      .wrap{max-width:none!important}.rotate-tip,.legend{display:none!important}
      .scroll{overflow:visible!important}table{min-width:0!important}
      thead th:first-child,tbody th{position:static!important;min-width:0!important}
      .cmp-two{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
      .cmp-two>div{min-width:0}.cmp-stack{display:flex;flex-direction:column;gap:12px}
      .news{grid-template-columns:1fr 1fr!important}.news article:first-child{grid-column:1/-1}
      article p{max-width:none!important}
      thead th{font-size:13.5px;padding:7px 8px}tbody th,tbody td{font-size:14px;padding:6px 8px}
      main{padding-block:10px 4px!important}section.panel{gap:12px!important}
      footer{margin-top:10px!important;padding-block:8px 10px!important;font-size:11px!important}`;
    document.head.appendChild(css);
    const panel = panels[idx];
    if (!panel) return;
    // 每個表格所在的區塊（<div><h2>…</h2><div class="scroll"><table>）
    const blocks = [...panel.querySelectorAll('table')].map((t) => t.closest('.scroll')?.parentElement).filter(Boolean);
    // 版面：左欄放第一個表格（股市），右欄由上而下放其餘表格（匯市與油金、債市、美銀美林）
    if (blocks.length >= 2) {
      const grid = document.createElement('div');
      grid.className = 'cmp-two';
      const left = document.createElement('div');
      const right = document.createElement('div');
      right.className = 'cmp-stack';
      blocks[0].before(grid);
      left.appendChild(blocks[0]);
      blocks.slice(1).forEach((bk) => right.appendChild(bk));
      grid.append(left, right);
    }
  }, idx);
  await page.waitForTimeout(200);
}

async function renderShareImages(browser, src, date, count) {
  const hi = await browser.newContext({ deviceScaleFactor: SHARE_SCALE, colorScheme: 'light', locale: 'zh-TW' });
  const lo = await browser.newContext({ deviceScaleFactor: 1, colorScheme: 'light', locale: 'zh-TW' });
  const out = [];
  try {
    const sets = [];
    for (let i = 0; i < count; i++) {
      const pages = [];
      for (const ctx of [hi, lo]) {
        const p = await open(ctx, src);
        await p.setViewportSize({ width: SHARE_WIDTH, height: 200 });
        await compactLayout(p, i);
        pages.push(p);
      }
      sets.push(pages);
    }
    // 所有圖片統一長寬：以最矮的那張（通常是新聞）為準，較高的把表格字級／列高逐步縮小到放得下
    const heightOf = (p) => p.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
    const heights = [];
    for (const [big] of sets) heights.push(await heightOf(big));
    const target = Math.min(...heights);
    const STEPS = [[13.5, 5, 13], [13, 4, 12.5], [12.5, 3.5, 12], [12, 3, 11.5], [11.5, 2.5, 11], [11, 2, 10.5]];
    for (let i = 0; i < count; i++) {
      for (const p of sets[i]) {
        if (heights[i] > target) {
          for (const [fs, pad, th] of STEPS) {
            await p.evaluate(([fs, pad, th]) => {
              let el = document.getElementById('fit-css');
              if (!el) { el = document.createElement('style'); el.id = 'fit-css'; document.head.appendChild(el); }
              el.textContent = `tbody th,tbody td{font-size:${fs}px!important;padding-top:${pad}px!important;padding-bottom:${pad}px!important}
                thead th{font-size:${th}px!important;padding-top:${pad + 1}px!important;padding-bottom:${pad + 1}px!important}
                h2{margin-bottom:3px!important;font-size:15px!important}section.panel{gap:8px!important}.cmp-stack{gap:8px!important}`;
            }, [fs, pad, th]);
            await p.waitForTimeout(100);
            if ((await heightOf(p)) <= target) break;
          }
        }
        // 補齊到同一高度，頁尾警語貼底
        await p.evaluate((h) => {
          const css = document.createElement('style');
          css.textContent = `body{min-height:${h}px;display:flex;flex-direction:column;margin:0}
            body>main{flex:1;display:flex;flex-direction:column}
            body>main>footer{margin-top:auto!important}`;
          document.head.appendChild(css);
        }, target);
        await p.setViewportSize({ width: SHARE_WIDTH, height: target });
        await p.waitForTimeout(150);
      }
    }
    for (let i = 0; i < count; i++) {
      const [big, small] = sets[i];
      const clip = { x: 0, y: 0, width: SHARE_WIDTH, height: target };
      let image = `brief/${date}-share-${i + 1}.png`;
      await big.screenshot({ path: path.join(SITE, image), clip });
      if ((await size(path.join(SITE, image))) > MAX_ORIGINAL) {
        await fs.rm(path.join(SITE, image));
        image = `brief/${date}-share-${i + 1}.jpg`;
        for (const q of [92, 85, 75, 65]) {
          await big.screenshot({ path: path.join(SITE, image), clip, type: 'jpeg', quality: q });
          if ((await size(path.join(SITE, image))) <= MAX_ORIGINAL) break;
        }
      }
      const preview = `brief/${date}-share-${i + 1}_preview.jpg`;
      for (const q of [80, 65, 50, 35]) {
        await small.screenshot({ path: path.join(SITE, preview), clip, type: 'jpeg', quality: q });
        if ((await size(path.join(SITE, preview))) <= MAX_PREVIEW) break;
      }
      await big.close(); await small.close();
      out.push({ image, preview });
    }
  } finally {
    await hi.close(); await lo.close();
  }
  return out;
}

async function main() {
  const date = await pickDate();
  const src = path.join(BRIEFS, `${date}.html`);
  await fs.access(src).catch(() => {
    throw new Error(`找不到晨報檔：briefs/${date}.html`);
  });
  await fs.mkdir(OUT, { recursive: true });

  const browser = await chromium.launch();
  try {
    const hiRes = await browser.newContext({ deviceScaleFactor: SCALE, colorScheme: 'light', locale: 'zh-TW' });
    const loRes = await browser.newContext({ deviceScaleFactor: 1, colorScheme: 'light', locale: 'zh-TW' });

    const page = await open(hiRes, src);
    const title = (await page.title()).trim() || `每日晨報 ${date}`;

    // ---- 抓卡片要用的文字資料（指標、新聞標題、免責聲明）----
    const summary = await page.evaluate(() => {
      const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
      const h1 = document.querySelector('h1');
      const sub = h1 && h1.parentElement.querySelector('p');
      const tables = [...document.querySelectorAll('table')].map((t) => {
        const sec = t.closest('div:has(> h2), section:has(> h2)');
        const h2 = sec && sec.querySelector(':scope > h2');
        const heading = h2 ? (h2.childNodes[0] ? h2.childNodes[0].textContent.trim() : txt(h2)) : '';
        return {
          heading,
          unit: h2 && /bp/i.test(txt(h2)) ? 'bp' : '%',
          rows: [...(t.tBodies[0] ? t.tBodies[0].rows : [])].map((r) => {
            const th = r.querySelector('th');
            const a = th && th.querySelector('a');
            const name = a ? txt(a) : th ? txt(th.childNodes[0] || th) : '';
            return { name, cells: [...r.querySelectorAll('td')].map((td) => ({ t: txt(td), c: td.className })) };
          }),
        };
      });
      const news = [...document.querySelectorAll('article')].map((a) => ({
        label: txt(a.querySelector('.lab')),
        time: txt(a.querySelector('.time')),
        title: txt(a.querySelector('h3')),
      })).filter((n) => n.title);
      const img = [...document.images].find((i) => i.naturalWidth && !/^(https?:|data:)/.test(i.getAttribute('src') || ''));
      return {
        title: txt(h1),
        subtitle: txt(sub),
        tables,
        news,
        footer: txt(document.querySelector('footer')),
        shareText: ((el) => (el ? el.textContent.trim().replace(/([0-9#*])\uFE0F?\u20E3/g, '$1\uFE0F\u20E3') : ''))(document.getElementById('share-text')), // 三秒看懂市場摘要
        logo: img ? { src: img.getAttribute('src'), w: img.naturalWidth, h: img.naturalHeight } : null,
      };
    });

    // ---- 把原始晨報網頁也放上網站（卡片上的按鈕會打開它）----
    const PAGE_DIR = path.join(SITE, 'b');
    await fs.mkdir(PAGE_DIR, { recursive: true });
    // 補上網頁必要的基本設定：Claude 發布時會自動加，但存成檔案時可能沒有
    // （少了 [hidden] 規則，分頁會全部擠在同一頁）
    let html = await fs.readFile(src, 'utf8');
    const BASE_HEAD = '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
      + '<style>[hidden]:not([hidden=until-found i]){display:none!important}</style>';
    if (!/<!doctype/i.test(html.slice(0, 200))) {
      html = `<!doctype html><html lang="zh-Hant"><head>${BASE_HEAD}</head><body>\n${html}\n</body></html>`;
    } else if (!/\[hidden\][^{]*\{[^}]*display\s*:\s*none/i.test(html)) {
      html = html.replace(/<head[^>]*>/i, (m) => m + '<style>[hidden]:not([hidden=until-found i]){display:none!important}</style>');
    }
    await fs.writeFile(path.join(PAGE_DIR, `${date}.html`), html);
    for (const f of await fs.readdir(BRIEFS)) {
      if (!f.endsWith('.html')) await fs.copyFile(path.join(BRIEFS, f), path.join(PAGE_DIR, f));
    }
    let logo = null;
    if (summary.logo) {
      logo = { path: `b/${summary.logo.src.replace(/^\.?\//, '')}`, w: summary.logo.w, h: summary.logo.h };
    }
    delete summary.logo;

    // 已撤回的日期：網頁維持「已撤回」提示，不會因為重跑又被放回去
    let withdrawn = false;
    try {
      withdrawn = JSON.parse(await fs.readFile(path.join(ROOT, 'withdrawn.json'), 'utf8')).includes(date);
    } catch {}
    if (withdrawn) {
      await fs.writeFile(path.join(PAGE_DIR, `${date}.html`),
        noticePage(date, { logo: logo ? logo.path.replace(/^b\//, '') : null }));
    }
    let labels = await listPanels(page);
    const hasPanels = labels.length > 0;
    if (!hasPanels) labels = [''];
    if (labels.length > MAX_IMAGES) {
      console.warn(`⚠️ 有 ${labels.length} 個分頁，只取前 ${MAX_IMAGES} 個`);
      labels = labels.slice(0, MAX_IMAGES);
    }

    // 所有分頁用同一個寬度，看起來才一致
    let width = MIN_WIDTH;
    for (let i = 0; i < labels.length; i++) {
      if (hasPanels) await showPanel(page, i);
      await page.setViewportSize({ width: MIN_WIDTH, height: 200 });
      width = Math.max(width, await neededWidth(page));
    }
    await page.setViewportSize({ width, height: 200 });

    const small = await open(loRes, src);
    await small.setViewportSize({ width, height: 200 });

    const images = [];
    for (let i = 0; i < labels.length; i++) {
      const base = labels.length > 1 ? `${date}-${i + 1}` : date;
      if (hasPanels) {
        await showPanel(page, i);
        await showPanel(small, i);
      }

      // 原圖
      let image = `brief/${base}.png`;
      await page.screenshot({ path: path.join(SITE, image), fullPage: true });
      if ((await size(path.join(SITE, image))) > MAX_ORIGINAL) {
        await fs.rm(path.join(SITE, image));
        image = `brief/${base}.jpg`;
        for (const q of [92, 85, 75, 65]) {
          await page.screenshot({ path: path.join(SITE, image), fullPage: true, type: 'jpeg', quality: q });
          if ((await size(path.join(SITE, image))) <= MAX_ORIGINAL) break;
        }
      }

      // 預覽圖
      const preview = `brief/${base}_preview.jpg`;
      for (const q of [80, 65, 50, 35]) {
        await small.screenshot({ path: path.join(SITE, preview), fullPage: true, type: 'jpeg', quality: q });
        if ((await size(path.join(SITE, preview))) <= MAX_PREVIEW) break;
      }
      if ((await size(path.join(SITE, preview))) > MAX_PREVIEW) {
        await small.screenshot({
          path: path.join(SITE, preview), type: 'jpeg', quality: 70, fullPage: true,
          clip: { x: 0, y: 0, width, height: width * 2 },
        });
      }

      images.push({ label: labels[i], image, preview });
    }

    // 分享用精簡圖（分享頁可勾選要不要附上）；失敗不影響其他產出
    let shareImages = [];
    try {
      const made = await renderShareImages(browser, src, date, labels.length);
      shareImages = made.map((m, i) => ({ label: labels[i], ...m }));
    } catch (err) {
      console.warn('⚠️ 精簡圖產生失敗：' + err.message);
    }

    // 封面：第一頁最上方 3:4，給提醒卡片用
    if (hasPanels) await showPanel(page, 0);
    const contentHeight = await page.evaluate(() =>
      Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)));
    const cover = `brief/${date}_cover.jpg`;
    await page.screenshot({
      path: path.join(SITE, cover), type: 'jpeg', quality: 85, fullPage: true,
      clip: { x: 0, y: 0, width, height: Math.min(Math.round((width * 4) / 3), contentHeight) },
    });

    // 資料檔（image / preview 保留第一張，相容舊版）
    const info = {
      date, title, width, images, shareImages,
      image: images[0].image, preview: images[0].preview, cover,
      page: `b/${date}.html`, logo, summary,
      ...(withdrawn ? { withdrawn: true } : {}),
      generatedAt: new Date().toISOString(),
    };
    const json = JSON.stringify(info, null, 2) + '\n';
    await fs.writeFile(path.join(OUT, `${date}.json`), json);

    // 只有比目前 latest 新（或一樣）的日期才更新 latest.json，避免補跑舊日期蓋掉
    let latestDate = '';
    try {
      latestDate = JSON.parse(await fs.readFile(path.join(SITE, 'latest.json'), 'utf8')).date || '';
    } catch {}
    if (date >= latestDate) await fs.writeFile(path.join(SITE, 'latest.json'), json);

    if (process.env.LIFF_ID) {
      await fs.writeFile(path.join(SITE, 'config.json'),
        JSON.stringify({ liffId: process.env.LIFF_ID.trim() }, null, 2) + '\n');
    }
    if (process.env.GITHUB_OUTPUT) {
      await fs.appendFile(process.env.GITHUB_OUTPUT, `date=${date}\n`);
    }

    console.log(`✅ 完成 ${date}「${title}」 版面寬 ${width}px`);
    for (const im of images) {
      console.log(`   ${im.label || '整頁'}：${im.image} ${(await size(path.join(SITE, im.image)) / 1024).toFixed(0)} KB`
        + ` / 預覽 ${(await size(path.join(SITE, im.preview)) / 1024).toFixed(0)} KB`);
    }
    for (const im of shareImages) console.log(`   精簡圖 ${im.label}：${im.image} ${(await size(path.join(SITE, im.image)) / 1024).toFixed(0)} KB`);
    console.log(`   封面：${cover}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
