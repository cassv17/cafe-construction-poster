# AGENTS.md — AI 코딩 도구용 안내 (Codex · ChatGPT · Cursor 등)

네이버 카페 '공사중 현장' 글을 AI로 작성하고 **임시등록까지** 하는 로컬 도구다. 사용법은 [README.md](README.md).
이 파일은 **코드를 고치거나 설치를 도와주는 AI**가 지킬 규칙이다. 사용자에게는 한국어로 답한다.

## 하지 말 것 (가장 중요)

1. **카페 [등록]/발행 버튼을 누르는 코드를 만들지 않는다.** 앱은 `임시등록`에서 멈춘다. 발행은 사람이 한다.
2. **회사 정보를 코드·문서에 넣지 않는다.** 카페 ID, 대표번호, 업체명, 로고, 게시판 번호는 `cafe.config.json` / `cafe/assets/` / `cafe/data/` 에만 둔다. 이 경로는 `.gitignore` 대상이다.
3. **`auth/`, `uploads/`, `cafe/data/`, `cafe.config.json` 을 커밋하지 않는다.** 고객 사진·로그인 쿠키가 들어 있다. `git add -A` 전에 `git status` 로 확인한다.
4. 사용자 대신 **로그인·비밀번호 입력을 하지 않는다.** 로그인은 설정 탭의 [로그인 창 열기]로 사용자가 직접 한다.
5. 서버는 `127.0.0.1` 에만 연다. 외부 노출 설정을 넣지 않는다.

## 구조 (한눈에)

| 경로 | 역할 |
|---|---|
| `server.js` | Express 서버, 포트 4174 |
| `cafe/config.js` | `cafe.config.json` + 환경변수 읽기 (`CAFE_ID`, `PHONE`, `COMPANY`, `AI_PROVIDER`) |
| `lib/ai.js` | **AI 창구.** `run({prompt, cwd, images})`. `claude` / `codex` 중 선택 |
| `lib/claude.js` | Claude Code CLI(`claude -p`) 호출 |
| `lib/codex.js` | Codex CLI(`codex exec`) 호출. 사진은 `-i` 첨부, 프롬프트는 stdin |
| `cafe/writer.js` | 초안 프롬프트와 JSON 파싱 |
| `cafe/editor.js` | 카페 SmartEditor ONE 입력 + `임시등록` |
| `cafe/chrome.js` | 로그인용 보이는 크롬 + 작업용 헤드리스 크롬(쿠키 복사) |
| `public/cafe.html` | 화면 (프레임워크 없는 단일 파일) |

## 설치를 도와줄 때

```bash
npm install
cp cafe.config.example.json cafe.config.json   # 값은 사용자에게 물어서 채운다
npm run check                                  # 전부 ✔ 여야 한다
npm start                                      # http://localhost:4174
```

- AI 종류는 `cafe.config.json` 의 `ai.provider` (`"claude"` | `"codex"`). 환경변수 `AI_PROVIDER` 가 우선한다.
- Codex 는 `codex login`, Claude 는 `claude` 실행으로 사용자가 직접 로그인한다.
- 윈도우에서 `claude.cmd` / `codex.cmd` 를 직접 `spawn` 하면 `EINVAL` 이 난다. `lib/claude.js`, `lib/codex.js` 의 실행 파일 탐색 방식을 유지한다.

## 코드 규칙

- CommonJS, 의존성은 `express multer playwright sharp` 만. 빌드 단계·테스트 프레임워크 없음.
- 사용자에게 보이는 문구와 코드 주석은 한국어. 식별자·경로·명령어는 영어/원문 그대로.
- AI 호출은 반드시 `lib/ai.js` 를 거친다. `cafe/*.js` 에서 `lib/claude.js` 나 `lib/codex.js` 를 직접 부르지 않는다.
- 새 AI 종류를 붙이려면 `lib/<이름>.js` 에 `run({prompt, cwd, images, model, onLog, onProcess}) → Promise<{text}>` 를 만들고 `lib/ai.js` 의 `backends` 에 한 줄 추가한다.
- Windows 에서 한글을 셸 인자/표준입력으로 넘기면 깨질 수 있다. 긴 프롬프트는 stdin, 정규식 백슬래시가 든 코드 수정은 셸 heredoc 대신 파일 편집 도구로 한다.
- 네이버 에디터 선택자(`cafe/editor.js` 의 `SEL`)는 실제 로그인 화면에서 확인한 값이다. 추측으로 바꾸지 말고 사용자 로그인 세션으로 직접 열어 확인한 뒤 고친다.

## 확인 방법

- 문법: `node --check cafe/*.js lib/*.js server.js`
- 설치 상태: `npm run check`
- AI 연결만 빠르게: 임시 스크립트에서 `AI_PROVIDER=codex node -e "require('./lib/ai').run({prompt:'1+1',cwd:process.cwd()}).then(r=>console.log(r.text))"`
- 카페 입력은 실제 카페 로그인이 필요하다. 시험 글은 임시등록 목록에 남으므로 끝나면 사용자에게 지우라고 알린다.
