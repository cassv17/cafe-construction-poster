# 카페 공사중 자동 발행

네이버 카페 **'공사중 현장' 게시판** 글을 AI가 대신 써 주는 로컬 도구입니다.

현장 정보와 사진을 넣으면 → AI가 사진을 보고 글을 쓰고 → 표지·제목·태그까지 만들어 → 카페 글쓰기 화면에 채워서 **[임시등록]까지** 해 줍니다.
**등록(발행)은 앱이 하지 않습니다.** 카페의 임시등록 목록에서 사람이 확인하고 직접 등록합니다.

- AI는 **Claude** 또는 **ChatGPT(Codex)** 중 하나를 고릅니다. 둘 다 API 키가 필요 없고, 내 PC에 로그인된 구독 계정을 씁니다.
- 작업은 **백그라운드**(보이지 않는 크롬)에서 돌고, 끝나면 윈도우 알림이 뜹니다.
- 윈도우 + 구글 크롬 기준으로 만들었습니다.

---

## 처음 한 번만 (약 10분)

> AI에게 맡기고 싶다면 아래 [AI에게 설치 맡기기](#ai에게-설치-맡기기)를 복사해서 Claude Code 또는 ChatGPT Codex에 붙여 넣으세요.

### 1. 준비물 설치

| 준비물 | 확인/설치 |
|---|---|
| Node.js 18 이상 | `node -v` |
| 구글 크롬 | 이미 있으면 통과 |
| AI 하나 (아래 중 택1) | |
| ├ Claude | `npm i -g @anthropic-ai/claude-code` → 터미널에서 `claude` 실행해 로그인 |
| └ ChatGPT | `npm i -g @openai/codex` → `codex login` 으로 ChatGPT 계정 로그인 |

### 2. 내려받고 설치

```bash
git clone https://github.com/cassv17/cafe-construction-poster.git
cd cafe-construction-poster
npm install
```

### 3. 설정 파일 만들기

1. `cafe.config.example.json` 을 복사해서 이름을 `cafe.config.json` 으로 바꿉니다.
2. 값을 채웁니다.

```json
{
  "cafeId": "12345678",
  "companyName": "우리 업체명",
  "phone": "1234-5678",
  "ai": { "provider": "claude", "model": "" }
}
```

| 항목 | 설명 |
|---|---|
| `cafeId` | 카페 글 주소 `cafe.naver.com/f-e/cafes/`**`12345678`**`/articles/…` 의 숫자 |
| `companyName` | AI가 글을 쓸 때 쓰는 업체명 |
| `phone` | 글 맨 아래 대표번호 (화면 설정 탭에서도 고칠 수 있음) |
| `ai.provider` | `"claude"` 또는 `"codex"` (ChatGPT) |
| `ai.model` | 비워 두면 기본 모델. 지정하고 싶을 때만 적기 |

> 같은 팀이면 팀장에게서 **설정 묶음**(cafe.config.json + 로고 + 말투 지침)을 받아 그대로 넣으면 3번이 끝납니다. 아래 [팀 설정 묶음](#팀-설정-묶음) 참고.

### 4. 점검

```bash
npm run check
```

전부 ✔ 가 나오면 준비 끝입니다. ✘ 아래에 고칠 방법이 나옵니다.

### 5. 실행

윈도우: `시작.bat` 더블클릭 (또는 `npm start`) → 브라우저에서 http://localhost:4174

### 6. 카페 로그인 (처음 한 번)

화면 **설정 탭 → [로그인 창 열기]** → 열린 크롬에서 **글쓰기 권한이 있는 카페 계정**으로 로그인합니다.
로그인되면 그 창은 닫아도 됩니다. 로그인이 풀리면 같은 방법으로 다시 로그인하세요.
비밀번호는 앱이 다루지 않습니다.

---

## 쓰는 순서

1. **설정 탭** — [카페에서 게시판 불러오기]로 지역별 게시판 연결, 말투 기준 글 링크를 붙여 넣고 [추가·분석]
2. **새 작업** — 공사전/공사중, 위치, 아파트명, 평수, 메모 입력 → [현장 확인]에서 지도 후보 선택 → 사진(·영상) 올리기 → [글 만들기 시작]
3. **직접 수정** — 제목, 소개글, 공간별 설명, 사진 배치, 표지, 해시태그를 고칩니다. 입력하면 자동 저장됩니다.
4. **[내용입력 후 임시 저장]** — 카페 글쓰기 화면에 채우고 [임시등록]까지 합니다. 끝나면 알림이 뜹니다.
5. **카페에서** 임시등록 목록을 열어 눈으로 확인하고 직접 [등록]합니다.

## Claude ↔ ChatGPT 바꾸기

`cafe.config.json` 의 `ai.provider` 만 바꾸고 서버를 다시 켭니다. 화면 상단에 현재 AI가 표시됩니다.

| | Claude | ChatGPT (Codex) |
|---|---|---|
| 설치 | `npm i -g @anthropic-ai/claude-code` | `npm i -g @openai/codex` |
| 로그인 | `claude` 실행 | `codex login` |
| 사진 보는 방식 | 파일을 열어 봄 | 이미지로 첨부 |
| 한도 | Claude 구독 한도 | ChatGPT 구독 한도 |

글 한 건(사진 약 30장)은 보통 1~3분 걸립니다.

## 팀 설정 묶음

회사 정보(카페 ID, 대표번호, 로고, 게시판, 말투 지침)는 공개 저장소에 올리지 않습니다. 팀장이 아래를 따로 전달합니다.

| 파일 | 넣을 위치 |
|---|---|
| `cafe.config.json` | 저장소 맨 위 |
| `logo-before.png`, `logo-during.png` | `cafe/assets/` (표지 하단 로고. 없으면 로고 없이 만들어짐) |
| `boards.json`, `style.json`, `articles/` | `cafe/data/` (선택. 없으면 설정 탭에서 다시 만들 수 있음) |

## 문제 해결

| 증상 | 원인 → 해결 |
|---|---|
| 화면에 "처음 설정이 필요합니다" | `cafe.config.json` 없음/카페 ID 없음 → 3번 |
| "로그인이 만료됐습니다" | 설정 탭에서 다시 로그인 |
| "claude/codex 실행 파일을 찾지 못했습니다" | 1번 설치 후 새 터미널에서 다시 실행 |
| Codex "로그인이 필요합니다" | `codex login` |
| 사용량 한도 안내 | 시간이 지나면 풀림. 다른 AI로 바꿔도 됨 |
| 카페 입력이 중간에 멈춤 | 네이버 에디터가 바뀌었을 수 있음 → 아래 기여 안내 |

## 알아둘 것

- 서버는 `127.0.0.1` 에만 열립니다. 외부에 노출하지 마세요.
- `auth/`(카페 로그인), `uploads/`, `cafe/data/`(작업·고객 사진), `cafe.config.json` 은 `.gitignore` 로 제외돼 있습니다. **절대 올리지 마세요.**
- 네이버 에디터 화면 구조에 기대어 동작하므로, 네이버가 화면을 바꾸면 `cafe/editor.js` 의 선택자를 고쳐야 할 수 있습니다.
- 이 도구는 사용자 본인 계정으로 사람이 하는 입력을 대신합니다. 네이버 이용약관과 카페 운영 규칙을 지키는 책임은 사용자에게 있습니다.

## 폴더 구조

```
server.js            로컬 서버 (포트 4174)
cafe/
  config.js          설정 읽기 (cafe.config.json)
  writer.js          AI 글 초안 프롬프트·파싱
  style.js           말투 기준 글 분석
  cover.js           표지 이미지 제작
  editor.js          카페 글쓰기 화면 입력 + 임시등록
  chrome.js          로그인 크롬 / 백그라운드 크롬
  places.js          지도 장소 검색
  boards.js          지역 → 게시판
  routes.js          API
lib/
  ai.js              AI 선택 (claude / codex)
  claude.js codex.js 각 CLI 호출
  images.js          AI용 축소 사진
public/cafe.html     화면
scripts/check.js     설치 점검
```

AI 도구(Codex, Cursor 등)로 코드를 고칠 때는 [AGENTS.md](AGENTS.md), Claude Code는 [CLAUDE.md](CLAUDE.md)를 먼저 읽게 하세요.

## AI에게 설치 맡기기

Claude Code 또는 ChatGPT Codex를 열고 아래를 붙여 넣으세요. (빈 폴더에서 시작)

```text
https://github.com/cassv17/cafe-construction-poster 를 이 폴더에 clone 하고,
README.md 의 "처음 한 번만" 순서대로 설치해 줘.
- npm install 까지 해 줘.
- cafe.config.json 은 내가 값을 알려줄 테니 만들기 전에 물어봐 줘.
- 마지막에 npm run check 를 돌려서 결과를 알려줘.
- 비밀번호나 로그인은 네가 하지 말고 내가 할 수 있게 안내만 해 줘.
```

## 라이선스

MIT
