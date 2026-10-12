// 해시태그 만들기 — 카페 글 맨 아래 "태그를 입력해주세요(최대 10개)" 칸에 넣는다.
//
// 규칙 (사용자 지정)
//   #아파트명  #지역구+인테리어  #행정동+인테리어  #아파트명+인테리어  + 본문 키워드 제안 → 5개 내외
// '#' 은 붙이지 않고 단어만 저장한다 (카페 태그 칸에 단어만 넣는다). 화면에서는 #을 붙여 보여 준다.

const 붙여쓰기 = (s) => String(s || '').replace(/[\s#]/g, '');

/** 구 입력이 "수원시 영통구" 처럼 길면 마지막 단어만 쓴다. */
const 구이름 = (s) => {
  const parts = String(s || '').trim().split(/\s+/).filter(Boolean);
  return 붙여쓰기(parts[parts.length - 1] || '');
};

/**
 * 기본 태그 + 키워드 제안 중 앞에서 keywordCount 개.
 * 이미 직접 고친 태그 목록(job.tags)이 있으면 그것을 존중하므로, 이 함수는 '처음 만들 때'와 '다시 만들기'에만 쓴다.
 */
function build(job, { keywordCount = 1 } = {}) {
  const apt = 붙여쓰기(job.아파트명);
  const gu = 구이름(job.구);
  const dong = 붙여쓰기(job.동);
  const keywords = ((job.draft && job.draft.keywords) || []).map(붙여쓰기).filter(Boolean);

  const list = [];
  if (apt) list.push(apt);
  if (gu) list.push(`${gu}인테리어`);
  if (dong) list.push(`${dong}인테리어`);
  if (apt) list.push(`${apt}인테리어`);
  list.push(...keywords.slice(0, keywordCount));
  return [...new Set(list)].slice(0, 10);
}

/** 화면에 보여 줄 추천 키워드 중 아직 태그에 없는 것. */
function suggestions(job) {
  const have = new Set(job.tags || []);
  return ((job.draft && job.draft.keywords) || []).map(붙여쓰기).filter((k) => k && !have.has(k));
}

module.exports = { build, suggestions };
