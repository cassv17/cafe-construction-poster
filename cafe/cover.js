// 카페 표지 이미지(3000×3000) 제작.
//
// 포토샵 원본(카페 공사전/공사중 표지 PSD)의 배치를 그대로 재현한다.
// 회색 배경 → 윗줄 제목(위아래 가는 선) → 흰 카드 안에 현장 사진 → 우상단 둥근 배지 → 아래 로고.
// 공사전/공사중은 배지 문구·색과 로고 색만 다르다.
//
// 글자는 크롬으로 그려서 PNG/JPG 로 뽑는다 (한글 글꼴을 가장 안정적으로 다룬다).
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { chromium } = require('playwright');
const { ASSET_DIR } = require('./config');
const { 동표기 } = require('./names');

const 종류 = {
  before: { 배지: '공사전', 색: '#FFAF26', 로고: 'logo-before.png' },
  during: { 배지: '공사중', 색: '#D66F31', 로고: 'logo-during.png' },
};

// PSD 에서 잰 좌표(3000×3000 기준). 카드 흰 영역 x 319..2680, y 473..2834.
const 사진틀 = { left: 396, top: 566, width: 2206, height: 1996 };
// 사진 채도 배율 — PSD 색조/채도 -80 (-80~-90 사이).
const 채도 = 0.2;
const 제목글자 = { 최대너비: 2300, 기본크기: 122, 최소크기: 70 };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function html({ 제목, 배지, 색, 사진URL, 로고URL, 배경 }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0}
  body{width:3000px;height:3000px;background:#EEEEED;position:relative;overflow:hidden;
       font-family:'Pretendard','Noto Sans KR','Malgun Gothic',sans-serif;color:#000}
  .rule{position:absolute;left:319px;width:2361px;height:3px;background:#1A1E25}
  .r1{top:144px}.r2{top:340px}
  .title{position:absolute;left:319px;width:2361px;top:147px;height:193px;display:flex;
         align-items:center;justify-content:center;white-space:nowrap;font-weight:400;
         letter-spacing:-0.01em;font-size:${제목글자.기본크기}px;line-height:1}
  .card{position:absolute;left:319px;top:473px;width:2361px;height:2361px;background:#fff;
        box-shadow:0 0 18px rgba(0,0,0,.10)}
  .photo{position:absolute;left:${사진틀.left}px;top:${사진틀.top}px;width:${사진틀.width}px;height:${사진틀.height}px;
         background:#ddd url("${사진URL}") ${배경.x}% ${배경.y}% / ${배경.w}px ${배경.h}px no-repeat}
  .badge{position:absolute;left:${2542 - 240}px;top:${798 - 240}px;width:480px;height:480px;border-radius:50%;
         background:${색};box-shadow:0 8px 18px rgba(0,0,0,.28);display:flex;align-items:center;
         justify-content:center;color:#fff;font-weight:700;font-size:118px;letter-spacing:-0.02em}
  .logo{position:absolute;left:1185px;top:2643px;width:638px;height:131px}
  </style></head><body>
  <div class="rule r1"></div>
  <div class="title" id="t">${esc(제목)}</div>
  <div class="rule r2"></div>
  <div class="card"></div>
  <div class="photo"></div>
  <div class="badge">${esc(배지)}</div>
  ${로고URL ? `<img class="logo" src="${로고URL}">` : ''}
  </body></html>`;
}

const dataUrl = (buf, mime) => `data:${mime};base64,${buf.toString('base64')}`;

/** 표지 제목 한 줄. 예) 서울 마포구 공덕동 래미안공덕3차 32PY */
function 표지제목({ 시도, 구, 동, 아파트명, 평수 }) {
  const 평 = String(평수 || '').replace(/[^\d.]/g, '');
  // 아파트명이 동 이름으로 시작하면 위치의 동은 뺀다 (names.js)
  return [시도, 구, 동표기({ 동, 아파트명 }), 아파트명].map((v) => String(v || '').trim()).filter(Boolean).join(' ') + (평 ? ` ${평}PY` : '');
}

/**
 * 표지를 만든다.
 *   photo  — 표지에 넣을 원본 사진 경로
 *   out    — 저장할 .jpg 경로
 *   분류   — 'before'(공사전) | 'during'(공사중)
 *   x, y   — 사진 틀 안에서의 위치 (0~100 %, 기본 50 = 가운데). 사진이 틀보다 클 때 어느 부분을 보여 줄지.
 *   zoom   — 확대 배율 (1 = 틀을 꽉 채우는 크기, 최대 3)
 *   초점Y  — (예전 값) y 와 같다
 */
async function 만들기({ photo, out, 분류, 제목, x = 50, y, zoom = 1, 초점Y }) {
  if (y === undefined) y = 초점Y === undefined ? 50 : 초점Y;
  x = Math.min(100, Math.max(0, Number(x)));
  y = Math.min(100, Math.max(0, Number(y)));
  zoom = Math.min(3, Math.max(1, Number(zoom) || 1));
  const 설정 = 종류[분류];
  if (!설정) throw new Error(`표지 분류를 알 수 없습니다: ${분류}`);
  if (!fs.existsSync(photo)) throw new Error(`표지 사진을 찾지 못했습니다: ${photo}`);

  // 큰 원본을 그대로 넣으면 느리다. 틀 크기의 약 1.2배로 줄여 쓴다 (EXIF 회전 반영).
  // 레퍼런스(PSD)는 사진에 '색조/채도 -80' 을 걸어 흑백에 가까운 톤으로 쓴다
  // (레이어 이름도 "마스크 하고 채도 -80~90"). 채도 -80 = 원래 채도의 20%.
  const 사진 = await sharp(photo)
    .rotate()
    .resize({ width: 3600, height: 3600, fit: 'inside', withoutEnlargement: true })
    .modulate({ saturation: 채도 })
    .jpeg({ quality: 92 })
    .toBuffer();
  // 틀을 꽉 채우는 크기(cover)에 확대 배율을 곱한 크기로 깐다. 화면의 미리보기도 같은 식을 쓴다.
  const meta = await sharp(사진).metadata();
  const 비율 = meta.width / meta.height;
  const 틀비율 = 사진틀.width / 사진틀.height;
  const 높이 = 비율 >= 틀비율 ? 사진틀.height * zoom : (사진틀.width * zoom) / 비율;
  const 배경 = { x, y, w: Math.round(높이 * 비율), h: Math.round(높이) };
  // 로고 파일(cafe/assets/logo-before.png, logo-during.png)이 없으면 로고 없이 만든다.
  const 로고파일 = path.join(ASSET_DIR, 설정.로고);
  const 로고 = fs.existsSync(로고파일) ? fs.readFileSync(로고파일) : null;

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 3000, height: 3000 }, deviceScaleFactor: 1 });
    await page.setContent(
      html({
        제목,
        배지: 설정.배지,
        색: 설정.색,
        사진URL: dataUrl(사진, 'image/jpeg'),
        로고URL: 로고 ? dataUrl(로고, 'image/png') : '',
        배경,
      }),
      { waitUntil: 'load' }
    );
    await page.evaluate(() => document.fonts && document.fonts.ready);

    // 제목이 선 안(너비)에 들어오도록 글자 크기를 줄인다.
    await page.evaluate(({ 최대너비, 최소크기 }) => {
      const t = document.getElementById('t');
      const span = document.createElement('span');
      span.textContent = t.textContent;
      t.textContent = '';
      t.appendChild(span);
      let size = parseFloat(getComputedStyle(t).fontSize);
      while (span.getBoundingClientRect().width > 최대너비 && size > 최소크기) {
        size -= 2;
        t.style.fontSize = size + 'px';
      }
    }, 제목글자);

    fs.mkdirSync(path.dirname(out), { recursive: true });
    const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 3000, height: 3000 } });
    await sharp(png).jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toFile(out);
    return out;
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { 만들기, 표지제목 };
