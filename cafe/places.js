// 현장명 확인 — 네이버 지도 장소 검색 후보를 보여 주기 위한 검색.
//
// 지도 첨부에 쓰는 것과 같은 검색(카페 글쓰기 화면의 장소 창)을 쓴다. 그래서 여기서 고른 이름은 지도에서 그대로 나온다.
// 네이버 지도 공개 API 는 자동 조회를 캡차로 막아서 쓰지 않는다. 로그인된 앱 전용 크롬의 에디터 창을 쓴다.
const chrome = require('./chrome');
const { CAFE_ID } = require('./config');

const LOGIN_MSG = '카페에 로그인돼 있지 않습니다. 설정 탭의 [로그인 창 열기]로 열린 크롬에서 글쓰기 권한이 있는 운영진 계정으로 로그인해 주세요.';
// 에디터 토큰만 받으면 되므로 어느 게시판이든 상관없다. 등록된 게시판이 있으면 그중 하나를 쓴다.
function writeUrl() {
  const any = Object.values(require('./boards').load().byRegion || {})[0];
  return `https://cafe.naver.com/ca-fe/cafes/${CAFE_ID}/articles/write?boardType=L${any ? `&menuId=${any.menuId}` : ''}`;
}

// 아파트가 아닌 장소(같은 이름이 같이 나온다)는 후보에서 뺀다.
const 제외 = /관리사무소|복지관|중개|부동산|경로당|어린이집|유치원|주차장|상가|공인|입구|후문|정문|놀이터|도서관|은행|병원|의원|약국|편의점|카페|학교|\d+동$/;

// ─────────────────────────────────────────────
// 이름 비슷한 정도 (한글 자모 단위 편집거리)
// ─────────────────────────────────────────────
const 초 = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const 중 = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const 종 = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

function jamo(str) {
  let out = '';
  for (const ch of String(str)) {
    const c = ch.charCodeAt(0);
    if (c >= 0xac00 && c <= 0xd7a3) {
      const n = c - 0xac00;
      out += 초[Math.floor(n / 588)] + 중[Math.floor((n % 588) / 28)] + 종[n % 28];
    } else out += ch;
  }
  return out;
}

function distance(a, b) {
  const m = a.length;
  const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[m][n];
}

/** 비교용 이름: 공백·'아파트' 를 떼고 자모로 푼다. */
const core = (s) => jamo(String(s).replace(/\s+/g, '').replace(/아파트/g, ''));

/** 0~1, 클수록 비슷하다. 후보 이름이 입력을 포함하면 높게 친다. */
function similarity(input, candidate) {
  const a = core(input);
  const b = core(candidate);
  if (!a || !b) return 0;
  if (b.includes(a) || a.includes(b)) return 0.9 + 0.1 * (Math.min(a.length, b.length) / Math.max(a.length, b.length));
  return 1 - distance(a, b) / Math.max(a.length, b.length);
}


// ─────────────────────────────────────────────
// 검색 — 토큰을 한 번만 받고, 이후는 브라우저 없이 직접 호출한다 (0.2초)
// ─────────────────────────────────────────────
//
// 카페 글쓰기 화면의 장소 창은 platform.editor.naver.com 의 장소 검색을 부른다. 그 요청에는 에디터가 발급받은
// 토큰(se-authorization, 유효 1시간)이 붙는다. 글쓰기 화면을 한 번 열어 그 토큰만 받아 두면 이후 검색은
// Node 에서 곧바로 부를 수 있다. (예전: 검색마다 화면을 새로 열어 약 14초 → 지금: 첫 준비 1초, 검색 0.2초)
const API = 'https://platform.editor.naver.com/api/cafepc001/v1/map/naver/places';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let token = null; // { value, exp(ms) }
let tokenPending = null;

function jwtExp(jwt) {
  try {
    const payload = JSON.parse(Buffer.from(String(jwt).split('.')[1], 'base64url').toString());
    return payload.exp ? payload.exp * 1000 : Date.now() + 30 * 60 * 1000;
  } catch {
    return Date.now() + 30 * 60 * 1000;
  }
}

