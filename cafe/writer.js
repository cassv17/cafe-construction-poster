// 본문 초안 작성 — 사진을 보고 공간별로 묶고, 말투 지침대로 설명을 쓴다.
//
// 표지·지도·대표번호·영상은 코드가 넣는다. AI 는 소개글 / 공간별 사진 묶음+설명 / 마무리글만 쓴다.
const fs = require('fs');
const path = require('path');
const ai = require('../lib/ai');
const { makePreviews } = require('../lib/images');
const { COMPANY } = require('./config');
const style = require('./style');
const jobs = require('./jobs');
const settings = require('./settings');

const MODEL = process.env.WRITER_MODEL || undefined;

const 분류설명 = {
  before: '공사 전 — 아직 공사를 시작하기 전, 철거 전 현장의 모습',
  during: '공사중 — 공사가 시작되어 진행되고 있는 현장의 모습',
};

function prompt(job, 사본목록, 설정) {
  const 지침 = style.load().guide || '(아직 정리된 지침이 없다. 아래 기준 글의 말투를 그대로 따른다.)';
  const 예시 = style
    .examples(job.분류, 3)
    .map((e, i) => `--- 기준 글 ${i + 1} (${e.kind === 'before' ? '공사전' : e.kind === 'during' ? '공사중' : '분류 미상'}) ---\n${e.text}`)
    .join('\n\n');
  // Codex 는 사진을 첨부로 받고, Claude 는 경로를 Read 도구로 직접 연다.
  const 첨부 = ai.attachesImages();
  const 사진 = 사본목록.map((p, i) => (첨부 ? `${i + 1}. 파일명: ${p.name}` : `${i + 1}. 파일명: ${p.name}\n   열람용: ${p.preview}`)).join('\n');
  const 위치 = [job.시도, job.구, job.동].filter(Boolean).join(' ');

  const 문의 = 설정.homepage
    ? `댓글, 대표번호(${설정.phone}), 홈페이지 견적문의(${설정.homepage})로 남겨 달라고 안내한다.`
    : `댓글이나 대표번호로 문의해 달라고 안내한다. 홈페이지 주소는 쓰지 않는다.`;

  return `너는 인테리어 업체 '${COMPANY}'의 네이버 카페 '공사중 현장' 게시판 글을 쓴다.
이 글은 실제 현장을 간단히 소개하는 글이다. 사진을 보고 어떤 상태인지 설명하고, 앞으로 어떻게 달라질지 기대해 달라는 내용으로 쓴다.

## 현장 정보
- 분류: ${분류설명[job.분류] || job.분류}
- 위치: ${위치}
- 아파트: ${job.아파트명}
- 평수: ${job.평수 ? String(job.평수).replace(/[^\d.]/g, '') + '평' : '(미입력)'}
- 담당자 메모(사실의 근거): ${job.메모 ? '\n' + job.메모 : '(없음)'}

## 사진 ${사본목록.length}장 (업로드 순서 = 현장 동선 순서)
${첨부 ? '첨부된 이미지가 아래 목록과 같은 순서다(첨부 n번째 이미지 = 목록 n번). 첨부 이미지를 직접 보고 확인한다.' : '각 사진을 Read 도구로 열어서 직접 확인한다.'} 열람용 사본은 축소본이고, 발행에는 원본이 쓰인다.
${사진}

## 말투 지침 (반드시 따른다)
${지침}

## 기준 글 (톤·구성의 실제 예시. 문장을 그대로 베끼지 말고 말투만 따른다)
${예시}

## 쓰는 규칙
1. 사실은 사진에 실제로 보이는 것과 담당자 메모에 적힌 것만 쓴다. 보이지 않는 공정·자재·브랜드·가격·기간·완공일은 쓰지 않는다. 확실하지 않으면 "~로 보이네요"처럼 쓴다.
2. 사진은 업로드 순서를 바꾸지 않고, 연속된 사진끼리 묶는다. 한 묶음에 보통 3~5장(1~2장도 가능). 모든 사진이 정확히 한 번씩 들어가야 한다. 파일명은 위 목록 그대로 쓴다.
   - 공간(거실·주방·욕실 등)을 사진에서 **확실히** 알 수 있는 경우에만 같은 공간끼리 묶고, space 에 그 공간 이름을 적는다.
   - 공간이 조금이라도 불확실하면 **공간 판단을 하지 말고** 업로드 순서대로 이어서 묶고, space 는 빈 문자열("")로 둔다. 공간 이름을 추측해서 쓰지 않는다.
3. 묶음의 설명(text):
   - space 가 있으면 그 공간 이름을 넣어 2~3문장으로 쓴다. ${job.분류 === 'before' ? '공사 전 글이므로 현재 상태(구조, 노후된 부분, 눈에 띄는 특징)를 짚고, 어떻게 달라질지 기대감을 한 줄 덧붙인다.' : '공사중 글이므로 사진에서 확인되는 진행 중인 공정(철거, 전기, 단내림, 도배 전 상태 등)을 짚고, 남은 공정 뒤 모습을 기대해 달라고 덧붙인다.'}
   - space 가 빈 문자열이면 공간 이름·공간 종류를 절대 쓰지 않는다. 대신 이 현장 공사와 관련된 정보성 내용을 간단하게 1~2문장으로 쓴다. 사진에서 확실히 보이는 상태를 근거로, 그 상태에서 공사가 어떻게 진행되는지·알아두면 좋은 점(예: 철거 후 바닥·벽 상태를 먼저 확인하는 이유, 마감 전 점검 포인트, 공정 순서)을 담백하게 알려 준다.
   - **문장 형식을 반복하지 않는다.** "~모습이네요~", "~가 눈에 띄네요~", "~상태네요~" 처럼 같은 어미·틀로 끝나는 문장을 여러 묶음에 연달아 쓰지 말고, 묶음마다 내용과 문장 구조를 다르게 쓴다. 이미 앞 묶음에서 쓴 내용도 되풀이하지 않는다. 사진을 그냥 묘사하는 문장("~가 보입니다")으로 때우지 않는다.
   - 보이지 않는 공정·자재·기간은 지어내지 않는다. 일반적인 공사 상식 수준의 정보만 쓰고, 정보를 쓸 수 없으면 text 를 빈 문자열("")로 둔다.
   - 소개글·마무리글에서도 공간 이름을 나열하지 않는다(사진에서 확실한 공간만 언급할 수 있다).
4. 위치(${위치 || '지역'})와 아파트명은 소개글과 마무리글에 자연스럽게 넣는다.
5. 소개글(intro)은 지침의 인사말로 시작한다. 인사말 다음에 오늘 살펴볼 현장을 소개한다.
6. 마무리글(outro)은 지침의 마무리 형식을 따른다. ${문의} 대표번호 줄(T.${설정.phone})은 코드가 따로 붙이므로 outro 에 쓰지 않는다.
7. 지도, 표지, 영상, 해시태그는 코드가 처리한다. 쓰지 않는다. 마크다운(# * ** 등)도 쓰지 않는다.
8. keywords 는 본문 내용에서 뽑은 해시태그용 단어 2개다. 공백·# 없이 한글 붙여쓰기, 아파트명·지역명·'인테리어' 단독은 제외한다. 예) 부분확장, 욕실리모델링, 단내림.
9. cover 는 표지로 쓸 사진 한 장의 파일명이다. 현장 전체 분위기가 가장 잘 보이는 사진(보통 거실·주방 전체샷)을 고른다. 이 사진도 sections 에는 그대로 들어간다.

## 출력
아래 JSON 한 덩어리만 출력한다. 앞뒤 설명이나 코드펜스는 쓰지 않는다.
{"cover":"파일명","keywords":["단어","단어"],"intro":"소개글(문단은 \\n 으로 구분)","sections":[{"space":"공간 이름(확실할 때만, 아니면 빈 문자열)","photos":["파일명","파일명"],"text":"설명(없으면 빈 문자열)"}],"outro":"마무리글"}`;
}

