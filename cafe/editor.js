// 카페 글쓰기 화면(스마트에디터 ONE)에 글을 채워 넣고, 최종 컨펌이 나면 [등록]을 누른다.
//
// 로그인된 앱 전용 크롬(chrome.js)에 붙어서 쓴다. 사진·영상은 원본 파일 그대로 올린다.
//
// 🚨 [등록]은 dryRun 이 false 일 때만 누른다. dryRun 이면 끝까지 채우고 화면을 그대로 남겨 둔다
//    (사람이 크롬 창에서 눈으로 확인할 수 있게).
//
// 선택자는 2026-10-10 로그인된 화면에서 실측한 값이다. 네이버가 에디터를 바꾸면 여기가 가장 먼저 깨진다.
const fs = require('fs');
const path = require('path');
const chrome = require('./chrome');
const jobs = require('./jobs');
const { CAFE_ID } = require('./config');

// 🚨 /f-e/… 주소는 404 다. 글쓰기는 /ca-fe/… 이고, 게시판은 주소로 미리 골라지지 않는다(직접 골라야 한다).
const WRITE_URL = (menuId) => `https://cafe.naver.com/ca-fe/cafes/${CAFE_ID}/articles/write?boardType=L&menuId=${menuId}`;

const SEL = {
  제목: ['textarea.textarea_input', 'textarea[placeholder*="제목"]'],
  본문첫문단: ['.se-content .se-section-text .se-text-paragraph', '.se-component.se-text .se-text-paragraph', '.se-text-paragraph'],
  사진버튼: ['.se-image-toolbar-button', 'button[data-name="image"]'],
  장소버튼: ['.se-map-toolbar-button', 'button[data-name="map"]'],
  영상버튼: ['.se-video-toolbar-button', 'button[data-name="video"]'],
  등록: ['.tool_area a.BaseButton--skinGreen', 'a.BaseButton:has-text("등록")'],
  임시등록: ['.tool_area a.BaseButton:has-text("임시등록")', 'a.BaseButton:has-text("임시등록")', 'button:has-text("임시등록")'],
  태그: 'input.tag_input',
};

const 사진컴포넌트 = '.se-component.se-image, .se-component.se-imageGroup';

// 본문 서식 — 레퍼런스 4건의 실제 값 (2026-10-10 확인)
const 서식 = {
  글꼴: '나눔바른고딕',
  본문크기: '15',
  대표번호: { 크기: '19', 색: '#ff5f45', 찾을문구: 'T.' },
  // 레퍼런스의 se-l-line5. 화면 이름은 '구분선 6' 이다(이름은 1부터, 클래스는 default·line1…이라 한 칸씩 어긋난다. 2026-10-10 실측).
  구분선클래스: 'se-toolbar-option-insert-horizontal-line-line5-button',
  글꼴클래스: 'se-toolbar-option-font-family-nanumbarungothic-button',
};

// "사진 첨부 방식" 창 (블로그 에디터와 같은 구조)
const 첨부방식 = {
  individual: 'se-image-type-option-list',
  collage: 'se-image-type-option-collage',
  slide: 'se-image-type-option-slide',
};

async function pick(page, list, { timeout = 8000, visible = true } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const sel of list) {
      const loc = page.locator(sel).first();
      if ((await loc.count()) && (!visible || (await loc.isVisible().catch(() => false)))) return loc;
    }
    await page.waitForTimeout(250);
  }
  return null;
}

async function dismissLayers(page, log) {
  // "작성 중이던 글이 있습니다" — 항상 새 글로 시작한다.
  // 🚨 button:has-text("취소") 는 쓰지 않는다. 툴바 '취소선' 버튼이 먼저 잡혀 본문 전체에 취소선이 걸린다.
  const popup = page.locator('.se-popup-alert .se-popup-button-cancel').first();
  if (await popup.isVisible().catch(() => false)) {
    await popup.click().catch(() => {});
    log('"작성 중이던 글" 팝업을 닫았습니다 (불러오지 않음).');
    await page.waitForTimeout(800);
  }
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);
}

/** 게시판 선택 상자에서 원하는 게시판을 고른다. (주소의 menuId 로는 미리 선택되지 않는다) */
async function ensureBoard(page, board, log) {
  const box = page.locator('.FormSelectBox.menu_candidates_selectbox').first();
  const 현재 = async () => ((await box.locator('button.button').first().innerText().catch(() => '')) || '').trim();

  if ((await 현재()) === board.name) {
    log(`게시판 확인 — ${board.name}`);
    return true;
  }
  await box.locator('button.button').first().click();
  await page.waitForTimeout(600);
  const opt = box.locator('button.option', { hasText: board.name });
  // 이름이 부분만 겹치는 게시판(예: '공사중 현장' 과 '서울 공사중 현장')이 있어 글자가 정확히 같은 것만 고른다.
  const n = await opt.count();
  let clicked = false;
  for (let i = 0; i < n; i++) {
    const text = ((await opt.nth(i).innerText()) || '').trim();
    if (text === board.name) {
      await opt.nth(i).click();
      clicked = true;
      break;
    }
  }
  if (!clicked) {
    // 로그인한 계정에 이 게시판의 글쓰기 권한이 없으면 목록에 아예 나오지 않는다 (일반 회원 계정으로 로그인한 경우).
    const have = (await box.locator('button.option').allInnerTexts().catch(() => [])).map((t) => t.trim()).filter(Boolean);
    log(`이 계정의 글쓰기 목록에 "${board.name}" 이(가) 없습니다. 글쓰기 권한이 있는 계정(운영진)으로 로그인했는지 확인해 주세요. 선택 가능: ${have.join(', ') || '없음'}`, 'error');
  }
  await page.waitForTimeout(600);
  const now = await 현재();
  const ok = clicked && now === board.name;
  log(ok ? `게시판 선택 — ${now}` : `게시판을 고르지 못했습니다 (현재: ${now || '알 수 없음'}, 찾는 이름: ${board.name})`, ok ? 'info' : 'error');
  return ok;
}