/** 글쓰기 화면을 열어 에디터 토큰만 받아 온다. 동시에 여러 번 불려도 한 번만 연다. */
function fetchToken() {
  if (tokenPending) return tokenPending;
  tokenPending = chrome
    .withContext(async (context) => {
      // 🚨 로그인이 안 돼 있으면 글쓰기 화면 대신 로그인 화면이 떠서 토큰이 오지 않는다.
      //    이름 문제가 아니라 로그인 문제이므로 바로 알려 준다.
      const names = new Set((await context.cookies('https://cafe.naver.com')).map((c) => c.name));
      if (!['NID_AUT', 'NID_SES'].every((n) => names.has(n))) throw new Error(LOGIN_MSG);
      const page = await context.newPage();
      try {
        let value = null;
        page.on('request', (r) => {
          if (!value && /platform\.editor\.naver\.com\/api\/cafepc001\//.test(r.url())) value = r.headers()['se-authorization'] || null;
        });
        page.on('dialog', (d) => d.dismiss().catch(() => {}));
        await page.goto(writeUrl(), { waitUntil: 'domcontentloaded', timeout: 60000 });
        if (/nid\.naver\.com/.test(page.url())) {
          chrome.forgetLogin(); // 저장해 둔 로그인이 만료됐다
          throw new Error(LOGIN_MSG);
        }
        const deadline = Date.now() + 30000;
        while (!value && Date.now() < deadline) await page.waitForTimeout(150);
        if (!value) {
          throw new Error('카페 글쓰기 화면이 열리지 않았습니다. 글쓰기 권한이 있는 운영진 계정으로 로그인했는지 확인해 주세요.');
        }
        return { value, exp: jwtExp(value) };
      } finally {
        await page.close().catch(() => {});
      }
    })
    .then((t) => {
      token = t;
      return t;
    })
    .finally(() => {
      tokenPending = null;
    });
  return tokenPending;
}

/** 쓸 수 있는 토큰. 만료 3분 전이면 새로 받는다. */
async function getToken(force = false) {
  if (!force && token && token.exp - Date.now() > 3 * 60 * 1000) return token;
  return fetchToken();
}

/** 새 작업 화면을 열 때 미리 불러 둔다. 검색할 때 기다리지 않게. 실패해도 조용히 넘긴다. */
async function warm() {
  const t = await getToken();
  return { ready: true, expiresInMin: Math.round((t.exp - Date.now()) / 60000) };
}

async function callOnce(query, tok, displayCount) {
  const r = await fetch(`${API}?query=${encodeURIComponent(query)}&siteSort=0&displayCount=${displayCount}&page=1`, {
    headers: { 'se-authorization': tok.value, Referer: 'https://cafe.naver.com/', Origin: 'https://cafe.naver.com', 'User-Agent': UA },
  });
  if (r.status === 401 || r.status === 403) return { unauthorized: true };
  if (!r.ok) throw new Error(`장소 검색 응답 오류 (HTTP ${r.status})`);
  const j = await r.json().catch(() => ({}));
  return { list: ((j.result || {}).place || {}).list || [] };
}

/** 검색어 하나. 토큰이 거절되면 새로 받아 한 번 더 시도한다. */
async function query(q, displayCount = 30) {
  let res = await callOnce(q, await getToken(), displayCount);
  if (res.unauthorized) res = await callOnce(q, await getToken(true), displayCount);
  if (res.unauthorized) throw new Error('장소 검색 권한을 받지 못했습니다. 카페 로그인을 확인해 주세요.');
  return res.list;
}

/** 검색어 목록. 구·동을 넣은 것부터 — 같은 이름이 다른 지역에도 있다(예: 부곡푸르지오는 군포·김천에도 있다). */
function queriesFor({ 시도, 구, 동, 아파트명 }) {
  const name = String(아파트명 || '').trim();
  const area = String(동 || '').trim();
  const gu = String(구 || '').trim();
  const qs = [];
  if (gu && area) qs.push(`${gu} ${area} ${name}`);
  if (area) qs.push(`${area} ${name}`);
  if (gu) qs.push(`${gu} ${name}`);
  qs.push(name);
  // 이름을 잘못 적었을 때를 위해 그 동네 아파트 목록도 가져와 비슷한 이름을 찾는다.
  if (gu && area) qs.push(`${gu} ${area} 아파트`);
  else if (area || gu) qs.push(`${area || gu} 아파트`);
  return [...new Set(qs.filter(Boolean))];
}

/** 아파트 단지인지. 학원·은행·상가처럼 연락처나 층·호가 붙은 곳은 뺀다. */
function isComplex(item) {
  const name = String(item.name || '').trim();
  if (!name || 제외.test(name)) return false;
  if (item.tel || item.virtualTel) return false;
  const addr = String(item.address || '');
  // 아파트 안에 입점한 가게는 주소에 층·호나 '(동, 단지명)' 이 붙는다.
  if (/\d+\s*(층|호)/.test(addr) || /\(/.test(String(item.roadAddress || ''))) return false;
  if (/점$|센터|학원|교습|ATM|지점|클리닉|마트|세탁|헬스|스터디|식당|치킨|피자|미용|네일/.test(name)) return false;
  return /아파트$|단지$|타운$|빌리지$|캐슬|푸르지오|자이|래미안|힐스테이트|e편한세상|아이파크|더샵|롯데|뷰$|파크|리버|시티|마을|맨션|하이츠|팰리스/.test(name) || !item.thumUrl;
}

/** 시/도·구가 맞으면 앞으로 보낸다. 점수는 이름 비슷한 정도 + 지역 일치. */
function rank(info, items) {
  const 시도 = String(info.시도 || '').trim();
  const 구 = String(info.구 || '').trim().split(/\s+/).pop() || '';
  return items
    .map((it) => {
      const addr = `${it.address} ${it.roadAddress}`;
      const region = (구 && addr.includes(구) ? 0.5 : 0) + (시도 && addr.includes(시도.replace(/(특별시|광역시|특별자치시|특별자치도|도)$/, '')) ? 0.3 : 0);
      const sim = similarity(info.아파트명, it.name);
      return { name: it.name, address: it.roadAddress || it.address, jibun: it.address, score: Number((sim + region).toFixed(3)), sim: Number(sim.toFixed(3)), regionMatch: region > 0 };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * 후보를 찾는다. 돌려주는 값: [{ name, address, score, regionMatch }] (비슷한 순, 최대 limit 개)
 * 같은 이름·주소는 하나로 합친다.
 */
async function search(info, { limit = 8, onLog = () => {} } = {}) {
  const qs = queriesFor(info);
  if (!qs.length) return [];
  const t0 = Date.now();
  const lists = await Promise.all(qs.map((q) => query(q)));
  const seen = new Set();
  const items = [];
  for (const it of lists.flat()) {
    if (!isComplex(it)) continue;
    const key = `${it.name}|${it.roadAddress || it.address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(it);
  }
  onLog(`장소 검색 ${qs.length}건 ${Date.now() - t0}ms`);
  return rank(info, items).slice(0, limit);
}

module.exports = { search, warm, similarity, queriesFor };
