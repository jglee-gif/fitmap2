const Anthropic = require('@anthropic-ai/sdk');
const XLSX = require('xlsx');
const { SYSTEM_PROMPT, OUTPUT_FORMAT, VALUEUP_PROGRAMS } = require('../lib/prompts');
const { matchMentors } = require('../lib/mentors');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function safeParseJSON(raw) {
  if (!raw) throw new Error('AI 응답이 비어있습니다.');
  let text = raw.trim();
  text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  const firstBrace = Math.min(
    text.indexOf('{') === -1 ? Infinity : text.indexOf('{'),
    text.indexOf('[') === -1 ? Infinity : text.indexOf('[')
  );
  const lastBrace = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (firstBrace !== Infinity && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }
  try { return JSON.parse(text); }
  catch (e) { throw new Error(`응답 파싱 실패: ${text.slice(0, 100)}`); }
}

async function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks);
        const boundary = (req.headers['content-type'] || '').split('boundary=')[1];
        if (!boundary) return reject(new Error('boundary 없음'));
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
          if (nameMatch) parts.push({ name: nameMatch[1], filename: filenameMatch?.[1], data });
          start = end;
        }
        resolve(parts);
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

async function analyzeWithClaude(parts) {
  const content = [];
  for (const part of parts) {
    if (!part.filename) continue;
    const ext = part.filename.toLowerCase();
    if (ext.endsWith('.pdf')) {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: part.data.toString('base64') } });
    } else if (ext.endsWith('.xlsx') || ext.endsWith('.xls')) {
      try {
        const wb = XLSX.read(part.data, { type: 'buffer' });
        let text = '';
        for (const sn of wb.SheetNames) {
          text += `\n[시트: ${sn}]\n` + XLSX.utils.sheet_to_csv(wb.Sheets[sn]);
        }
        content.push({ type: 'text', text: `[Excel: ${part.filename}]\n${text.slice(0, 6000)}` });
      } catch (e) {
        content.push({ type: 'text', text: `[Excel: ${part.filename} 파싱 실패]` });
      }
    }
  }
  if (!content.length) throw new Error('분석할 파일이 없습니다.');

  content.push({ type: 'text', text: `위 자료를 분석해 Fit Map 진단 결과를 반환하세요.
그로스파트너스 분야: B2B영업, 세무/회계/재무, 투자유치(IR), 해외 진출, 홍보마케팅, HR/노무/채용, 법무/법률, 빅데이터/AI
밸류업 프로그램: ${VALUEUP_PROGRAMS}
중요: 반드시 { 로 시작하는 JSON만 반환. 설명 텍스트 절대 금지.
${OUTPUT_FORMAT}` });

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',  // Sonnet→Haiku로 변경 (속도↑)
    max_tokens: 3000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
  });
  return safeParseJSON(msg.content[0]?.text);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY 환경변수가 없습니다. Vercel Settings → Environment Variables를 확인하세요.' });
  }

  try {
    const parts = await parseMultipart(req);
    if (!parts.filter(p => p.filename).length) {
      return res.status(400).json({ error: '파일이 없습니다.' });
    }

    // 1. 재무 분석 (Haiku — 빠름)
    const result = await analyzeWithClaude(parts);

    // 2. 멘토 매칭 (점수 계산만, AI 호출 없음 — 타임아웃 방지)
    const topFields = (result.growth_partner_fields || []).slice(0, 3);
    const companyIndustries = result.company_industries || [];
    const recommendedMentors = {};
    for (const field of topFields) {
      recommendedMentors[field] = matchMentors([field], companyIndustries, 5);
    }
    result.recommended_mentors = recommendedMentors;
    result.growth_partner_fields = topFields;

    res.status(200).json(result);
  } catch (err) {
    console.error('analyze error:', err.message);
    let msg = err.message || '분석 오류';
    if (msg.includes('timeout') || msg.includes('Timeout')) msg = '분석 시간 초과. 파일을 줄이거나 잠시 후 다시 시도해주세요.';
    if (msg.includes('API') || msg.includes('auth')) msg = 'API 키 오류. Vercel 환경변수를 확인해주세요.';
    res.status(500).json({ error: msg });
  }
};
