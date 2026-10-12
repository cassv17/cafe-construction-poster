// 카페 공사중 자동 발행 — 로컬 서버. 내 PC 에서만 돈다. 외부에 노출하지 않는다.
const express = require('express');
const path = require('path');

// 브라우저 자동화는 어디서든 약속(Promise)이 거절될 수 있다. 처리되지 않은 거절 하나로
// 서버와 진행 중인 작업이 통째로 사라지지 않게 기록만 하고 계속 산다.
process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));
process.on('uncaughtException', (error) => console.error('[uncaughtException]', error));

const { CAFE_ID, AI_PROVIDER, CONFIG_FILE } = require('./cafe/config');

const app = express();
const PORT = process.env.PORT || 4174;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.redirect('/cafe.html'));

require('./cafe/routes').mount(app);

// 127.0.0.1 에만 연다 — 같은 네트워크의 다른 PC 가 접속하지 못한다.
app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  카페 공사중 자동 발행  →  http://localhost:${PORT}\n`);
  console.log(`  AI: ${AI_PROVIDER === 'codex' ? 'ChatGPT (Codex CLI)' : 'Claude (Claude Code CLI)'}`);
  if (!CAFE_ID) {
    console.log(`\n  ⚠ 카페 ID 가 없습니다. cafe.config.example.json 을 복사해 ${path.basename(CONFIG_FILE)} 로 만들고 값을 채운 뒤 다시 켜세요.\n`);
  }
});