/** 클립보드 없이 글자를 넣는다. 한 줄씩 넣고 Enter 로 문단을 나눈다. */
async function typeParagraph(page, text) {
  await page.keyboard.insertText(text);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
}

// ─────────────────────────────────────────────
// 사진
// ─────────────────────────────────────────────

/** 사진 버튼을 눌러 파일 선택 창을 연다. */
async function openChooser(page, log) {
  const button = await pick(page, SEL.사진버튼, { timeout: 10000 });
  if (!button) throw new Error('사진 버튼을 찾지 못했습니다. 에디터 화면을 확인해 주세요.');
  for (let 시도 = 1; 시도 <= 2; 시도++) {
    const p = page.waitForEvent('filechooser', { timeout: 20000 });
    p.catch(() => {});
    try {
      await button.click({ timeout: 10000 });
      return await p;
    } catch (e) {
      log(`파일 선택 창이 열리지 않았습니다 (${시도}/2): ${String(e.message).split('\n')[0]}`, 'warn');
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(1200);
    }
  }
  throw new Error('사진 파일 선택 창을 열지 못했습니다.');
}

/** 올라간 사진 컴포넌트가 실제 주소를 받아 전송이 끝날 때까지 기다린다. */
async function waitUploaded(page, before, 기대개수, 필요장수, label, log) {
  await page
    .waitForFunction(
      ({ n, 기대, sel, 필요 }) => {
        const items = [...document.querySelectorAll(sel)];
        if (items.length < n + 기대) return false;
        return items.slice(-기대).every((c) => {
          const imgs = [...c.querySelectorAll('img')];
          if (!imgs.length) return false;
          if (imgs.every((i) => /^https?:/.test(i.src || ''))) return true;
          if (/전송중|업로드/.test(c.innerText || '')) return false;
          const 실제 = imgs.filter((i) => /^https?:/.test(i.src || '')).length;
          // 슬라이드는 앞의 2장만 먼저 불러오고 나머지는 자리표시자(data:image/svg)로 남는다.
          const 자리표시자 = imgs.filter((i) => /^data:image\/svg/.test(i.src || '')).length;
          return 실제 >= 필요 && 실제 + 자리표시자 === imgs.length;
        });
      },
      { n: before, 기대: 기대개수, sel: 사진컴포넌트, 필요: 필요장수 },
      { timeout: 180000, polling: 500 }
    )
    .catch(() => log(`사진 업로드가 확인되지 않습니다: ${label}`, 'warn'));
  await page.waitForTimeout(800);
}

/** 한 장을 개별 사진으로 넣는다. */
async function insertImage(page, filePath, log) {
  const before = await page.locator(사진컴포넌트).count();
  const chooser = await openChooser(page, log);
  await chooser.setFiles([filePath]);
  await waitUploaded(page, before, 1, 1, path.basename(filePath), log);
}

/**
 * 여러 장을 한 번에 넣는다. layout = individual | collage | slide
 * 2장 이상을 한꺼번에 넘기면 네이버가 "사진 첨부 방식" 을 묻고, 거기서 사람이 고른 방식을 누른다.
 * 돌려주는 값: 실제로 들어간 사진 수
 */
async function insertPhotos(page, files, layout, log) {
  if (files.length === 1 || layout === 'individual') {
    for (const f of files) await insertImage(page, f, log);
    return files.length;
  }
  // 콜라주는 한 묶음에 너무 많으면 읽기 어렵다. 10장씩 끊는다.
  const chunks = [];
  for (let i = 0; i < files.length; i += 10) chunks.push(files.slice(i, i + 10));
  let done = 0;
  for (const chunk of chunks) {
    if (chunk.length === 1) {
      await insertImage(page, chunk[0], log);
      done += 1;
      continue;
    }
    const before = await page.locator(사진컴포넌트).count();
    const chooser = await openChooser(page, log);
    await chooser.setFiles(chunk);

    const 창 = page.locator('.se-popup-image-type');
    let 적용 = layout;
    try {
      await 창.waitFor({ state: 'visible', timeout: 10000 });
      // 🚨 이 창이 떠 있는 동안은 다음 동작이 전부 막힌다. Escape 로 닫으면 올린 사진이 통째로 취소된다.
      if (!(await 창.locator('.' + 첨부방식[layout]).click({ timeout: 5000 }).then(() => true).catch(() => false))) {
        log(`"${layout}" 를 고르지 못해 개별사진으로 넣습니다.`, 'warn');
        적용 = 'individual';
        await 창.locator('.' + 첨부방식.individual).click({ timeout: 5000 });
      }
      await 창.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    } catch {
      log('"사진 첨부 방식" 창이 뜨지 않았습니다. 네이버 기본 방식으로 들어갑니다.', 'warn');
    }
    const 기대 = 적용 === 'individual' ? chunk.length : 1;
    // 슬라이드는 첫 장만 바로 불러오고 나머지는 자리표시자로 남는다(2026-10-10 실측) — 1장이면 끝난 것으로 본다.
    const 필요 = 기대 === 1 ? (적용 === 'slide' ? 1 : Math.min(chunk.length, 2)) : 1;
    await waitUploaded(page, before, 기대, 필요, `${chunk.length}장`, log);
    log(`사진 ${chunk.length}장 ${적용} 삽입`);
    done += chunk.length;
  }
  return done;
}

