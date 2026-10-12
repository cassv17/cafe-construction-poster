// 카페 작업(현장 한 건) 저장소. 작업마다 폴더 하나: job.json + photos/ + cover.jpg + video.*
const fs = require('fs');
const path = require('path');
const { JOBS_DIR } = require('./config');

const ID_RE = /^cafe-\d+$/;

function dir(id) {
  if (!ID_RE.test(String(id))) throw new Error('작업 번호가 올바르지 않습니다.');
  return path.join(JOBS_DIR, id);
}
const photoDir = (id) => path.join(dir(id), 'photos');
const coverFile = (id) => path.join(dir(id), 'cover.jpg');

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function get(id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir(id), 'job.json'), 'utf8'));
  } catch {
    return null;
  }
}

function save(job) {
  job.updatedAt = new Date().toISOString();
  writeJson(path.join(dir(job.id), 'job.json'), job);
  return job;
}

function newId() {
  let id = `cafe-${Date.now()}`;
  while (fs.existsSync(dir(id))) id = `cafe-${Number(id.slice(5)) + 1}`;
  return id;
}

/** 입력 폼으로 작업을 만든다. 사진 파일은 이미 photos/ 에 올라가 있어야 한다. */
function create(id, input) {
  const job = {
    id,
    stage: 'input',
    분류: input.분류, // before | during
    시도: input.시도,
    구: input.구,
    동: input.동 || '',
    아파트명: input.아파트명,
    평수: input.평수,
    메모: input.메모 || '',
    photos: input.photos || [],
    cover: { photo: null, x: 50, y: 50, zoom: 1, made: false },
    titles: [],
    title: '',
    draft: null,
    video: null,
    board: input.board || null,
    error: null,
    createdAt: new Date().toISOString(),
  };
  return save(job);
}

/** 허용된 필드만 덮어쓴다. */
const EDITABLE = ['place', 'tags', 'stage', '분류', '시도', '구', '동', '아파트명', '평수', '메모', 'photos', 'cover', 'titles', 'title', 'draft', 'video', 'board', 'error', 'publishedAt', 'postUrl', 'posted', 'lastRun'];
function patch(id, fields) {
  const job = get(id);
  if (!job) throw new Error('작업을 찾지 못했습니다.');
  for (const k of EDITABLE) if (k in fields) job[k] = fields[k];
  return save(job);
}

/** 목록용 요약 (최근 순). */
function list() {
  if (!fs.existsSync(JOBS_DIR)) return [];
  return fs
    .readdirSync(JOBS_DIR)
    .filter((n) => ID_RE.test(n))
    .map((n) => get(n))
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map((j) => ({
      id: j.id,
      stage: j.stage,
      분류: j.분류,
      title: j.title || `${j.시도 || ''} ${j.구 || ''} ${j.아파트명 || ''}`.trim(),
      photos: (j.photos || []).length,
      createdAt: j.createdAt,
      publishedAt: j.publishedAt || null,
    }));
}

function remove(id) {
  fs.rmSync(dir(id), { recursive: true, force: true });
}

module.exports = { dir, photoDir, coverFile, get, save, create, patch, list, remove, newId };
