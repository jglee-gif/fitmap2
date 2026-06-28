const Anthropic = require('@anthropic-ai/sdk');
const XLSX = require('xlsx');
const { SYSTEM_PROMPT, OUTPUT_FORMAT, VALUEUP_PROGRAMS } = require('../lib/prompts');
const { matchMentors } = require('../lib/mentors');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── JSON 파싱 헬퍼 (최대한 방어적으로) ──
function safeParseJSON(raw) {
  if (!raw || typeof raw !== 'string') throw new Error('AI 응답이 비어있습니다.');

  let text = raw.trim();

  // 1. 마크다운 코드블록 제거
  text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

  // 2. 앞뒤 설명 텍스트 제거 — 첫 { 또는 [ 부터 마지막 } 또는 ] 까지만 추출
  const firstBrace = Math.min(
    text.indexOf('{') === -1 ? Infinity : text.indexOf('{'),
    text.indexOf('[') === -1 ? Infinity : text.indexOf('[')
  );
  const lastBrace = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));

  if (firstBrace !== Infinity && lastBrace !== -1 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }

  // 3. 파싱 시도
  try {
    return JSON.parse(text);
  } catch (e) {
    // 4. 마지막 수단: 일부 이스케이프 문제 보정
    try {
      // 줄바꿈 문자 보정
      const fixed = text.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
      return JSON.parse(fixed);
    } catch (e2) {
      throw new Error(`AI 응답 파싱 실패 — 응답 앞부분: ${text.slice(0, 200)}`);
    }
  }
}

// ── 멀티파트 파싱 (Vercel 환경) ──
async function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks);
        const contentType = req.headers['content-type'] || '';
        const boundary = contentType.split('boundary=')[1];
        if (!boundary) return reject(new Error('Content-Type에 boundary가 없습니다.'));

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
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// ── Claude로 재무 분석 ──
async function analyzeWithClaude(parts) {
  const content = [];

  for (const part of parts) {
    if (!part.filename) continue;
    const ext = part.filename.toLowerCase();

    if (ext.endsWith('.pdf')) {
      const b64 = part.data.toString('base64');
      content.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: b64 }
      });
    } else if (ext.endsWith('.xlsx') || ext.endsWith('.xls')) {
      try {
        const wb = XLSX.read(part.data, { type: 'buffer' });
        let text = '';
        for (const sn of wb.SheetNames) {
          const ws = wb.Sheets[sn];
          text += `\n[시트: ${sn}]\n` + XLSX.utils.sheet_to_csv(ws);
        }
        content.push({ type: 'text', text: `[Excel: ${part.filename}]\n${text.slice(0, 8000)}` });
      } catch (xlsxErr) {
        console.warn('Excel 파싱 실패:', part.filename, xlsxErr.message);
        content.push({ type: 'text', text: `[Excel 파일: ${part.filename} — 파싱 실패, 내용 생략]` });
      }
    }
  }

  if (!content.length) throw new Error('분석할 파일이 없습니다. PDF 또는 Excel 파일을 업로드해 주세요.');

  content.push({
    type: 'text',
    text: `위 자료를 분석해 Fit Map 진단 결과를 반환하세요.

그로스파트너스 추천 분야: B2B영업, 세무/회계/재무, 투자유치(IR), 해외 진출, 홍보마케팅, HR/노무/채용, 법무/법률, 빅데이터/AI, 고객검증/사업개발, R&D/기술사업화, 오픈이노베이션, IP/인증, ESG/지속가능경영, 유통/판로, SCM/물류

밸류업 프로그램:
${VALUEUP_PROGRAMS}

중요: 반드시 JSON만 반환. 설명 텍스트, 마크다운 없이 { 로 시작해서 } 로 끝나야 함.

출력 형식:
${OUTPUT_FORMAT}`
  });

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
  });

  const raw = msg.content[0]?.text;
  if (!raw) throw new Error('AI로부터 응답이 없습니다.');

  return safeParseJSON(raw);
}

// ── 멘토 매칭 이유 생성 (실패해도 기본값으로 fallback) ──
async function generateMentorReasons(company, bizContext, mentors, field) {
  // 멘토가 없으면 바로 반환
  if (!mentors.length) return mentors;

  try {
    const prompt = `기업 '${company}'의 '${field}' 분야 멘토 매칭 이유를 작성해주세요.
기업 현황: ${JSON.stringify(bizContext).slice(0, 500)}
멘토: ${JSON.stringify(mentors.slice(0, 5).map(m => ({ name: m.name, org: m.org, title: m.title, years: m.years })))}

JSON 배열만 반환 (설명 없이):
[{"name":"멘토명","expertise":"전문성 한 줄(20자 이내)","match_reason":"이 기업 맞춤 이유 한 줄(35자 이내)"}]`;

    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = msg.content[0]?.text;
    if (!raw) return mentors;

    const reasons = safeParseJSON(raw);
    if (!Array.isArray(reasons)) return mentors;

    const map = Object.fromEntries(reasons.map(r => [r.name, r]));
    return mentors.map(m => ({ ...m, ...(map[m.name] || {}) }));
  } catch (err) {
    // 멘토 이유 생성 실패해도 기본 멘토 정보는 반환
    console.warn('멘토 이유 생성 실패 (fallback):', field, err.message);
    return mentors;
  }
}

// ── 메인 핸들러 ──
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // API 키 확인
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다. Vercel Settings → Environment Variables를 확인해주세요.' });
  }

  try {
    // 1. 파일 파싱
    const parts = await parseMultipart(req);
    const fileCount = parts.filter(p => p.filename).length;
    if (!fileCount) return res.status(400).json({ error: '파일이 없습니다. PDF 또는 Excel 파일을 업로드해 주세요.' });

    // 2. Claude 재무 분석
    const result = await analyzeWithClaude(parts);

    // 3. 멘토 매칭
    const topFields = (result.growth_partner_fields || []).slice(0, 3);
    const companyIndustries = result.company_industries || [];
    const recommendedMentors = {};

    // 병렬로 처리해서 속도 향상
    await Promise.all(topFields.map(async (field) => {
      const mentors = matchMentors([field], companyIndustries, 5);
      recommendedMentors[field] = await generateMentorReasons(
        result.company || '',
        result.biz_context || {},
        mentors,
        field
      );
    }));

    result.recommended_mentors = recommendedMentors;
    result.growth_partner_fields = topFields;

    res.status(200).json(result);

  } catch (err) {
    console.error('analyze error:', err.message);

    // 에러 메시지를 사용자가 이해할 수 있게
    let userMsg = err.message || '분석 중 오류가 발생했습니다.';
    if (userMsg.includes('ANTHROPIC_API_KEY') || userMsg.includes('authentication')) {
      userMsg = 'API 키 인증 실패. Vercel 환경변수에 ANTHROPIC_API_KEY를 확인해주세요.';
    } else if (userMsg.includes('timeout') || userMsg.includes('Timeout')) {
      userMsg = '분석 시간이 초과됐어요. 파일 수를 줄이거나 잠시 후 다시 시도해주세요.';
    } else if (userMsg.includes('파싱 실패')) {
      userMsg = 'AI 응답 처리 중 오류가 발생했습니다. 다시 업로드해 주세요.';
    }

    res.status(500).json({ error: userMsg });
  }
};