// ─────────────────────────────────────────────
// 지도 · 구분선 · 영상
// ─────────────────────────────────────────────

/** 지도(장소) 첨부. 실패해도 글 입력을 멈추지 않는다 (직접 넣도록 안내). */
async function insertPlace(page, query, address, log) {
  const button = await pick(page, SEL.장소버튼, { timeout: 5000 });
  if (!button) {
    log('장소(지도) 버튼을 찾지 못했습니다. 지도는 직접 넣어 주세요.', 'warn');
    return false;
  }
  await button.click();
  await page.waitForTimeout(1200);
  // 장소 창 = .se-popup-placesMap, 입력 = input.react-autosuggest__input,
  // 결과 줄 = li.se-place-map-search-result-item, [추가] 는 줄에 마우스를 올려야 눌린다, 마무리 = .se-popup-button-confirm
  const input = await pick(page, ['.se-popup-placesMap input.react-autosuggest__input', 'input[placeholder*="장소명"]'], { timeout: 8000 });
  if (!input) {
    log('장소 검색 창이 열리지 않았습니다. 지도는 직접 넣어 주세요.', 'warn');
    await closePlacePopup(page);
    return false;
  }
  await input.fill(query);
  await input.press('Enter');
  await page.waitForTimeout(1800);

  const rows = page.locator('.se-popup-placesMap li.se-place-map-search-result-item');
  const first = await pick(page, ['.se-popup-placesMap li.se-place-map-search-result-item'], { timeout: 8000 });
  if (!first) {
    log(`"${query}" 장소 검색 결과가 없습니다. 지도는 직접 넣어 주세요.`, 'warn');
    await closePlacePopup(page);
    return false;
  }
  // 고른 현장의 주소와 같은 줄을 우선한다. 주소가 없으면 이름이 같은 줄, 그것도 없으면 첫 줄.
  const norm = (t) => String(t).replace(/\s+/g, '');
  const n = await rows.count();
  let row = null;
  for (let i = 0; i < n && !row; i++) {
    const r = rows.nth(i);
    const name = ((await r.locator('.se-place-map-search-result-title').innerText()) || '').trim();
    const addr = ((await r.locator('.se-place-map-search-result-address').innerText()) || '').trim();
    if (address && norm(addr) === norm(address) && norm(name) === norm(query)) row = r;
  }
  for (let i = 0; i < n && !row; i++) {
    const name = ((await rows.nth(i).locator('.se-place-map-search-result-title').innerText()) || '').trim();
    if (norm(name).startsWith(norm(query)) && !/관리사무소|복지관|중개|부동산/.test(name)) row = rows.nth(i);
  }
  row = row || rows.first();
  const label = (((await row.innerText()) || '').replace(/\s*\n\s*/g, ' / ').replace(/\s*추가$/, '')).trim();
  await row.hover();
  await page.waitForTimeout(400);
  await row.locator('button.se-place-add-button').click({ force: true, timeout: 8000 });
  await page.waitForTimeout(1000);
  const confirm = await pick(page, ['.se-popup-placesMap .se-popup-button-confirm'], { timeout: 5000 });
  if (!confirm) {
    await closePlacePopup(page);
    log('장소 [확인] 버튼을 찾지 못했습니다. 지도는 직접 넣어 주세요.', 'warn');
    return false;
  }
  await confirm.click();
  // 창이 닫히고 지도 컴포넌트가 본문에 들어올 때까지 기다린다. 창이 남아 있으면 다음 동작이 전부 막힌다.
  await page.locator('.se-popup-placesMap').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const added = await page.locator('.se-component.se-placesMap').count();
  log(added ? `지도 첨부 — ${label}` : `지도를 눌렀지만 본문에서 확인되지 않습니다 — ${label}`, added ? 'info' : 'warn');
  return added > 0;
}

/** 장소 창이 열려 있으면 닫는다. 남겨 두면 뒤따르는 클릭이 전부 막힌다. */
async function closePlacePopup(page) {
  const close = page.locator('.se-popup-placesMap .se-popup-close-button').first();
  if (await close.isVisible().catch(() => false)) await close.click().catch(() => {});
  await page.waitForTimeout(500);
}

