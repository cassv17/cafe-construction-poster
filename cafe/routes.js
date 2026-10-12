// [카페 공사중] 자동 발행 — API 라우트. server.js 에서 mount(app) 한 줄로 붙는다.
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');

const chrome = require('./chrome');
const notify = require('./notify');
const style = require('./style');
const boards = require('./boards');
const jobs = require('./jobs');
const settings = require('./settings');
const writer = require('./writer');
const titles = require('./titles');
const tagsLib = require('./tags');
const places = require('./places');
const cover = require('./cover');
const ai = require('../lib/ai');
const { CAFE_ID, COMPANY } = require('./config');

// ─────────────────────────────────────────────
// 진행 로그 (화면이 주기적으로 가져간다)
// ─────────────────────────────────────────────
const logs = new Map(); // key → { lines: [{m, level, at}], running, error }

function logOf(key) {
  if (!logs.has(key)) logs.set(key, { lines: [], running: false, error: null });
  return logs.get(key);
}

/** key 하나당 한 번에 하나만 돈다. fn(log) 의 실패는 로그에 남기고 서버는 죽이지 않는다. */
function startRun(key, fn) {
  const L = logOf(key);
  if (L.running) return false;
  L.running = true;
  L.error = null;
  L.lines = [];
  const log = (m, level = 'info') => {
    L.lines.push({ m: String(m), level, at: Date.now() });
    if (L.lines.length > 400) L.lines.shift();
  };
  Promise.resolve()
    .then(() => fn(log))
    .catch((e) => {
      L.error = String(e && e.message ? e.message : e).split('\n')[0];
      log(L.error, 'error');
    })
    .finally(() => {
      L.running = false;
    });
  return true;
}

// ─────────────────────────────────────────────
// 업로드
// ─────────────────────────────────────────────
function fixName(name) {
  try {
    const restored = Buffer.from(name, 'latin1').toString('utf8');
    return /�/.test(restored) ? name : restored;
  } catch {
    return name;
  }
}

const naturalSort = (a, b) => a.localeCompare(b, 'ko', { numeric: true, sensitivity: 'base' });

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const dir = file.fieldname === 'video' ? jobs.dir(req.jobId) : jobs.photoDir(req.jobId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    if (file.fieldname === 'video') {
      return cb(null, 'video' + (path.extname(fixName(file.originalname)).toLowerCase() || '.mp4'));
    }
    req.used = req.used || new Set();
    let name = fixName(file.originalname).replace(/[\\/:*?"<>|]/g, '_');
    if (req.used.has(name)) {
      const ext = path.extname(name);
      const base = name.slice(0, name.length - ext.length);
      let n = 2;
      while (req.used.has(`${base}_${n}${ext}`)) n++;
      name = `${base}_${n}${ext}`;
    }
    req.used.add(name);
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 80 },
  fileFilter(req, file, cb) {
    cb(null, file.fieldname === 'video' ? /^video\//.test(file.mimetype) : /^image\//.test(file.mimetype));
  },
});

function assignJobId(req, res, next) {
  req.jobId = jobs.newId();
  next();
}

// ─────────────────────────────────────────────
// 보조
// ─────────────────────────────────────────────
function titlesFor(job) {
  return titles.후보(job);
}

function coverTitle(job) {
  return cover.표지제목(job);
}

/** 서버가 다시 켜져서 '만드는 중' 에 멈춘 작업을 되돌린다. */
function healed(job) {
  if (job && job.stage === 'generating' && !logOf(job.id).running) {
    return jobs.patch(job.id, { stage: 'input', error: '서버가 다시 시작되어 글 만들기가 중단됐습니다. 다시 눌러 주세요.' });
  }
  return job;
}

/** 직접 고친 태그가 있으면 그것을, 없으면 규칙으로 만든 태그를 쓴다. */
function withTags(j) {
  return { ...j, tags: Array.isArray(j.tags) ? j.tags : tagsLib.build(j) };
}

function view(job) {
  const j = withTags(healed(job));
  return { ...j, suggestions: tagsLib.suggestions(j), blocks: writer.blocks(j), running: logOf(j.id).running, hasVideo: !!j.video };
}

/** 썸네일(작은 사본)을 만들어 돌려준다. 화면 확인용 — 발행에는 원본이 쓰인다. */
async function thumbOf(id, name) {
  const src = path.join(jobs.photoDir(id), name);
  if (!fs.existsSync(src)) return null;
  const out = path.join(jobs.photoDir(id), '_thumb', name.replace(/\.[^.]+$/, '') + '.jpg');
  if (!fs.existsSync(out)) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await sharp(src).rotate().resize({ width: 720, height: 720, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 75 }).toFile(out);
  }
  return out;
}

