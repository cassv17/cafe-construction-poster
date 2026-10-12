// 지역 → 카페 '공사중 현장' 게시판 연결.
//
// 레퍼런스 글 주소의 menuid 로 확인된 것(서울 282, 부산 67, 대전·세종 258)을 기본값으로 두고,
// 로그인된 크롬으로 카페 메뉴를 읽어 나머지 지역을 채운다. 화면에서 직접 고칠 수도 있다.
const fs = require('fs');
const path = require('path');
const chrome = require('./chrome');
const { DATA_DIR, CAFE_ID } = require('./config');

const FILE = path.join(DATA_DIR, 'boards.json');

const DEFAULT = {
  byRegion: {}, // 설정 탭의 [카페에서 게시판 불러오기]로 채운다
  all: [],
  updatedAt: null,
};

const 시도줄임 = [
  [/^서울/, '서울'], [/^부산/, '부산'], [/^대구/, '대구'], [/^인천/, '인천'], [/^광주/, '광주'],
  [/^대전/, '대전'], [/^울산/, '울산'], [/^세종/, '세종'], [/^경기/, '경기'], [/^강원/, '강원'],
  [/^충청?북|^충북/, '충북'], [/^충청?남|^충남/, '충남'], [/^전라?북|^전북/, '전북'], [/^전라?남|^전남/, '전남'],
  [/^경상?북|^경북/, '경북'], [/^경상?남|^경남/, '경남'], [/^제주/, '제주'],
];

/** 서울특별시 → 서울, 경기도 → 경기 … 못 알아보면 입력 그대로. */
function normRegion(s) {
  const t = String(s || '').trim();
  for (const [re, short] of 시도줄임) if (re.test(t)) return short;
  return t;
}

function load() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { ...DEFAULT, ...d, byRegion: { ...DEFAULT.byRegion, ...(d.byRegion || {}) } };
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT));
  }
}

function save(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
  return data;
}

/**
 * 현장 위치에 맞는 게시판. 없으면 null.
 * 게시판은 시/도가 아니라 도시 단위인 곳이 많다(김해, 창원, 수원·동탄, 용인…).
 * 그래서 구/시 → 동 → 시/도 순서로 찾는다.
 */
function pick(시도, 구 = '', 동 = '') {
  const d = load();
  const tokens = String(구 + ' ' + 동)
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/시$/, ''));
  for (const t of tokens) if (d.byRegion[t]) return d.byRegion[t];
  return d.byRegion[normRegion(시도)] || null;
}

/** 화면에서 지역 → 게시판을 직접 지정한다. */
function setRegion(region, menuId, name) {
  const d = load();
  const key = normRegion(region);
  if (!key) throw new Error('지역을 입력해 주세요.');
  if (!menuId) delete d.byRegion[key];
  else d.byRegion[key] = { menuId: Number(menuId), name: name || `게시판 ${menuId}` };
  return save(d);
}

function collectMenus(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.forEach((n) => collectMenus(n, out));
  if (node.menuId != null && typeof node.menuName === 'string') {
    out.push({ menuId: Number(node.menuId), name: node.menuName.trim(), type: node.menuType || null });
  }
  for (const v of Object.values(node)) collectMenus(v, out);
}

/** 로그인된 크롬으로 카페 메뉴 목록을 읽어 '공사중 현장' 게시판을 지역에 연결한다. */
async function refresh(onLog = () => {}) {
  const menus = await chrome.withContext(async (context) => {
    onLog('카페 게시판 목록을 읽는 중입니다…');
    const res = await context.request.get(`https://apis.naver.com/cafe-web/cafe2/SideMenuList?cafeId=${CAFE_ID}`, {
      headers: { Referer: `https://cafe.naver.com/f-e/cafes/${CAFE_ID}` },
      timeout: 30000,
    });
    if (!res.ok()) throw new Error(`게시판 목록을 못 읽었습니다 (HTTP ${res.status()}). 카페 로그인을 확인해 주세요.`);
    const out = [];
    collectMenus(await res.json(), out);
    return out;
  });

  const seen = new Set();
  const all = menus.filter((m) => m.name && !seen.has(m.menuId) && seen.add(m.menuId));
  if (!all.length) throw new Error('카페 게시판을 찾지 못했습니다. 로그인 상태를 확인해 주세요.');

  const d = load();
  d.all = all.filter((m) => /공사\s*중/.test(m.name));
  // "서울 공사중 현장", "대전,세종 공사중 현장" 처럼 앞쪽이 지역이다.
  for (const m of d.all) {
    const head = m.name.replace(/\s*공사\s*중.*$/, '');
    for (const part of head.split(/[,，/·]/)) {
      const key = normRegion(part);
      if (key) d.byRegion[key] = { menuId: m.menuId, name: m.name };
    }
  }
  d.updatedAt = new Date().toISOString();
  save(d);
  onLog(`'공사중 현장' 게시판 ${d.all.length}개를 찾았습니다.`);
  return d;
}

module.exports = { load, pick, setRegion, refresh, normRegion };
