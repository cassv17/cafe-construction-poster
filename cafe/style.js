// 말투 기준 글(링크) 관리와 말투 분석.
//
// - 기준 글 링크는 한 번 등록하면 고정으로 남는다 (style.json + articles/<글번호>.txt).
// - 새 링크를 올리면 그 글만 읽어서 분석하고, 이미 정리된 말투 지침에 합친다. (전부 다시 분석하지 않는다)
// - 지침(guide)은 글 쓰는 단계에서 프롬프트에 그대로 들어간다.
const fs = require('fs');
const path = require('path');
const ai = require('../lib/ai');
const chrome = require('./chrome');
const { DATA_DIR, STYLE_FILE, CAFE_ID, COMPANY } = require('./config');

const ARTICLE_DIR = path.join(DATA_DIR, 'articles');

const MODEL = process.env.WRITER_MODEL || undefined;

function articleUrl(id) {
  return `https://cafe.naver.com/f-e/cafes/${CAFE_ID}/articles/${id}`;
}

/** 글 주소에서 글 번호를 뽑는다. 못 뽑으면 null. */
function articleId(url) {
  const s = String(url || '');
  const m = s.match(/\/articles\/(\d+)/) || s.match(/articleid=(\d+)/i) || s.match(/cafe\.naver\.com\/[^/?#]+\/(\d+)/);
  return m ? m[1] : null;
}

function kindOf(title) {
  if (/공사\s*전/.test(title)) return 'before';
  if (/공사\s*중/.test(title)) return 'during';
  return null;
}

function readFileJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/** articles/ 에 있는 글 파일로 처음 한 번 목록을 만든다 (PDF 로 받은 레퍼런스 4건). */
function seedFromFiles() {
  const links = [];
  if (fs.existsSync(ARTICLE_DIR)) {
    for (const f of fs.readdirSync(ARTICLE_DIR).filter((n) => /^\d+\.txt$/.test(n)).sort()) {
      const id = f.replace('.txt', '');
      const text = fs.readFileSync(path.join(ARTICLE_DIR, f), 'utf8');
      const first = text.split('\n')[0] || '';
      const title = first.replace(/^\[[^\]]*\]\s*/, '').trim();
      links.push({
        id,
        url: articleUrl(id),
        title,
        kind: kindOf(first),
        source: 'pdf',
        addedAt: new Date().toISOString(),
        chars: text.length,
      });
    }
  }
  return { links, guide: '', guideAt: null };
}

function load() {
  const data = readFileJson(STYLE_FILE, null);
  if (data && Array.isArray(data.links)) return data;
  const seeded = seedFromFiles();
  writeJson(STYLE_FILE, seeded);
  return seeded;
}

function save(data) {
  writeJson(STYLE_FILE, data);
}

function articleText(id) {
  try {
    return fs.readFileSync(path.join(ARTICLE_DIR, `${id}.txt`), 'utf8').trim();
  } catch {
    return '';
  }
}

/** 화면용 요약. */
function summary() {
  const s = load();
  return {
    links: s.links.map((l) => ({ id: l.id, url: l.url, title: l.title, kind: l.kind, source: l.source, addedAt: l.addedAt })),
    guide: s.guide || '',
    guideAt: s.guideAt || null,
    analyzed: s.links.filter((l) => l.analyzed).length,
  };
}

/** 글쓰기 단계에서 예시로 보여 줄 기준 글. 같은 분류를 먼저, 최대 max 건. */
function examples(분류, max = 3) {
  const s = load();
  const same = s.links.filter((l) => l.kind === 분류);
  const other = s.links.filter((l) => l.kind !== 분류);
  return [...same, ...other]
    .slice(0, max)
    .map((l) => ({ id: l.id, title: l.title, kind: l.kind, text: articleText(l.id) }))
    .filter((e) => e.text);
}

// ─────────────────────────────────────────────
// 분석
// ─────────────────────────────────────────────
const 지침형식 = `# 말투·문체 지침 — ${COMPANY} 카페 '공사중 현장' 글

아래 항목을 이 순서·이 제목으로, 간결한 불릿으로 쓴다. 전체 60줄 이내.
1. 인사말 — 실제로 쓰는 문장 그대로, 변형 포함
2. 현장 소개 문장 — 위치·평수·무엇을 살펴볼지 쓰는 방식
3. 공간별 설명 — 한 문단의 길이(문장 수), 문장 시작 방식, 공사 전/공사중 설명 방식의 차이
4. 전환 문구 — "먼저," "다음은," "마지막으로," 처럼 실제로 쓰는 것
5. 어미·톤 — 자주 쓰는 종결어미, 존댓말 정도, 감탄·의문 사용 빈도
6. 기호·이모티콘 — 쓰는 것과 위치(예: ~, ^^, :), ㅎㅎ, 😁), 쓰지 않는 것
7. 마무리와 문의 안내 — 순서와 실제 문장, 대표번호 표기 방식
8. 반복해서 쓰는 표현 — 따옴표로 그대로 5~10개
9. 하지 않는 것 — 글에서 보이지 않는 표현·과장·정보 (예: 가격, 단정적 공사 범위)`;

function analyzePrompt(items) {
  const body = items.map((e, i) => `■ 기준 글 ${i + 1}\n${e.text}`).join('\n\n');
  return `너는 인테리어 카페 글의 말투를 분석하는 편집자다. 파일을 읽거나 도구를 쓰지 말고, 아래 글만 보고 답한다.

아래는 같은 업체(${COMPANY})가 카페 '공사중 현장' 게시판에 올린 글이다. 이 업체 글의 말투·문체·구성 습관을 분석해서, 다른 사람이 읽고 똑같은 톤으로 새 글을 쓸 수 있는 지침으로 정리하라.
글에 없는 것은 지어내지 말고, 글에서 확인되는 것만 쓴다. 사진 자체와 지도, 영상은 글에 [ ] 로 표시돼 있다.

${지침형식}

답은 지침 본문만 출력한다. 서문·맺음말은 쓰지 않는다.

${body}`;
}

function mergePrompt(guide, items) {
  const body = items.map((e, i) => `■ 새로 추가된 기준 글 ${i + 1}\n${e.text}`).join('\n\n');
  return `너는 인테리어 카페 글의 말투를 분석하는 편집자다. 파일을 읽거나 도구를 쓰지 말고, 아래 내용만 보고 답한다.

아래 '현재 말투 지침'은 ${COMPANY} 카페 '공사중 현장' 글을 분석해 만든 것이다. 새로 추가된 기준 글을 읽고, 새 글에서 확인되는 말투·표현·구성 습관을 반영해 지침을 갱신하라.
- 기존 지침과 새 글이 같으면 그대로 두고, 새 글에만 있는 표현·패턴을 추가한다.
- 기존 지침과 새 글이 어긋나면, 두 가지가 모두 쓰인다고 적는다 (어느 한쪽을 지우지 않는다).
- 글에 없는 것은 지어내지 않는다. 형식과 항목 순서는 그대로 유지하고, 전체 60줄 이내로 유지한다.

답은 갱신된 지침 전체만 출력한다. 서문·맺음말은 쓰지 않는다.

=== 현재 말투 지침 ===
${guide}

${body}`;
}

async function runClaude(prompt, onLog) {
  const r = await ai.run({ prompt, cwd: DATA_DIR, allowedTools: 'Read', model: MODEL, onLog: (m) => onLog(`  ${m}`) });
  const text = (r.text || '').trim();
  if (!text) throw new Error('말투 분석 결과가 비어 있습니다.');
  return text;
}

/** 등록된 글을 전부 읽고 지침을 처음부터 다시 만든다. */
async function rebuild(onLog = () => {}) {
  const s = load();
  const items = s.links.map((l) => ({ ...l, text: articleText(l.id) })).filter((e) => e.text);
  if (!items.length) throw new Error('분석할 글이 없습니다. 기준 글 링크를 먼저 등록해 주세요.');
  onLog(`기준 글 ${items.length}건으로 말투를 분석합니다…`);
  s.guide = await runClaude(analyzePrompt(items), onLog);
  s.guideAt = new Date().toISOString();
  for (const l of s.links) if (items.some((e) => e.id === l.id)) l.analyzed = true;
  save(s);
  onLog('말투 지침을 만들었습니다.');
  return summary();
}

// ─────────────────────────────────────────────
// 링크 등록
// ─────────────────────────────────────────────

/** 카페 글 주소를 열어 제목과 본문 글자를 읽는다. (로그인된 크롬 필요) */
async function fetchArticle(url, onLog) {
  return chrome.withContext(async (context) => {
    const page = await context.newPage();
    try {
      onLog('글을 여는 중입니다…');
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(2500);
      if (/nid\.naver\.com/.test(page.url())) throw new Error('카페 로그인이 필요합니다. [로그인 창 열기]로 로그인해 주세요.');

      // 예전 주소(cafe.naver.com/카페명/글번호)는 글이 iframe 안에 있다.
      const root = page.frames().find((f) => f.name() === 'cafe_main') || page;
      await root.waitForSelector('.se-main-container, #tbody, .article_viewer, .ArticleContentBox', { timeout: 30000 });

      const data = await root.evaluate(() => {
        const q = (sel) => document.querySelector(sel);
        const title = (q('.title_text') || q('.ArticleTitle .title') || q('h3.title_text') || document.querySelector('title') || {}).innerText || document.title || '';
        const body = q('.se-main-container') || q('#tbody') || q('.article_viewer') || q('.ArticleContentBox');
        // 사진 설명(캡션)이 따로 있는 글을 위해 본문 줄을 그대로 모은다.
        const lines = body ? (body.innerText || '').split('\n') : [];
        return { title: String(title).trim(), lines };
      });

      const text = data.lines
        .map((l) => l.replace(new RegExp(String.fromCharCode(0x200b), 'g'), '').trim())
        // 지도 블록의 축척·저작권 표기는 글이 아니다.
        .filter((l) => l && !/^\d+\s?(m|km)$/i.test(l) && !/^©\s?NAVER/i.test(l))
        .join('\n');
      if (!text) throw new Error('글 본문을 읽지 못했습니다. 글 주소가 맞는지, 볼 수 있는 글인지 확인해 주세요.');
      return { title: data.title.replace(/\s+/g, ' '), text };
    } finally {
      await page.close().catch(() => {});
    }
  });
}

/**
 * 링크를 등록하고, 그 글만 분석해 지침에 합친다.
 * 이미 등록된 글이면 아무것도 하지 않는다.
 */
async function addLink(url, onLog = () => {}) {
  const id = articleId(url);
  if (!id) throw new Error('글 주소에서 글 번호를 찾지 못했습니다. 카페 글 주소를 그대로 붙여 넣어 주세요.');

  const s = load();
  if (s.links.some((l) => l.id === id)) {
    onLog('이미 등록된 글입니다.', 'warn');
    return { already: true, ...summary() };
  }

  const article = await fetchArticle(url.trim(), onLog);
  const kind = kindOf(article.title);
  fs.mkdirSync(ARTICLE_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(ARTICLE_DIR, `${id}.txt`),
    `[${kind === 'before' ? '공사전' : kind === 'during' ? '공사중' : '분류 미상'}] ${article.title}\n\n${article.text}\n`,
    'utf8'
  );
  const link = {
    id,
    url: url.trim(),
    title: article.title,
    kind,
    source: 'web',
    addedAt: new Date().toISOString(),
    chars: article.text.length,
  };
  s.links.push(link);
  save(s);
  onLog(`글을 읽었습니다 — ${article.title}`);

  // 정리된 지침이 있으면 새 글만 합치고, 없으면 처음부터 만든다.
  const item = { ...link, text: articleText(id) };
  if (s.guide) {
    onLog('새 글의 말투를 기존 지침에 합칩니다…');
    s.guide = await runClaude(mergePrompt(s.guide, [item]), onLog);
    s.guideAt = new Date().toISOString();
    link.analyzed = true;
    save(s);
    onLog('말투 지침을 갱신했습니다.');
  } else {
    await rebuild(onLog);
  }
  return summary();
}

/** 등록 글 하나를 목록에서 뺀다. 지침은 그대로 두며, 필요하면 [처음부터 다시 분석]을 쓴다. */
function removeLink(id) {
  const s = load();
  s.links = s.links.filter((l) => l.id !== String(id));
  save(s);
  fs.rmSync(path.join(ARTICLE_DIR, `${id}.txt`), { force: true });
  return summary();
}

module.exports = { summary, load, examples, rebuild, addLink, removeLink, articleId, kindOf, fetchArticle };
