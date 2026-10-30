// 晨報封面卡片（LINE Flex Message）
// 分享頁（LIFF）和每日提醒（notify.mjs）共用這個檔案，改這裡兩邊一起變。
//
// 卡片內容：logo、標題、資料日期，點卡片或「開啟今日晨報」就打開完整晨報網頁。
// 下方「轉傳給其他人」讓收到的人（例如業務）也能再分享到他們自己的群組。

const C = {
  navy: '#0F2A4A',
  navySub: '#B9C8DC',
  green: '#1F6B4F',
  line: '#DFE4EA',
  muted: '#9AA3AE',
};

const DISCLAIMER = '本資料僅供參考，不構成投資建議';

const text = (t, o = {}) => ({ type: 'text', text: String(t || ' '), ...o });
const box = (layout, contents, o = {}) => ({ type: 'box', layout, contents, ...o });
const clean = (o) => JSON.parse(JSON.stringify(o)); // 移除 undefined（LINE 不接受）

// 從副標題抓出「數據收盤日」那段；抓不到就用日期
function dateLine(brief) {
  const sub = (brief.summary && brief.summary.subtitle) || '';
  const m = sub.match(/數據收盤日[:：]\s*([^\s·]+)/);
  return m ? `數據收盤日 ${m[1]}` : brief.date;
}

function teaser(brief) {
  const parts = [];
  for (const im of brief.images || []) {
    if (/新聞/.test(im.label || '')) {
      const n = (brief.summary && brief.summary.news || []).length;
      parts.push(`📰 ${im.label}${n ? ` ${n} 則` : ''}`);
    } else if (im.label) {
      parts.push(`📊 ${im.label}`);
    }
  }
  return parts.join('　');
}

/**
 * 產生晨報封面卡片
 * @param brief  latest.json / brief/DATE.json 的內容
 * @param base   網站根目錄網址，例如 https://xxx.github.io/line-morning-brief
 * @param opts.shareUrl    給自己的提醒用：最上面放「分享到銀行群組」
 * @param opts.withdrawUrl 給自己的提醒用：撤回晨報的連結
 * @param opts.forwardUrl  給群組用：放「轉傳給其他人」，收到的人也能再分享
 */
export function buildCard(brief, base, opts = {}) {
  const s = brief.summary || {};
  const pageUrl = brief.page ? `${base}/${brief.page}` : `${base}/${brief.image}`;
  const title = s.title || brief.title;
  const tease = teaser(brief);

  const body = box('vertical', [
    text(title, { size: 'lg', weight: 'bold', color: '#FFFFFF', wrap: true }),
    text(dateLine(brief), { size: 'xs', color: C.navySub, margin: 'sm' }),
    ...(tease ? [text(tease, { size: 'xs', color: '#FFFFFF', margin: 'md', wrap: true })] : []),
  ], {
    backgroundColor: C.navy,
    paddingAll: '16px',
    action: { type: 'uri', label: '開啟晨報', uri: pageUrl },
  });

  const footer = [];
  if (opts.shareUrl) {
    footer.push({ type: 'button', style: 'primary', color: '#06C755', height: 'sm',
      action: { type: 'uri', label: '分享到銀行群組', uri: opts.shareUrl } });
  }
  footer.push({ type: 'button', style: opts.shareUrl ? 'secondary' : 'primary',
    color: opts.shareUrl ? undefined : C.green, height: 'sm',
    action: { type: 'uri', label: '開啟今日晨報', uri: pageUrl } });
  if (opts.withdrawUrl) {
    footer.push({ type: 'button', style: 'link', height: 'sm', color: '#C62828',
      action: { type: 'uri', label: '發錯了？撤回這份晨報', uri: opts.withdrawUrl } });
  }
  if (opts.forwardUrl) {
    footer.push({ type: 'button', style: 'link', height: 'sm', color: C.green,
      action: { type: 'uri', label: '轉傳給其他人', uri: opts.forwardUrl } });
  }
  footer.push(text(DISCLAIMER, { size: 'xxs', color: C.muted, align: 'center', margin: 'sm' }));

  const bubble = {
    type: 'bubble',
    size: 'mega',
    body,
    footer: box('vertical', footer, { spacing: 'sm', paddingAll: '12px' }),
  };
  if (brief.logo) {
    bubble.header = box('vertical', [
      { type: 'image', url: `${base}/${brief.logo.path}`, size: '120px', align: 'start',
        aspectMode: 'fit', aspectRatio: `${brief.logo.w}:${brief.logo.h}` },
    ], { paddingAll: '10px', paddingStart: '16px', backgroundColor: '#FFFFFF' });
  }

  return clean({
    type: 'flex',
    altText: `📊 ${title}`.slice(0, 400),
    contents: bubble,
  });
}