/**
 * 본문의 지도·구분선을 모두 가운데 정렬한다. 입력이 다 끝난 뒤에 부른다
 * (컴포넌트를 누르면 커서가 옮겨져 뒤따르는 입력 위치가 어긋나기 때문).
 * 컴포넌트를 누르면 위쪽 서식 줄의 정렬 버튼이 그 컴포넌트에 적용된다.
 */
async function centerComponents(page, log) {
  const sel = '.se-component.se-placesMap, .se-component.se-horizontalLine';
  const n = await page.locator(sel).count();
  let ok = 0;
  for (let i = 0; i < n; i++) {
    try {
      const comp = page.locator(sel).nth(i);
      await comp.scrollIntoViewIfNeeded().catch(() => {});
      await comp.click({ position: { x: 20, y: 10 }, timeout: 8000 });
      await page.waitForTimeout(500);
      // 컴포넌트를 고르면 나타나는 속성 줄(.se-property-toolbar)에 정렬 버튼이 바로 있다 (2026-10-10 실측).
      await page.locator('.se-property-toolbar button.se-align-center-toolbar-button').first().click({ timeout: 8000 });
      await page.waitForTimeout(400);
      if (await comp.locator('.se-section-align-center').count()) ok += 1;
    } catch {
      await page.keyboard.press('Escape').catch(() => {});
    }
  }
  log(`지도·구분선 가운데 정렬 ${ok}/${n}`, ok === n ? 'info' : 'warn');
}

/**
 * 맨 위 [임시등록]을 눌러 카페에 임시저장한다. 발행([등록])은 누르지 않는다.
 * 저장이 끝나면 "임시등록되었습니다" 안내가 뜬다.
 */
async function saveDraft(page, log) {
  const 버튼 = await pick(page, SEL.임시등록, { timeout: 15000 });
  if (!버튼) throw new Error('[임시등록] 버튼을 찾지 못했습니다. 카페 글쓰기 화면이 바뀌었을 수 있습니다.');
  await 버튼.scrollIntoViewIfNeeded().catch(() => {});
  await 버튼.click();
  log('[임시등록]을 눌렀습니다. 저장을 확인하는 중입니다…');
  await page.waitForTimeout(3000);
  const msg = await page.evaluate(() => (document.body.innerText || '').match(/임시[^\n]{0,20}(저장|등록)[^\n]{0,20}/g) || []).catch(() => []);
  log(`임시등록 화면 표시: ${msg.slice(0, 3).join(' | ') || '(안내문 없음)'}`);
}

/** 구분선(레퍼런스와 같은 se-l-line5 = 화면 이름 '구분선 6')을 넣는다. */
async function insertDivider(page, log) {
  const before = await page.locator('.se-component.se-horizontalLine').count();
  try {
    await page.click('button.se-document-toolbar-select-option-button[data-name="horizontal-line"]', { timeout: 8000 });
    await page.waitForTimeout(500);
    await page.locator('button.' + 서식.구분선클래스).first().click({ timeout: 8000 });
    await page.waitForTimeout(800);
  } catch (e) {
    log(`구분선을 넣지 못했습니다: ${String(e.message).split('\n')[0]}`, 'warn');
    await page.keyboard.press('Escape').catch(() => {});
    return false;
  }
  const after = await page.locator('.se-component.se-horizontalLine').count();
  const cls = await page.evaluate(() => { const l = [...document.querySelectorAll('.se-component.se-horizontalLine')].pop(); return l ? l.className : ''; }).catch(() => '');
  if (after > before && !/se-l-line5/.test(cls)) log('구분선 모양이 레퍼런스(line5)와 다릅니다. 확인해 주세요.', 'warn');
  return after > before;
}

/**
 * 영상 첨부 (네이버 동영상 업로더 — 창 안의 클래스는 nvu_*).
 *
 * 순서: [동영상] → 창의 [동영상 추가] → 파일 선택 → '업로드 완료' 대기 → 제목 입력 → [완료]
 * 🚨 예전에는 창 안의 [완료] 버튼 이름을 몰라 창이 열린 채 멈췄다. [완료] 는 .nvu_btn_submit 이다.
 */
