// 晨報圖文卡片（LINE Flex Message）
// 分享頁（LIFF）和每日提醒（notify.mjs）共用這個檔案，改這裡兩邊一起變。

// ===== 可以自己改的地方 =====

// 卡片上要顯示的主要指標（名稱要和晨報表格第一欄一模一樣）
export const KEY_ROWS = [
  'S&P 500',
  '那斯達克',
  '費城半導體',
  '台灣加權',
  '日經225',
  '美元指數',
  '美元兌台幣',
  '美國10年期公債',
  '黃金現貨',
  '西德州原油',
];

export const MAX_NEWS = 5; // 卡片上最多顯示幾則新聞標題

const C = {
  navy: '#0F2A4A',
  navySub: '#B9C8DC',
  green: '#1F6B4F',
  greenSoft: '#E6F2EC',
  ink: '#18202B',
  muted: '#5B6676',
  line: '#DFE4EA',
  up: '#C62828', // 紅漲
  dn: '#1B7A3D', // 綠跌
  flat: '#5B6676',
};

// ===== 以下不用改 =====

const text = (t, o = {}) => ({ type: 'text', text: String(t || ' '), ...o });
const box = (layout, contents, o = {}) => ({ type: 'box', layout, contents, ...o });

function findRow(summary, name) {
  for (const t of summary.tables || []) {
    const row = t.rows.find((r) => r.name === name);
    if (row) return { row, unit: t.unit };
  }
  return null;
}

function changeColor(cls = '') {
  if (/\bup\b/.test(cls)) return C.up;
  if (/\bdn\b/.test(cls)) return C.dn;
  return C.flat;
}

function indicatorRows(summary) {
  const rows = [];
  for (const name of KEY_ROWS) {
    const hit = findRow(summary, name);
    if (!hit || hit.row.cells.length < 2) continue;
    const [price, chg] = hit.row.cells;
    const unit = hit.unit === 'bp' ? 'bp' : '%';
    rows.push(
      box('horizontal', [
        text(name, { size: 'sm', color: C.ink, flex: 5 }),
        text(price.t + (hit.unit === 'bp' ? '%' : ''), { size: 'sm', color: C.ink, align: 'end', flex: 4 }),
        text(/\d/.test(chg.t) ? chg.t + unit : chg.t, {
          size: 'sm', weight: 'bold', align: 'end', flex: 3, color: changeColor(chg.c),
        }),
      ]),
    );
  }
  return rows;
}

function newsRows(summary) {
  return (summary.news || []).slice(0, MAX_NEWS).map((n) =>
    box('horizontal', [
      box('vertical', [text(n.label || '新聞', { size: 'xxs', color: C.green, weight: 'bold' })], {
        flex: 0, backgroundColor: C.greenSoft, cornerRadius: '3px',
        paddingStart: '5px', paddingEnd: '5px', paddingTop: '1px', paddingBottom: '1px',
      }),
      text(n.title, { size: 'sm', color: C.ink, wrap: true, flex: 1 }),
    ], { spacing: 'sm', alignItems: 'flex-start' }),
  );
}

/**
 * 產生晨報卡片
 * @param brief  latest.json / brief/DATE.json 的內容
 * @param base   網站根目錄網址，例如 https://xxx.github.io/line-morning-brief
 * @param opts.shareUrl  有給的話，多一顆「分享到銀行群組」按鈕（給自己的每日提醒用）
 */
export function buildCard(brief, base, opts = {}) {
  const s = brief.summary || {};
  const pageUrl = brief.page ? `${base}/${brief.page}` : `${base}/${brief.image}`;
  const hasNews = (s.news || []).length > 0;

  const body = [
    box('vertical', [
      text(s.title || brief.title, { size: 'lg', weight: 'bold', color: '#FFFFFF', wrap: true }),
      ...(s.subtitle ? [text(s.subtitle, { size: 'xxs', color: C.navySub, wrap: true, margin: 'sm' })] : []),
    ], { backgroundColor: C.navy, paddingAll: '16px' }),
  ];

  const inner = [];
  const ind = indicatorRows(s);
  if (ind.length) {
    inner.push(
      text('主要指標', { size: 'sm', weight: 'bold', color: C.green }),
      box('horizontal', [
        text('名稱', { size: 'xxs', color: C.muted, flex: 5 }),
        text('最新', { size: 'xxs', color: C.muted, align: 'end', flex: 4 }),
        text('近1日', { size: 'xxs', color: C.muted, align: 'end', flex: 3 }),
      ], { margin: 'sm' }),
      box('vertical', ind, { spacing: 'xs', margin: 'xs' }),
    );
  }
  if (hasNews) {
    if (inner.length) inner.push({ type: 'separator', margin: 'lg', color: C.line });
    inner.push(
      text('焦點新聞', { size: 'sm', weight: 'bold', color: C.green, margin: inner.length ? 'lg' : 'none' }),
      box('vertical', newsRows(s), { spacing: 'md', margin: 'md' }),
    );
  }
  if (inner.length) body.push(box('vertical', inner, { paddingAll: '16px' }));

  const buttons = [];
  if (opts.shareUrl) {
    buttons.push({ type: 'button', style: 'primary', color: '#06C755', height: 'sm',
      action: { type: 'uri', label: '分享到銀行群組', uri: opts.shareUrl } });
  }
  buttons.push(
    box('horizontal', [
      { type: 'button', style: opts.shareUrl ? 'secondary' : 'primary', color: opts.shareUrl ? undefined : C.green,
        height: 'sm', flex: 1, action: { type: 'uri', label: '完整行情表', uri: `${pageUrl}#mkt` } },
      ...(hasNews ? [{ type: 'button', style: 'secondary', height: 'sm', flex: 1,
        action: { type: 'uri', label: '焦點新聞全文', uri: `${pageUrl}#news` } }] : []),
    ], { spacing: 'sm' }),
  );
  // 移除 undefined 欄位（LINE 不接受）
  const clean = (o) => JSON.parse(JSON.stringify(o));

  const footer = [...buttons];
  if (s.footer) footer.push(text(s.footer, { size: 'xxs', color: '#9AA3AE', wrap: true, margin: 'md' }));

  const bubble = {
    type: 'bubble',
    size: 'giga',
    body: box('vertical', body, { paddingAll: '0px' }),
    footer: box('vertical', footer, { spacing: 'sm', paddingAll: '16px' }),
    styles: { footer: { separator: true, separatorColor: C.line } },
  };
  if (brief.logo) {
    bubble.header = box('vertical', [
      { type: 'image', url: `${base}/${brief.logo.path}`, size: '150px', align: 'start',
        aspectMode: 'fit', aspectRatio: `${brief.logo.w}:${brief.logo.h}` },
    ], { paddingAll: '12px', paddingStart: '16px', backgroundColor: '#FFFFFF' });
  }

  return clean({
    type: 'flex',
    altText: `📊 ${s.title || brief.title}`.slice(0, 400),
    contents: bubble,
  });
}
