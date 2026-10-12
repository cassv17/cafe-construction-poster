// 설치 점검: node scripts/check.js  (또는 npm run check)
// 설정·AI·크롬이 준비됐는지 한 번에 알려 준다. 아무것도 바꾸지 않는다.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { CAFE_ID, AI_PROVIDER, CONFIG_FILE } = require('../cafe/config');

const rows = [];
const add = (ok, name, hint) => rows.push({ ok, name, hint });

add(fs.existsSync(CONFIG_FILE), 'cafe.config.json 있음', 'cafe.config.example.json 을 cafe.config.json 으로 복사하세요');
add(/^\d+$/.test(CAFE_ID), '카페 ID(숫자)', 'cafe.config.json 의 cafeId 에 카페 주소의 숫자를 넣으세요');
add(fs.existsSync(path.join(__dirname, '..', 'node_modules')), 'npm install 완료', '터미널에서 npm install 을 실행하세요');

// 실행 파일 위치만 확인한다 (AI 를 부르지 않는다).
const probe = AI_PROVIDER === 'codex' ? 'codex' : 'claude';
const found = spawnSync(process.platform === 'win32' ? 'where' : 'which', [probe], { encoding: 'utf8' });
add(
  AI_PROVIDER === 'codex' || AI_PROVIDER === 'claude',
  `AI 종류 = ${AI_PROVIDER}`,
  'cafe.config.json 의 ai.provider 는 claude 또는 codex 여야 합니다'
);
add(
  found.status === 0,
  `${probe} CLI 설치됨`,
  AI_PROVIDER === 'codex' ? 'npm i -g @openai/codex 후 codex login' : 'npm i -g @anthropic-ai/claude-code 후 claude 로 로그인'
);

const chromePaths = [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
  .filter(Boolean)
  .map((r) => path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'));
add(chromePaths.some((p) => fs.existsSync(p)), '구글 크롬 설치됨', 'https://www.google.com/chrome 에서 설치하세요 (윈도우 기준)');

for (const r of rows) console.log(`${r.ok ? '✔' : '✘'} ${r.name}${r.ok ? '' : `\n    → ${r.hint}`}`);
process.exit(rows.every((r) => r.ok) ? 0 : 1);
