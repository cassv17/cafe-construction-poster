// codex CLI(exec) 를 한 번씩 돌린다. ChatGPT 구독 로그인을 그대로 쓴다 (API 키 불필요).
//
// claude.js 와 같은 모양으로 run({ prompt, cwd, images, model, onLog, onProcess }) → { text } 를 돌려준다.
// 사진은 -i 로 첨부한다 (Claude 처럼 파일을 열어 보는 방식이 아니다).
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * codex 실행 방법을 찾는다.
 * 🚨 윈도우에서 codex.cmd 를 spawn 하면 EINVAL 이 난다. 패키지의 bin/codex.js 를 node 로 직접 돌린다.
 * 반환: { cmd, pre } — spawn(cmd, [...pre, ...args])
 */
function resolveBin() {
  if (process.env.CODEX_BIN) return { cmd: process.env.CODEX_BIN, pre: [] };
  if (process.platform !== 'win32') return { cmd: 'codex', pre: [] };

  const rels = ['node_modules', '@openai', 'codex', 'bin', 'codex.js'];
  const candidates = [];
  if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, 'npm', ...rels));
  try {
    const npmRoot = execSync('npm root -g', { encoding: 'utf8', windowsHide: true }).trim();
    candidates.push(path.join(npmRoot, '@openai', 'codex', 'bin', 'codex.js'));
  } catch {
    // npm 이 없어도 위 후보로 찾을 수 있다.
  }
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error('codex 실행 파일을 찾지 못했습니다. `npm i -g @openai/codex` 로 설치하거나 CODEX_BIN 환경변수로 경로를 지정해 주세요.');
  }
  return { cmd: process.execPath, pre: [found] };
}

let cached = null;
function getBin() {
  if (!cached) cached = resolveBin();
  return cached;
}

function explain(raw) {
  if (/not logged in|login|unauthorized|401|sign in/i.test(raw)) {
    return 'Codex 로그인이 필요합니다. 터미널에서 `codex login` 을 실행해 ChatGPT 계정으로 로그인해 주세요.';
  }
  if (/usage limit|rate limit|quota|429/i.test(raw)) {
    return 'ChatGPT 사용량 한도에 걸렸습니다. 잠시 뒤 다시 시도해 주세요.';
  }
  return raw;
}

function run({ prompt, cwd, images = [], model, onLog = () => {}, onProcess = () => {} }) {
  const outFile = path.join(os.tmpdir(), `codex-out-${process.pid}-${Date.now()}.txt`);
  const { cmd, pre } = getBin();
  const args = [
    ...pre,
    'exec',
    '--skip-git-repo-check',
    '--ephemeral',
    '-s', 'read-only', // 글만 쓰면 되므로 파일을 고치지 못하게 한다
    '--json',
    '-C', cwd,
    '-o', outFile,
  ];
  if (model) args.push('-m', model);
  // -i 는 값을 여러 개 받는 옵션이라 맨 뒤에 둔다. 프롬프트는 stdin 으로 넘긴다(길이·한글 인코딩 문제 방지).
  for (const img of images) args.push('-i', img);

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, shell: false, windowsHide: true, env: { ...process.env, FORCE_COLOR: '0' } });
    onProcess(child);

    let buffer = '';
    let lastMessage = '';
    let errorText = '';

    child.stdin.on('error', () => {}); // 프로세스가 먼저 끝나도 무시
    child.stdin.end(prompt, 'utf8');

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        let ev;
        try {
          ev = JSON.parse(t);
        } catch {
          continue;
        }
        const item = ev.item || {};
        if (ev.type === 'item.completed' && item.type === 'agent_message' && item.text) {
          lastMessage = item.text;
          onLog(String(item.text).trim().split('\n')[0].slice(0, 140));
        } else if (ev.type === 'error' || ev.type === 'turn.failed') {
          errorText += (ev.message || (ev.error && ev.error.message) || '') + '\n';
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8').trim();
      if (text) errorText += text + '\n';
    });

    child.on('error', (e) => reject(new Error(`codex 실행 실패: ${e.message} (codex CLI 가 설치돼 있는지 확인해 주세요)`)));
    child.on('close', (code, signal) => {
      let text = '';
      try {
        text = fs.readFileSync(outFile, 'utf8');
        fs.unlinkSync(outFile);
      } catch {
        // 출력 파일이 없으면 스트림에서 모은 마지막 메시지를 쓴다
      }
      text = (text || lastMessage || '').trim();
      if (signal) return reject(new Error('작업이 중단되었습니다.'));
      if (code !== 0 || !text) {
        return reject(new Error(explain(errorText.trim() || `codex 가 오류로 종료했습니다 (코드 ${code})`)));
      }
      resolve({ text, usage: null, sessionId: null });
    });
  });
}

module.exports = { run, explain };
