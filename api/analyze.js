const Anthropic = require('@anthropic-ai/sdk');
const XLSX = require('xlsx');
const { SYSTEM_PROMPT, OUTPUT_FORMAT, VALUEUP_PROGRAMS } = require('../lib/prompts');
const { matchMentors } = require('../lib/mentors');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// 멀티파트 파싱 (Vercel 환경)
async function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const contentType = req.headers['content-type'] || '';
      const boundary = contentType.split('boundary=')[1];
      if (!boundary) return reject(new Error('boundary not found'));

      const parts = [];
      const sep = Buffer.from(`--${boundary}`);
      let start = 0;

      while (start < body.length) {
        const idx = body.indexOf(sep, start);
        if (idx === -1) break;
        const end = body.indexOf(sep, idx + sep.length);
        if (end === -1) break;
        const part = body.slice(idx + sep.length + 2, end - 2);
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd === -1) { start = end; continue; }
        const headers = part.slice(0, headerEnd).toString();
        const data = part.slice(headerEnd + 4);
        const nameMatch = headers.match(/name="([^"]+)"/);
        const filenameMatch = headers.match(/filename="([^"]+)"/);
        if (nameMatch) {
          parts.push({ name: nameMatch[1], filename: filenameMatch?.[1], data });
        }
        start = end;
      }
      resolve(parts);
    });
    req.on('error', reject);
  });
}

async function analyzeWithClaude(parts) {
  const messages = [];
  const content = [];

  // 파일들을 content 배열에 추가
  for (const part of parts) {
    if (!part.filename) continue;
    const ext = part.filename.toLowerCase();
    const b64 = part.data.toString('base64');

    if (ext.endsWith('.pdf')) {
      content.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: b64 }
      });
    } else if (ext.endsWith('.xlsx') || ext.endsWith('.xls')) {
      // Excel → 텍스트 변환
      const wb = XLSX.read(part.data, { type: 'buffer' });
      let text = '';
      for (const sn of wb.SheetNames) {
        const ws = wb.Sheets[sn];
        text += `\n[시트: ${sn}]\n` + XLSX.utils.sheet_to_csv(ws);
      }
      content.push({ type: 'text', text: `[Excel 파일: ${part.filename}]\n${text.slice(0, 8000)}` });
    }
  }

  if (!content.length) throw new Error('분석할 파일이 없습니다.');

  content.push({
    type: 'text',
    text: `위 자료를 분석해 Fit Map 진단 결과를 반환하세요.

그로스파트너스 추천 분야 선택지: B2B영업, 세무/회계/재무, 투자유치(IR), 해외 진출, 홍보마케팅, HR/노무/채용, 법무/법률, 빅데이터/AI, 고객검증/사업개발, R&D/기술사업화, 오픈이노베이션, IP/인증, ESG/지속가능경영, 유통/판로, SCM/물류

밸류업 프로그램 목록:
${VALUEUP_PROGRAMS}

출력 형식(JSON만):
${OUTPUT_FORMAT}`
  });

  messages.push({ role: 'user', content });

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages,
  });

  let raw = msg.content[0].text.trim();
  // JSON 펜스 제거
  raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(raw);
}

async function generateMentorReasons(company, bizContext, mentors, field) {
  const prompt = `기업 '${company}'에 대해 아래 멘토들이 왜 적합한지 설명해주세요.
기업 현황: ${JSON.stringify(bizContext)}
추천 분야: ${field}
멘토: ${JSON.stringify(mentors.map(m => ({ name: m.name, org: m.org, title: m.title, fields: m.fields, years: m.years, countries: m.countries })))}

JSON 배열만 반환 (다른 텍스트 없이):
[{"name":"멘토명","expertise":"전문성 1줄(25자 이내)","match_reason":"이 기업 맞춤 이유 1줄(40자 이내)"}]`;

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 800,
    messages: [{ role: 'user', content: prompt }],
  });

  let raw = msg.content[0].text.trim();
  raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  const reasons = JSON.parse(raw);
  const map = Object.fromEntries(reasons.map(r => [r.name, r]));
  return mentors.map(m => ({ ...m, ...(map[m.name] || {}) }));
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const parts = await parseMultipart(req);
    if (!parts.length) return res.status(400).json({ error: '파일이 없습니다.' });

    // 1. Claude로 재무 분석
    const result = await analyzeWithClaude(parts);

    // 2. 멘토 매칭 (최대 3개 분야)
    const topFields = (result.growth_partner_fields || []).slice(0, 3);
    const companyIndustries = result.company_industries || [];
    const recommendedMentors = {};

    for (const field of topFields) {
      const mentors = matchMentors([field], companyIndustries, 5);
      const withReasons = await generateMentorReasons(
        result.company || '',
        result.biz_context || {},
        mentors,
        field
      );
      recommendedMentors[field] = withReasons;
    }

    result.recommended_mentors = recommendedMentors;
    result.growth_partner_fields = topFields;

    res.status(200).json(result);
  } catch (err) {
    console.error('analyze error:', err);
    res.status(500).json({ error: err.message || '분석 중 오류가 발생했습니다.' });
  }
};
