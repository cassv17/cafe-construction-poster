// AI 열람용 축소 사본을 만든다.
//
// 🚨 원본은 절대 건드리지 않는다 (사진 무가공 원칙).
// 네이버에 올라가는 것도 원본이다. 여기서 만드는 사본은 오직 AI 가 눈으로 볼 용도다.
//
// 이미지 토큰은 픽셀 수에 비례한다. 3400x2266 원본은 장당 1만 토큰이 넘는데,
// 툴을 부를 때마다 컨텍스트가 통째로 다시 읽히므로 그 값이 턴 수만큼 곱해진다.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// 방 안 자재·색상·마감을 구분하기에 1280px 이면 충분하다.
const MAX_EDGE = 1280;
const QUALITY = 80;

/** AI 사본을 두는 폴더. 원본과 섞이지 않게 밑줄로 시작한다. */
function previewDir(photoDir) {
  return path.join(photoDir, '_ai');
}

/**
 * photoDir 안의 사진들을 축소해 _ai/ 에 넣고, 사본 경로 목록을 돌려준다.
 * 이미 만들어 둔 사본이 있으면 다시 만들지 않는다.
 */
async function makePreviews(photoDir, onLog = () => {}) {
  const out = previewDir(photoDir);
  fs.mkdirSync(out, { recursive: true });

  const files = fs
    .readdirSync(photoDir)
    .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
    .sort();

  const previews = [];
  let saved = 0;
  let original = 0;

  for (const file of files) {
    const src = path.join(photoDir, file);
    // 확장자를 jpg 로 통일한다. 파일명 본체는 그대로 둬야 사람이 알아본다.
    const dst = path.join(out, file.replace(/\.[^.]+$/, '.jpg'));

    if (!fs.existsSync(dst)) {
      await sharp(src)
        .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: QUALITY })
        .toFile(dst);
    }
    original += fs.statSync(src).size;
    saved += fs.statSync(dst).size;
    previews.push({ preview: dst, original: src, name: file });
  }

  if (previews.length) {
    const pct = (100 - (saved / original) * 100).toFixed(0);
    onLog(
      `AI 열람용 사본 ${previews.length}장 준비 — ${(original / 1024 / 1024).toFixed(0)}MB → ${(saved / 1024 / 1024).toFixed(1)}MB (${pct}% 감소)`
    );
  }
  return previews;
}

module.exports = { makePreviews, previewDir };
