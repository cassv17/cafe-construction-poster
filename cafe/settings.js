// 글에 들어가는 고정 정보(대표번호·홈페이지 견적문의 주소). 화면에서 고친다.
const fs = require('fs');
const path = require('path');
const { DATA_DIR, PHONE } = require('./config');

const FILE = path.join(DATA_DIR, 'settings.json');

const DEFAULTS = {
  phone: PHONE, // 대표번호
  homepage: '', // 홈페이지 견적문의 주소. 비워 두면 글에 넣지 않는다.
};

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(patch) {
  const next = { ...load() };
  if (typeof patch.phone === 'string') next.phone = patch.phone.trim() || DEFAULTS.phone;
  if (typeof patch.homepage === 'string') next.homepage = patch.homepage.trim();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

module.exports = { load, save };
