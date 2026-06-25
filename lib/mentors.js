const fs = require('fs');
const path = require('path');

let _mentors = null;

function loadMentors() {
  if (_mentors) return _mentors;
  const csvPath = path.join(__dirname, '../data/mentors.csv');
  const raw = fs.readFileSync(csvPath, 'utf-8');
  const lines = raw.split('\n').filter(l => l.trim());
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));

  _mentors = lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim().replace(/"/g, ''));
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] || ''; });

    const fields = (obj['특화분야'] || '').split(/[,\n]/).map(f => f.trim()).filter(Boolean);
    const industries = (obj['특화산업'] || '').split(/[,\n]/).map(i => i.trim()).filter(Boolean);
    const years = parseFloat(obj['경력(년)']) || 0;

    // 국가 태그 자동 추론
    const orgLower = (obj['소속'] || '').toLowerCase();
    const countries = [];
    if (/japan|tokyo|도쿄|일본|lionice|라이오니스|k-startup center tokyo/.test(orgLower)) countries.push('🇯🇵 일본');
    if (/singapore|싱가포르/.test(orgLower)) countries.push('🇸🇬 싱가포르');
    if (/인터베스트|동남아/.test(orgLower) || industries.includes('동남아시아')) countries.push('🌏 동남아');
    if (!countries.length) countries.push('🌏 글로벌');

    return {
      name: obj['이름'] || '',
      org: obj['소속'] || '',
      title: obj['직위'] || '',
      fields,
      industries,
      years,
      countries,
    };
  }).filter(m => m.name);

  return _mentors;
}

function matchMentors(topFields, companyIndustries = [], topN = 5) {
  const mentors = loadMentors();
  // 한동환 제외 (진행 건 당사자)
  const pool = mentors.filter(m => m.name !== '한동환');

  const scored = [];
  for (const m of pool) {
    let score = 0;
    for (let i = 0; i < topFields.length; i++) {
      if (m.fields.includes(topFields[i])) score += (3 - i);
    }
    for (const ind of companyIndustries) {
      if (m.industries.includes(ind) || m.industries.includes('전분야')) { score += 2; break; }
    }
    if (m.years >= 20) score += 1;
    if (score > 0) scored.push({ ...m, score });
  }
  scored.sort((a, b) => b.score - a.score || b.years - a.years);

  // 5명 미달 시 보완
  if (scored.length < topN) {
    const seen = new Set(scored.map(m => m.name));
    const fallback = pool.filter(m => !seen.has(m.name)).sort((a, b) => b.years - a.years);
    for (const m of fallback) {
      if (scored.length >= topN) break;
      scored.push({ ...m, score: 0 });
    }
  }
  return scored.slice(0, topN);
}

module.exports = { loadMentors, matchMentors };