async function insertVideo(page, filePath, meta, log) {
  const button = await pick(page, SEL.영상버튼, { timeout: 8000 });
  if (!button) {
    log('영상 버튼을 찾지 못했습니다. 영상은 직접 넣어 주세요.', 'warn');
    return false;
  }
  const before = await page.locator('.se-component.se-video').count();
  await button.click();
  const add = await pick(page, ['.nvu_btn_append.nvu_local'], { timeout: 15000 });
  if (!add) {
    log('동영상 업로드 창이 열리지 않았습니다. 영상은 직접 넣어 주세요.', 'warn');
    return false;
  }
  const chooserP = page.waitForEvent('filechooser', { timeout: 20000 });
  chooserP.catch(() => {});
  await add.click();
  const chooser = await chooserP.catch(() => null);
  if (!chooser) {
    log('영상 파일 선택 창을 열지 못했습니다. 영상은 직접 넣어 주세요.', 'warn');
    await closeVideoPopup(page);
    return false;
  }
  await chooser.setFiles([filePath]);
  const mb = (fs.statSync(filePath).size / 1048576).toFixed(0);
  log(`영상을 올리는 중입니다… (${mb}MB)`);

  // 업로드가 끝날 때까지 기다린다. 용량에 비례해 넉넉히 (최소 3분, MB 당 10초).
  const limit = Math.max(180000, Number(mb) * 10000);
  const t0 = Date.now();
  let last = '';
  for (;;) {
    const state = ((await page.locator('.nvu_state').first().innerText().catch(() => '')) || '').trim();
    if (state && state !== last) {
      log(`  영상 상태 — ${state}`);
      last = state;
    }
    if (/업로드 완료/.test(state)) break;
    if (/실패|오류|error/i.test(state)) {
      log(`영상 업로드가 실패했습니다 (${state}).`, 'error');
      await closeVideoPopup(page);
      return false;
    }
    if (Date.now() - t0 > limit) {
      log(`영상 업로드가 ${Math.round(limit / 1000)}초 안에 끝나지 않았습니다.`, 'error');
      await closeVideoPopup(page);
      return false;
    }
    await page.waitForTimeout(1500);
  }

  await fillVideoInfo(page, meta || {}, log);
  await page.waitForTimeout(500);
  // 대표 이미지 추출이 끝나 [완료] 가 눌릴 때까지 잠깐 더 기다린다 (클래스가 nvu_btn_type3 → type2 로 바뀐다).
  await page.waitForFunction(() => !!document.querySelector('.nvu_btn_submit.nvu_btn_type2'), null, { timeout: 60000 }).catch(() => {});
  await page.locator('.nvu_btn_submit').first().click({ timeout: 10000 });
  await page.locator('.se-popup-video-upload').waitFor({ state: 'detached', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const added = (await page.locator('.se-component.se-video').count()) > before;
  log(added ? '영상 첨부 완료' : '영상을 올렸지만 본문에서 확인되지 않습니다.', added ? 'info' : 'warn');
  if (!added) await closeVideoPopup(page);
  return added;
}

/**
 * 동영상 창의 제목·정보·태그를 채운다 — 사용자 지정: 제목과 내용은 포스팅 제목 그대로, 태그는 본문 태그와 같게.
 * 제목 칸은 최대 40자, 정보 칸은 최대 300자라 넘치면 잘라 넣는다.
 */
/**
 * 영상 제목(최대 40자)에 맞게 포스팅 제목을 줄인다. 글자를 중간에서 자르지 않고 끝맺음부터 덜어 낸다.
 * 예) "[부곡동 리모델링] 부산 금정구 부곡동푸르지오 30평의 공사중 현장입니다!" → "[부곡동 리모델링] 부산 금정구 부곡동푸르지오 30평의 공사중 현장"
 */
function 영상제목(title, max = 40) {
  let t = String(title || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const steps = [
    (s) => s.replace(/[!~.\s]+$/, ''), // 끝의 ! ~ .
    (s) => s.replace(/\s*(입니다|이에요|예요|이네요|이었어요)$/, ''), // 끝맺음
    (s) => s.replace(/\s*(함께|같이)\s*(살펴보기|둘러보기|살펴볼까요|보기)$/, ''),
    (s) => s.replace(/(\d+평)의\s/, '$1 '), // "30평의 공사중" → "30평 공사중"
  ];
  for (const f of steps) {
    t = f(t).trim();
    if (t.length <= max) return t;
  }
  // 그래도 길면 낱말 경계에서 자른다 (낱말이 하나뿐이면 글자 수로 자른다)
  const cut = t.slice(0, max + 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > max / 2 ? cut.slice(0, sp) : t.slice(0, max)).trim();
}

async function fillVideoInfo(page, meta, log) {
  const text = 영상제목(meta.title);
  const titleInput = page.locator('input.nvu_inp[placeholder*="제목"]').first();
  if (text && (await titleInput.isVisible().catch(() => false))) {
    await titleInput.fill(text);
    if (text !== String(meta.title || '').trim()) log(`영상 제목은 40자까지라 줄여 넣었습니다 — ${text} (${text.length}자)`);
  }
  const infoInput = page.locator('textarea.nvu_inp[placeholder*="정보"]').first();
  const info = String(meta.info || meta.title || '').trim();
  if (info && (await infoInput.isVisible().catch(() => false))) await infoInput.fill(info.slice(0, 300));

  const tags = (meta.tags || []).map((t) => String(t).replace(/[\s#]/g, '')).filter(Boolean);
  if (!tags.length) return;
  try {
    const label = page.locator('button.nvu_tag_label').first();
    if (!(await label.isVisible().catch(() => false))) throw new Error('태그추가 버튼이 보이지 않습니다');
    await label.click({ force: true, timeout: 8000 });
    await page.waitForTimeout(600);
    // 눌러 두면 태그 입력칸이 나타난다. 칸을 찾아 클릭하고, 못 찾으면 포커스된 칸에 그대로 입력한다.
    const input = page.locator('.se-popup-video-upload input[placeholder*="태그"], .se-popup-video-upload input[class*="tag"]').first();
    if (await input.count()) await input.click({ timeout: 5000 }).catch(() => {});
    for (const t of tags) {
      await page.keyboard.type(t, { delay: 20 });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(250);
    }
    const shown = await page.evaluate(() => (document.querySelector('.se-popup-video-upload') || {}).innerText || '').catch(() => '');
    const ok = tags.every((t) => shown.includes(t));
    log(ok ? `영상 태그 ${tags.length}개 입력` : '영상 태그가 화면에서 확인되지 않습니다. 영상 창에서 직접 확인해 주세요.', ok ? 'info' : 'warn');
  } catch (e) {
    log(`영상 태그를 넣지 못했습니다: ${String(e.message).split('\n')[0]}`, 'warn');
  }
}

/** 영상 창이 남아 있으면 닫는다. */
async function closeVideoPopup(page) {
  const close = page.locator('.nvu_btn_close').first();
  if (await close.isVisible().catch(() => false)) await close.click().catch(() => {});
  await page.waitForTimeout(800);
}

// ─────────────────────────────────────────────
// 서식 · 태그
// ─────────────────────────────────────────────

/** 드롭다운을 열고 클래스로 항목을 골라 누른다. */
async function clickOption(page, triggerSel, optionSel, label, log) {
  try {
    await page.click(triggerSel);
    await page.waitForTimeout(500);
    const option = page.locator(optionSel).first();
    if (await option.count()) {
      await option.click();
      await page.waitForTimeout(500);
      return true;
    }
    await page.keyboard.press('Escape');
  } catch {
    // 서식 실패가 글 입력을 막을 이유는 없다.
  }
  log(`"${label}" 항목을 찾지 못했습니다.`, 'warn');
  return false;
}

/** (예전 방식) 드롭다운을 열고 글자가 맞는 항목을 고른다. */
async function pickFromDropdown(page, triggerSel, 라벨, log) {
  try {
    await page.click(triggerSel);
    await page.waitForTimeout(500);
    const option = page
      .locator('button:visible')
      .filter({ hasText: new RegExp(`^\\s*${라벨}\\s*$`) })
      .first();
    if (await option.count()) {
      await option.click();
      await page.waitForTimeout(500);
      return true;
    }
    await page.keyboard.press('Escape');
  } catch {
    // 서식 실패가 글 입력을 막을 이유는 없다.
  }
  log(`"${라벨}" 항목을 찾지 못했습니다.`, 'warn');
  return false;
}

/**
 * 본문 전체 글꼴·크기를 한 번에 맞춘다 (나눔바른고딕 · 15).
 * 🚨 스마트에디터는 새 문단을 만들 때마다 기본값으로 되돌린다. 입력이 다 끝난 뒤 전체를 선택해 덮어써야 먹는다.
 */
async function normalizeBody(page, log) {
  await page.click(SEL.본문첫문단[0]).catch(() => {});
  await page.waitForTimeout(300);
  await page.keyboard.press('Control+A');
  await page.waitForTimeout(500);
  await clickOption(page, '.se-font-family-toolbar-button', 'button.' + 서식.글꼴클래스, 서식.글꼴, log);
  await clickOption(page, '.se-font-size-code-toolbar-button', `[class*="se-toolbar-option-font-size-code-fs${서식.본문크기}-"]`, 서식.본문크기, log);
  await page.keyboard.press('ArrowRight').catch(() => {}); // 선택을 풀어 둔다
  await page.waitForTimeout(300);
}

/** 대표번호 줄: 19 · #ff5f45 · 굵게 · 가운데 정렬. 반드시 normalizeBody 뒤에 부른다. */
async function stylePhone(page, log) {
  const target = page.locator('.se-component.se-text .se-text-paragraph', { hasText: 서식.대표번호.찾을문구 }).last();
  if (!(await target.count())) {
    log('대표번호 줄을 찾지 못했습니다.', 'warn');
    return;
  }
  try {
    await target.scrollIntoViewIfNeeded();
    await target.click({ clickCount: 3 }); // 세 번 클릭하면 그 줄이 통째로 선택된다
    await page.waitForTimeout(500);

    // ① 크기
    await page.click('.se-font-size-code-toolbar-button');
    await page.waitForTimeout(500);
    const 크기 = page.locator(`[class*="se-toolbar-option-font-size-code-fs${서식.대표번호.크기}-"]`).first();
    if (await 크기.count()) await 크기.click();
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    // ② 색
    await page.click('.se-font-color-toolbar-button');
    await page.waitForTimeout(600);
    const 색 = page.locator(`.se-color-palette[data-color="${서식.대표번호.색}"]`).first();
    if (await 색.count()) await 색.click();
    else {
      await page.keyboard.press('Escape');
      log(`글자색 ${서식.대표번호.색} 을 팔레트에서 찾지 못했습니다.`, 'warn');
    }
    await page.waitForTimeout(400);

    // ③ 굵게 — 이미 켜져 있으면 다시 누르지 않는다 (다시 누르면 꺼진다)
    const bold = page.locator('.se-bold-toolbar-button').first();
    const 굵음 = await bold.evaluate((el) => /se-is-(on|active|selected)/.test(el.className) || el.getAttribute('aria-pressed') === 'true').catch(() => false);
    if (!굵음) await bold.click();
    await page.waitForTimeout(400);

    // ④ 가운데 정렬
    await page.click('.se-property-toolbar-drop-down-button[class*="se-align"]');
    await page.waitForTimeout(400);
    const 가운데 = page.locator('.se-toolbar-option-align-center-button').first();
    if (await 가운데.count()) await 가운데.click();
    else {
      await page.keyboard.press('Escape');
      log('가운데 정렬 항목을 찾지 못했습니다.', 'warn');
    }
    await page.waitForTimeout(400);

    const r = await target.evaluate((el) => {
      const span = el.querySelector('span') || el;
      const st = getComputedStyle(span);
      // 🚨 굵게는 바깥 span 의 font-weight 가 아니라 안쪽 <b>/<strong> 태그로 들어간다.
      const bolded = !!el.querySelector('b, strong') || Number(st.fontWeight) >= 600;
      return { size: st.fontSize, color: st.color, align: getComputedStyle(el).textAlign, font: st.fontFamily.split(',')[0], bolded };
    });
    log(`대표번호 서식 — ${r.size} · ${r.color} · ${r.align} · ${r.bolded ? '굵게' : '굵게 안 됨'} · ${r.font}`, r.bolded ? 'info' : 'warn');
  } catch (e) {
    log(`대표번호 서식 적용에 실패했습니다: ${String(e.message).split('\n')[0]}. 발행 전 확인해 주세요.`, 'warn');
  }
}

/** 맨 아래 태그 칸에 태그를 넣는다. */
async function fillTags(page, tags, log) {
  const input = page.locator(SEL.태그).first();
  if (!(await input.count())) {
    log('태그 입력칸을 찾지 못했습니다. 태그는 직접 넣어 주세요.', 'warn');
    return false;
  }
  await input.scrollIntoViewIfNeeded().catch(() => {});
  await input.click();
  for (const tag of tags) {
    await page.keyboard.type(String(tag).replace(/[\s#]/g, ''), { delay: 20 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
  }
  const shown = await page
    .evaluate(() => {
      const box = document.querySelector('.tag_input_box');
      return box ? (box.parentElement.innerText || '').replace(/\s+/g, ' ').trim() : '';
    })
    .catch(() => '');
  log(`태그 ${tags.length}개 입력 — ${tags.map((t) => '#' + t).join(' ')}`);
  if (shown) log(`  태그 칸 표시: ${shown.slice(0, 120)}`);
  return true;
}

// ─────────────────────────────────────────────
// 본작업
// ─────────────────────────────────────────────

/**
 * 카페 글쓰기 화면에 job 을 채운다.
 *   blocks — writer.blocks(job) 의 결과
 *   dryRun — true 면 [등록]을 누르지 않고 화면을 그대로 둔다
 */
async function publish({ job, blocks, dryRun = true, mode = null, onLog = () => {} }) {
  const log = (m, level = 'info') => onLog(m, level);
  const pd = jobs.photoDir(job.id);
  const board = job.board;
  const tags = Array.isArray(job.tags) ? job.tags : [];

  return chrome.withContext(async (context) => {
    // 로그인이 안 돼 있으면 글쓰기 화면을 기다리지 않고 바로 알려 준다.
    const names = new Set((await context.cookies('https://cafe.naver.com')).map((c) => c.name));
    if (!['NID_AUT', 'NID_SES'].every((n) => names.has(n))) {
      throw new Error('카페에 로그인돼 있지 않습니다. 설정 탭의 [로그인 창 열기]로 열린 크롬에서 로그인한 뒤 다시 시도해 주세요.');
    }
    // 화면에 창이 뜨지 않는다 — chrome.withContext 가 보이지 않는 크롬(headless)을 쓴다.
    const page = await context.newPage();
    // 예행연습(dryRun)이 성공한 경우와 발행한 경우에만 창을 남기고, 나머지는 정리한다.
    let keep = false;
    try {
      page.on('dialog', async (d) => {
        log(`에디터 알림: ${d.message()}`);
        await d.accept().catch(() => {});
      });

      log('카페 글쓰기 화면을 여는 중입니다…');
      await page.goto(WRITE_URL(board.menuId), { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(2500);
      if (/nid\.naver\.com/.test(page.url())) {
        chrome.forgetLogin(); // 저장해 둔 로그인이 만료됐다
        throw new Error('카페 로그인이 만료됐습니다. 설정 탭의 [로그인 창 열기]로 다시 로그인한 뒤 시도해 주세요.');
      }

      const 제목칸 = await pick(page, SEL.제목, { timeout: 60000 });
      if (!제목칸) throw new Error('카페 글쓰기 화면의 제목 칸을 찾지 못했습니다. (글쓰기 권한이 있는 계정으로 로그인했는지 확인해 주세요)');
      await page.waitForTimeout(2000);
      await dismissLayers(page, log);

      // ── 게시판 ──
      const boardOk = await ensureBoard(page, board, log);
      if (!boardOk && !dryRun) throw new Error(`게시판 "${board.name}" 를 선택하지 못했습니다. 잘못된 게시판에 올리지 않도록 멈춥니다.`);

      // ── 제목 ──
      await 제목칸.click();
      await 제목칸.fill(job.title);
      log(`제목 입력 — ${job.title}`);

      // ── 본문 ──
      const 첫문단 = await pick(page, SEL.본문첫문단, { timeout: 30000 });
      if (!첫문단) throw new Error('본문 입력 칸을 찾지 못했습니다.');
      await 첫문단.click();
      await page.waitForTimeout(400);

      let photos = 0;
      let expected = 0;
      let dividers = 0;
      let videoWanted = false;
      let videoOk = false;
      for (const b of blocks) {
        if (b.t === 'cover') expected += 1;
        else if (b.t === 'photos') expected += b.files.length;
        else if (b.t === 'video') videoWanted = true;
      }

      for (const [i, b] of blocks.entries()) {
        switch (b.t) {
          case 'cover':
            await insertImage(page, jobs.coverFile(job.id), log);
            photos += 1;
            log('표지 삽입');
            break;
          case 'text':
            await typeParagraph(page, b.text);
            break;
          case 'blank':
            await page.keyboard.press('Enter');
            await page.waitForTimeout(120);
            break;
          case 'map':
            await insertPlace(page, b.query, b.address, log);
            break;
          case 'divider':
            if (await insertDivider(page, log)) dividers += 1;
            break;
          case 'photos': {
            const files = [];
            for (const name of b.files) {
              const file = path.join(pd, name);
              if (fs.existsSync(file)) files.push(file);
              else log(`사진을 찾지 못했습니다: ${name}`, 'warn');
            }
            if (files.length) {
              photos += await insertPhotos(page, files, b.layout, log);
              log(`사진 ${photos}/${expected} (${b.layout}${b.space ? ' · ' + b.space : ''})`);
            }
            break;
          }
          case 'video':
            videoOk = await insertVideo(page, path.join(jobs.dir(job.id), b.file), b, log);
            break;
          default:
            break;
        }
        if ((i + 1) % 6 === 0) log(`  진행 ${i + 1}/${blocks.length} 블록`);
      }
      log('본문 입력 완료');

      if (photos < expected) {
        throw new Error(`사진이 ${expected}장 중 ${photos}장만 들어갔습니다. ${dryRun ? '' : '저장하지 않았습니다. '}사진 파일을 확인해 주세요.`);
      }
      if (videoWanted && !videoOk && !dryRun) {
        throw new Error(`영상이 들어가지 않았습니다. ${mode === 'draft' ? '임시저장하지' : '등록하지'} 않았습니다. 영상 파일을 확인한 뒤 다시 시도해 주세요.`);
      }

      // ── 서식 (전체 글꼴 → 대표번호) ──
      await normalizeBody(page, log);
      log(`본문 글꼴 ${서식.글꼴} · ${서식.본문크기} 적용`);
      await stylePhone(page, log);
      await centerComponents(page, log);

      // ── 태그 ──
      if (tags.length) await fillTags(page, tags, log);

      // 들어간 것을 세어 남긴다.
      const count = await page
        .evaluate(() => ({
          image: document.querySelectorAll('.se-component.se-image').length,
          collage: document.querySelectorAll('.se-component.se-imageGroup').length,
          map: document.querySelectorAll('.se-component.se-placesMap').length,
          line: document.querySelectorAll('.se-component.se-horizontalLine').length,
          video: document.querySelectorAll('.se-component.se-video').length,
        }))
        .catch(() => null);
      if (count) log(`본문 구성 — 사진 ${count.image} · 묶음(콜라주/슬라이드) ${count.collage} · 지도 ${count.map} · 구분선 ${count.line} · 영상 ${count.video}`);

      const shot = path.join(jobs.dir(job.id), `editor-${Date.now()}.png`);
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});

      if (mode === 'draft') {
        await saveDraft(page, log);
        return { draft: true, screenshot: shot };
      }

      if (dryRun) {
        await page.bringToFront().catch(() => {});
        keep = true;
        return { dryRun: true, screenshot: shot };
      }

      // ── 등록 ──
      const 버튼 = await pick(page, SEL.등록, { timeout: 15000 });
      if (!버튼) throw new Error('[등록] 버튼을 찾지 못했습니다. 크롬 창에서 직접 등록해 주세요.');
      await 버튼.click();
      log('[등록]을 눌렀습니다. 게시글 주소를 기다립니다…');
      await page.waitForURL(/\/articles\/\d+(?!.*write)/, { timeout: 60000 }).catch(() => {});
      const url = page.url();
      if (!/\/articles\/\d+/.test(url) || /write/.test(url)) {
        throw new Error('등록이 끝났는지 확인하지 못했습니다. 크롬 창에서 등록 여부를 확인해 주세요. (다시 누르면 중복 글이 올라갈 수 있습니다)');
      }
      log(`발행 완료 — ${url}`, 'success');
      keep = true;
      return { dryRun: false, url, screenshot: shot };
    } finally {
      if (!keep) await page.close().catch(() => {});
    }
  });
}

module.exports = { publish, _t: { 영상제목, centerComponents, pick,insertImage, insertPhotos, insertPlace, insertVideo, insertDivider, ensureBoard, typeParagraph, normalizeBody, stylePhone, fillTags, SEL, WRITE_URL } };
