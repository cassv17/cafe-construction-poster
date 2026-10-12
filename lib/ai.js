// AI 호출 창구. 글쓰기 코드는 이 파일만 부른다.
//
// cafe.config.json 의 ai.provider (또는 환경변수 AI_PROVIDER) 로 고른다.
//   "claude" — Claude Code CLI (Claude 구독)
//   "codex"  — Codex CLI (ChatGPT 구독)
// 둘 다 API 키가 필요 없고, 이 PC 에 로그인된 계정을 그대로 쓴다.
const { AI_PROVIDER, AI_MODEL } = require('../cafe/config');

const backends = {
  claude: () => require('./claude'),
  codex: () => require('./codex'),
};

function name() {
  return backends[AI_PROVIDER] ? AI_PROVIDER : 'claude';
}

/**
 * run({ prompt, cwd, images, onLog, onProcess })
 *  - images: 사진 파일의 절대 경로 목록.
 *    codex 는 첨부(-i)로 넘기고, claude 는 프롬프트에 적힌 경로를 Read 도구로 직접 연다.
 */
function run(opts) {
  if (!backends[AI_PROVIDER]) {
    throw new Error(`알 수 없는 AI 종류입니다: "${AI_PROVIDER}" — claude 또는 codex 중에서 골라 주세요 (cafe.config.json 의 ai.provider).`);
  }
  const model = opts.model || AI_MODEL;
  if (AI_PROVIDER === 'claude') return backends.claude().run({ ...opts, allowedTools: opts.allowedTools || ((opts.images || []).length ? 'Read' : undefined), model });
  return backends.codex().run({ ...opts, model });
}

/** 사진을 첨부로 받는 AI 인지 (true 면 프롬프트에 경로 대신 "첨부 n번"으로 적는다). */
function attachesImages() {
  return name() === 'codex';
}

module.exports = { run, name, attachesImages };