async function makeCover(id, log = () => {}) {
  const job = jobs.get(id);
  const photo = job.cover && job.cover.photo;
  if (!photo) throw new Error('표지에 쓸 사진을 먼저 골라 주세요.');
  log('표지 이미지를 만드는 중입니다…');
  await cover.만들기({
    photo: path.join(jobs.photoDir(id), photo),
    out: jobs.coverFile(id),
    분류: job.분류,
    제목: coverTitle(job),
    x: job.cover.x ?? 50,
    y: job.cover.y ?? job.cover.초점Y ?? 50,
    zoom: job.cover.zoom ?? 1,
  });
  // 표지가 만들어졌으니 이전 실패 문구(예: 로고 파일 오류)는 지운다. 남겨 두면 해결된 뒤에도 화면에 계속 빨갛게 보인다.
  jobs.patch(id, { cover: { ...job.cover, made: true, at: Date.now() }, error: null });
  log('표지 이미지를 만들었습니다.');
}

/** 요청에서 온 표지 설정(사진·위치·확대)을 검증해 합친다. */
function mergeCover(job, b) {
  const c = { ...job.cover };
  if (b.photo && job.photos.includes(b.photo)) c.photo = b.photo;
  if (b.x !== undefined) c.x = Math.min(100, Math.max(0, Number(b.x) || 0));
  if (b.y !== undefined) c.y = Math.min(100, Math.max(0, Number(b.y) || 0));
  if (b.초점Y !== undefined) c.y = Math.min(100, Math.max(0, Number(b.초점Y) || 0)); // 예전 이름
  if (b.zoom !== undefined) c.zoom = Math.min(3, Math.max(1, Number(b.zoom) || 1));
  return c;
}