/** 모델 답에서 JSON 을 꺼낸다. */
function parseJson(text) {
  const s = String(text || '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('초안 결과에서 JSON 을 찾지 못했습니다.');
  return JSON.parse(s.slice(a, b + 1));
}

/** 사진이 빠지거나 겹치거나 없는 이름이면 바로잡는다. 업로드 순서를 기준으로 맞춘다. */
function normalize(raw, names, onLog) {
  const valid = new Set(names);
  const used = new Set();
  const sections = [];
  for (const sec of Array.isArray(raw.sections) ? raw.sections : []) {
    const photos = (sec.photos || []).map(String).filter((n) => valid.has(n) && !used.has(n));
    photos.forEach((n) => used.add(n));
    const text = String(sec.text || '').trim();
    if (photos.length || text) sections.push({ space: String(sec.space || '').trim(), photos, text, layout: 기본배치(photos.length) });
  }
  const missing = names.filter((n) => !used.has(n));
  if (missing.length) {
    onLog(`AI 가 빠뜨린 사진 ${missing.length}장을 마지막 묶음에 붙였습니다: ${missing.join(', ')}`, 'warn');
    if (!sections.length) sections.push({ space: '', photos: [], text: '' });
    sections[sections.length - 1].photos.push(...missing);
  }
  const cover = valid.has(raw.cover) ? raw.cover : names[0] || null;
  return {
    cover,
    draft: {
      intro: String(raw.intro || '').trim(),
      sections,
      outro: String(raw.outro || '').trim(),
      // 해시태그로 제안하는 본문 키워드 (공백·# 제거, 최대 2개)
      keywords: (Array.isArray(raw.keywords) ? raw.keywords : [])
        .map((k) => String(k).replace(/[\s#]/g, ''))
        .filter(Boolean)
        .slice(0, 2),
    },
  };
}

/**
 * 사진 배치 기본값 — 레퍼런스는 2장 이상이면 콜라주, 1장이면 개별이다.
 *   individual 개별사진 / collage 콜라주 / slide 슬라이드
 */
function 기본배치(장수) {
  return 장수 >= 2 ? 'collage' : 'individual';
}

const 배치목록 = ['individual', 'collage', 'slide'];
function 배치(sec) {
  return 배치목록.includes(sec.layout) ? sec.layout : 기본배치((sec.photos || []).length);
}

/** 사진을 보고 초안을 만든다. 결과는 job.draft 에 저장된다. */
async function generate(id, { onLog = () => {}, onProcess = () => {} } = {}) {
  const job = jobs.get(id);
  if (!job) throw new Error('작업을 찾지 못했습니다.');
  const pd = jobs.photoDir(id);
  if (!job.photos.length) throw new Error('사진이 없습니다.');

  onLog('AI 가 볼 수 있게 사진을 줄이는 중입니다…');
  const 사본 = await makePreviews(pd, onLog);
  const 사본목록 = job.photos
    .map((name) => 사본.find((p) => p.name === name))
    .filter(Boolean)
    .map((p) => ({ name: p.name, preview: p.preview }));

  const 설정 = settings.load();
  onLog(`사진 ${사본목록.length}장을 보고 글을 쓰는 중입니다… (1~3분)`);
  const r = await ai.run({
    prompt: prompt(job, 사본목록, 설정),
    cwd: jobs.dir(id),
    images: 사본목록.map((p) => p.preview),
    allowedTools: 'Read',
    model: MODEL,
    onLog: (m) => onLog(`  ${m}`),
    onProcess,
  });

  let raw;
  try {
    raw = parseJson(r.text);
  } catch (e) {
    onLog(`AI 응답(앞부분): ${String(r.text || '').replace(/\s+/g, ' ').slice(0, 300)}`, 'warn');
    throw e;
  }
  const { cover, draft } = normalize(raw, job.photos, onLog);
  if (!draft.intro || !draft.sections.length) throw new Error('초안이 비어 있습니다. 다시 시도해 주세요.');
  return { cover, draft };
}

/**
 * 발행 순서대로 펼친 블록 목록. 화면 미리보기와 카페 입력이 같은 순서를 쓰도록 한 곳에서 만든다.
 *   cover → 소개글 → 지도 → ── → (사진 → 설명)* → 빈 줄 → 마무리글 → 빈 줄 → 대표번호 → ── → 영상 → 태그
 * 레퍼런스 4건의 실제 구조와 같다 (구분선은 '구분선 5', 대표번호는 가운데·19·#ff5f45).
 */
function blocks(job, 설정 = settings.load()) {
  const d = job.draft;
  if (!d) return [];
  const out = [];
  if (job.cover && job.cover.made) out.push({ t: 'cover' });
  d.intro.split(/\n+/).filter(Boolean).forEach((text) => out.push({ t: 'text', text }));
  out.push({ t: 'map', query: (job.place && job.place.name) || job.아파트명, address: (job.place && job.place.address) || '' });
  out.push({ t: 'divider' });
  for (const sec of d.sections) {
    if (sec.photos.length) out.push({ t: 'photos', files: sec.photos, space: sec.space, layout: 배치(sec) });
    sec.text.split(/\n+/).filter(Boolean).forEach((text) => out.push({ t: 'text', text }));
  }
  out.push({ t: 'blank' });
  d.outro.split(/\n+/).filter(Boolean).forEach((text) => out.push({ t: 'text', text }));
  out.push({ t: 'blank' });
  out.push({ t: 'text', text: `T.${설정.phone}`, phone: true });
  out.push({ t: 'divider' });
  // 동영상의 제목·내용은 포스팅 제목 그대로, 태그는 본문 태그와 같은 것을 쓴다 (사용자 지정).
  if (job.video) out.push({ t: 'video', file: job.video, title: job.title, info: job.title, tags: Array.isArray(job.tags) ? job.tags : [] });
  return out;
}

/** (쓰지 않음) 예전 동영상 제목 규칙. */
function 영상제목(job) {
  const t = `${job.아파트명} ${String(job.평수 || '').replace(/[^\d.]/g, '')}평 ${job.분류 === 'before' ? '공사 전' : '공사중'} 현장 영상`.replace(/\s+/g, ' ');
  return t.slice(0, 40);
}

module.exports = { generate, blocks, parseJson, normalize, 배치, 기본배치, 영상제목 };