function mount(app) {
  const r = express.Router();
  r.use(express.json({ limit: '4mb' }));

  // 카페 ID 가 없으면 아무것도 못 한다. 화면이 이 메시지를 그대로 보여 준다.
  r.use((req, res, next) => {
    if (CAFE_ID || req.path === '/status') return next();
    res.status(400).json({ error: '카페 ID 가 설정되지 않았습니다. 저장소 맨 위의 cafe.config.json 에 cafeId 를 넣고 서버를 다시 켜 주세요. (README 참고)' });
  });

  // ── 상태 ──────────────────────────────────
  r.get('/status', async (req, res) => {
    const st = style.summary();
    res.json({
      chrome: await chrome.status(),
      settings: settings.load(),
      style: { links: st.links.length, analyzed: st.analyzed, guideAt: st.guideAt },
      boards: boards.load(),
      setup: { cafeId: !!CAFE_ID, company: COMPANY, ai: ai.name() },
    });
  });

  r.post('/chrome/open', async (req, res) => {
    try {
      res.json(await chrome.launch());
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  r.get('/settings', (req, res) => res.json(settings.load()));
  r.put('/settings', (req, res) => res.json(settings.save(req.body || {})));

  // ── 진행 로그 ─────────────────────────────
  r.get('/log/:key', (req, res) => {
    const L = logOf(req.params.key);
    const after = Number(req.query.after) || 0;
    res.json({ lines: L.lines.slice(after), next: L.lines.length, running: L.running, error: L.error });
  });

  // ── 말투(기준 글 링크) ────────────────────
  r.get('/style', (req, res) => res.json(style.summary()));

  r.post('/style/link', (req, res) => {
    const url = String((req.body || {}).url || '').trim();
    if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: '카페 글 주소(https://…)를 붙여 넣어 주세요.' });
    if (!style.articleId(url)) return res.status(400).json({ error: '주소에서 글 번호를 찾지 못했습니다.' });
    const started = startRun('style', (log) => style.addLink(url, log).then(() => log('끝났습니다.', 'success')));
    res.status(started ? 202 : 409).json(started ? { started: true } : { error: '말투 분석이 이미 진행 중입니다.' });
  });

  r.post('/style/rebuild', (req, res) => {
    const started = startRun('style', (log) => style.rebuild(log).then(() => log('끝났습니다.', 'success')));
    res.status(started ? 202 : 409).json(started ? { started: true } : { error: '말투 분석이 이미 진행 중입니다.' });
  });

  r.delete('/style/link/:id', (req, res) => res.json(style.removeLink(req.params.id)));

  // ── 게시판 ────────────────────────────────
  r.get('/boards', (req, res) => res.json(boards.load()));

  r.put('/boards/region', (req, res) => {
    try {
      const { region, menuId, name } = req.body || {};
      res.json(boards.setRegion(region, menuId, name));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  r.post('/boards/refresh', (req, res) => {
    const started = startRun('boards', (log) => boards.refresh(log).then(() => log('끝났습니다.', 'success')));
    res.status(started ? 202 : 409).json(started ? { started: true } : { error: '이미 진행 중입니다.' });
  });

  // ── 작업 ──────────────────────────────────
  r.get('/jobs', (req, res) => res.json(jobs.list()));

  r.post(
    '/jobs',
    assignJobId,
    upload.fields([{ name: 'photos', maxCount: 70 }, { name: 'video', maxCount: 1 }]),
    (req, res) => {
      const b = req.body || {};
      const bad = (msg) => {
        fs.rmSync(jobs.dir(req.jobId), { recursive: true, force: true });
        res.status(400).json({ error: msg });
      };
      const 분류 = b.kind === 'before' ? 'before' : b.kind === 'during' ? 'during' : null;
      if (!분류) return bad('공사전/공사중 중 하나를 골라 주세요.');
      const 시도 = (b.sido || '').trim();
      const 구 = (b.gu || '').trim();
      const 아파트명 = (b.apt || '').trim();
      if (!시도 || !구 || !아파트명) return bad('시/도, 구, 아파트명은 꼭 입력해 주세요.');
      const files = ((req.files && req.files.photos) || []).map((f) => f.filename).sort(naturalSort);
      if (!files.length) return bad('사진을 1장 이상 올려 주세요.');

      const video = req.files && req.files.video && req.files.video[0] ? req.files.video[0].filename : null;
      const board = boards.pick(시도, 구, (b.dong || '').trim());
      const job = jobs.create(req.jobId, {
        분류, 시도, 구, 동: (b.dong || '').trim(), 아파트명, 평수: (b.size || '').trim(), 메모: (b.memo || '').trim(), photos: files, board,
      });
      const t = titlesFor(job);
      const placeName = (b.placeName || '').trim();
      const place = placeName ? { name: placeName, address: (b.placeAddress || '').trim() } : null;
      jobs.patch(job.id, { titles: t, title: t[0] || '', video, place, tags: tagsLib.build(job) });
      res.json({ id: job.id });
    }
  );

  r.get('/jobs/:id', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: '작업을 찾지 못했습니다.' });
    res.json(view(job));
  });

  r.delete('/jobs/:id', (req, res) => {
    if (logOf(req.params.id).running) return res.status(409).json({ error: '진행 중인 작업은 지울 수 없습니다.' });
    jobs.remove(req.params.id);
    logs.delete(req.params.id);
    res.json({ ok: true });
  });

  // 수정 저장 — 제목, 본문, 표지 선택, 게시판, 현장 정보
  r.put('/jobs/:id', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: '작업을 찾지 못했습니다.' });
    const b = req.body || {};
    const f = {};
    for (const k of ['title', '시도', '구', '동', '아파트명', '평수', '메모']) if (typeof b[k] === 'string') f[k] = b[k];
    if (b.분류 === 'before' || b.분류 === 'during') f.분류 = b.분류;
    if (Array.isArray(b.tags)) f.tags = [...new Set(b.tags.map((t) => String(t).replace(/[\s#]/g, '')).filter(Boolean))].slice(0, 10);
    if (b.place && b.place.name) f.place = { name: String(b.place.name), address: String(b.place.address || '') };
    if (Array.isArray(b.titles)) f.titles = b.titles.map(String);
    if (b.board && b.board.menuId) f.board = { menuId: Number(b.board.menuId), name: String(b.board.name || '') };
    if (b.draft) {
      const d = b.draft;
      f.draft = {
        intro: String(d.intro || ''),
        sections: (d.sections || []).map((s) => ({
          space: String(s.space || ''),
          photos: (s.photos || []).map(String).filter((n) => job.photos.includes(n)),
          text: String(s.text || ''),
          layout: ['individual', 'collage', 'slide'].includes(s.layout) ? s.layout : writer.기본배치((s.photos || []).length),
        })),
        outro: String(d.outro || ''),
        keywords: (job.draft && job.draft.keywords) || [],
      };
    }
    if (b.cover) f.cover = mergeCover(job, b.cover);
    if (b.removeVideo) {
      if (job.video) fs.rmSync(path.join(jobs.dir(job.id), job.video), { force: true });
      f.video = null;
    }
    res.json(view(jobs.patch(job.id, f)));
  });

  // 제목 후보를 현장 정보로 다시 만든다.
  r.post('/jobs/:id/titles', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: '작업을 찾지 못했습니다.' });
    const t = titlesFor(job);
    res.json(view(jobs.patch(job.id, { titles: t, title: t[0] || job.title })));
  });

  // 공사전/공사중이나 현장 정보를 바꾼 뒤 제목 후보·태그·표지를 새로 만든다. (본문 글은 그대로 둔다)
  r.post('/jobs/:id/refresh', async (req, res) => {
    const id = req.params.id;
    const job = jobs.get(id);
    if (!job) return res.status(404).json({ error: '작업을 찾지 못했습니다.' });
    try {
      const t = titlesFor(job);
      const f = { titles: t, title: t[0] || job.title, tags: tagsLib.build(job) };
      if ((req.body || {}).repickBoard) {
        const b = boards.pick(job.시도, job.구, job.동);
        if (b) f.board = b;
      }
      jobs.patch(id, f);
      if (job.cover && job.cover.photo) await makeCover(id);
      res.json(view(jobs.get(id)));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 새 작업 화면을 열 때 검색용 토큰을 미리 받아 둔다. 크롬이 꺼져 있거나 로그인 전이면 아무것도 열지 않고 넘어간다.
  r.post('/places/warm', async (req, res) => {
    try {
      const st = await chrome.status();
      if (!st.loggedIn) return res.json({ ready: false });
      res.json(await places.warm());
    } catch {
      res.json({ ready: false });
    }
  });

  // 현장명 확인 — 네이버 지도 검색 후보 (에디터 토큰으로 직접 호출. 첫 검색 1초, 이후 0.2초)
  r.post('/places', async (req, res) => {
    const b = req.body || {};
    const info = { 시도: String(b.sido || ''), 구: String(b.gu || ''), 동: String(b.dong || ''), 아파트명: String(b.apt || '').trim() };
    if (!info.아파트명) return res.status(400).json({ error: '아파트명을 입력해 주세요.' });
    try {
      res.json({ candidates: await places.search(info) });
    } catch (e) {
      // Playwright 오류 문구에는 'Call log' 가 길게 붙는다. 첫 줄만 보여 준다.
      res.status(500).json({ error: String(e.message).split('\n')[0], login: /로그인/.test(e.message) });
    }
  });

  // 영상 교체
  r.post('/jobs/:id/video', (req, res, next) => {
    req.jobId = req.params.id;
    if (!jobs.get(req.jobId)) return res.status(404).json({ error: '작업을 찾지 못했습니다.' });
    next();
  }, upload.single('video'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: '영상 파일을 올려 주세요.' });
    res.json(view(jobs.patch(req.jobId, { video: req.file.filename })));
  });

  // 글 만들기(초안)
  r.post('/jobs/:id/generate', (req, res) => {
    const id = req.params.id;
    const job = jobs.get(id);
    if (!job) return res.status(404).json({ error: '작업을 찾지 못했습니다.' });
    if (job.stage === 'published') return res.status(409).json({ error: '이미 발행한 글입니다.' });
    const started = startRun(id, async (log) => {
      jobs.patch(id, { stage: 'generating', error: null });
      try {
        const { cover: pick, draft } = await writer.generate(id, { onLog: log });
        const cur = jobs.get(id);
        const keepCover = cur.cover && cur.cover.photo && cur.photos.includes(cur.cover.photo);
        jobs.patch(id, {
          stage: 'drafted',
          draft,
          tags: tagsLib.build({ ...cur, draft }),
          cover: { ...cur.cover, photo: keepCover ? cur.cover.photo : pick, made: false },
          error: null,
        });
        await makeCover(id, log);
        log('초안이 완성됐습니다. 아래에서 확인하고 고쳐 주세요.', 'success');
      } catch (e) {
        jobs.patch(id, { stage: jobs.get(id).draft ? 'drafted' : 'input', error: e.message.split('\n')[0] });
        notify.toast('⚠ 글 만들기 실패', `${job.title}\n${e.message.split('\n')[0]}`);
        throw e;
      }
    });
    res.status(started ? 202 : 409).json(started ? { started: true } : { error: '이미 글을 만드는 중입니다.' });
  });

  // 표지 다시 만들기(사진·초점 변경 반영)
  r.post('/jobs/:id/cover', async (req, res) => {
    const id = req.params.id;
    const job = jobs.get(id);
    if (!job) return res.status(404).json({ error: '작업을 찾지 못했습니다.' });
    try {
      const b = req.body || {};
      // 사진을 새로 고르면 위치·확대는 처음 상태(가운데·1배)로 돌린다.
      const changedPhoto = b.photo && b.photo !== (job.cover && job.cover.photo);
      const merged = mergeCover(job, changedPhoto ? { photo: b.photo, x: 50, y: 50, zoom: 1, ...b } : b);
      jobs.patch(id, { cover: merged });
      await makeCover(id);
      res.json(view(jobs.get(id)));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 표지용 사진을 파일로 직접 올린다. 본문 사진 목록에도 추가하고(맨 앞 묶음), 그 사진으로 표지를 만든다.
  r.post(
    '/jobs/:id/cover-photo',
    (req, res, next) => {
      const job = jobs.get(req.params.id);
      if (!job) return res.status(404).json({ error: '작업을 찾지 못했습니다.' });
      req.jobId = job.id;
      req.used = new Set(job.photos); // 이미 있는 파일 이름과 겹치지 않게
      next();
    },
    upload.single('photo'),
    async (req, res) => {
      const id = req.params.id;
      if (!req.file) return res.status(400).json({ error: '사진 파일(이미지)을 올려 주세요.' });
      try {
        const job = jobs.get(id);
        const name = req.file.filename;
        const photos = [...job.photos, name];
        const f = { photos, cover: { ...job.cover, photo: name, x: 50, y: 50, zoom: 1, made: false } };
        // 초안이 있으면 본문 맨 앞에 사진만 있는 묶음으로 넣는다. (◀▶ 로 순서를 옮길 수 있다)
        if (job.draft) {
          f.draft = { ...job.draft, sections: [{ space: '표지 사진', photos: [name], text: '', layout: 'individual' }, ...job.draft.sections] };
        }
        jobs.patch(id, f);
        await makeCover(id);
        res.json(view(jobs.get(id)));
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    }
  );

  r.get('/jobs/:id/cover.jpg', (req, res) => {
    const f = jobs.coverFile(req.params.id);
    if (!fs.existsSync(f)) return res.status(404).end();
    res.set('Cache-Control', 'no-store');
    res.sendFile(f);
  });

  r.get('/jobs/:id/photo/:name', async (req, res) => {
    try {
      const name = path.basename(req.params.name);
      const file = req.query.small ? await thumbOf(req.params.id, name) : path.join(jobs.photoDir(req.params.id), name);
      if (!file || !fs.existsSync(file)) return res.status(404).end();
      res.sendFile(file);
    } catch {
      res.status(404).end();
    }
  });

  // 카페에 입력 / 발행
  //   dryRun:true  → 카페 글쓰기 화면에 끝까지 채우고 [등록]은 누르지 않는다 (크롬 창에서 직접 확인)
  //   dryRun:false → 최종 컨펌. [등록]까지 누른다 (confirm:true 가 함께 와야 한다)
  //   mode:'draft'   → 화면 밖(백그라운드) 창에서 끝까지 채우고 [임시등록]까지 누른다. 발행은 하지 않는다. (화면의 단일 버튼)
  r.post('/jobs/:id/publish', (req, res) => {
    const id = req.params.id;
    const job = jobs.get(id);
    if (!job) return res.status(404).json({ error: '작업을 찾지 못했습니다.' });
    const mode = (req.body || {}).mode === 'draft' ? 'draft' : null;
    const dryRun = mode ? false : (req.body || {}).dryRun !== false;
    if (!mode && !dryRun && (req.body || {}).confirm !== true) {
      return res.status(400).json({ error: '발행하려면 최종 확인이 필요합니다.' });
    }
    if (!job.draft) return res.status(400).json({ error: '먼저 글을 만들어 주세요.' });
    if (!job.title.trim()) return res.status(400).json({ error: '제목을 입력해 주세요.' });
    if (!job.board || !job.board.menuId) return res.status(400).json({ error: '올릴 게시판을 골라 주세요.' });
    if (!job.cover || !job.cover.made) return res.status(400).json({ error: '표지 이미지를 먼저 만들어 주세요.' });
    if (job.stage === 'published' && !dryRun) return res.status(409).json({ error: '이미 발행한 글입니다.' });

    const started = startRun(`pub-${id}`, async (rawLog) => {
      const editor = require('./editor');
      const j = withTags(job);
      let warns = 0;
      const log = (m, level) => {
        if (level === 'warn') warns += 1;
        rawLog(m, level);
      };
      let result;
      try {
        result = await editor.publish({ job: j, blocks: writer.blocks(j), dryRun, mode, onLog: log });
      } catch (e) {
        // 웹페이지를 안 보고 있어도 알 수 있게 윈도우 알림을 띄운다.
        notify.toast('⚠ 카페 작업 실패', `${j.title}\n${String(e.message).split('\n')[0]}`);
        throw e;
      }
      if (mode === 'draft') {
        jobs.patch(id, { stage: 'saved', savedAt: new Date().toISOString() });
        log('카페에 임시저장했습니다. 카페 글쓰기 화면의 [임시등록] 목록에서 불러와 확인한 뒤 등록하세요.', 'success');
        notify.toast(
          warns ? '카페 임시 저장 완료 (확인 필요 있음)' : '카페 임시 저장 완료',
          warns ? `${j.title}\n경고 ${warns}건이 있습니다. 작업 화면의 로그를 확인해 주세요.` : j.title
        );
      } else if (!dryRun) {
        jobs.patch(id, { stage: 'published', publishedAt: new Date().toISOString(), postUrl: result.url || null });
        log('발행했습니다.', 'success');
      } else {
        log('카페 글쓰기 화면에 입력을 마쳤습니다. 크롬 창에서 확인하세요. (등록은 누르지 않았습니다)', 'success');
      }
    });
    res.status(started ? 202 : 409).json(started ? { started: true, logKey: `pub-${id}` } : { error: '이미 진행 중입니다.' });
  });

  app.use('/api/cafe', r);
}

module.exports = { mount };
