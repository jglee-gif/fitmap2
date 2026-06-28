const Anthropic = require('@anthropic-ai/sdk');
const XLSX = require('xlsx');
const { SYSTEM_PROMPT, VALUEUP_PROGRAMS } = require('../lib/prompts');
const { matchMentors } = require('../lib/mentors');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// JSON 안전 파싱
function safeParseJSON(raw) {
  if (!raw) throw new Error('AI 응답이 비어있습니다.');
  let text = raw.trim();
  // 마크다운 코드블록 제거
  text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  // 첫 { 부터 마지막 } 까지만 추출
  const first = Math.min(
    text.indexOf('{') === -1 ? Infinity : text.indexOf('{'),
    text.indexOf('[') === -1 ? Infinity : text.indexOf('[')
  );
  const last = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (first !== Infinity && last > first) text = text.slice(first, last + 1);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('응답 파싱 실패: ' + text.slice(0, 120));
  }
}

// 멀티파트 파싱
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
        const sep = Buffer.from('--' + boundary);
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

// Claude로 재무 분석
async function analyzeWithClaude(parts) {
  const content = [];

  for (const part of parts) {
    if (!part.filename) continue;
    const ext = part.filename.toLowerCase();
    if (ext.endsWith('.pdf')) {
      content.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: part.data.toString('base64') }
      });
    } else if (ext.endsWith('.xlsx') || ext.endsWith('.xls')) {
      try {
        const wb = XLSX.read(part.data, { type: 'buffer' });
        let text = '';
        for (const sn of wb.SheetNames) {
          text += '\n[시트: ' + sn + ']\n' + XLSX.utils.sheet_to_csv(wb.Sheets[sn]);
        }
        content.push({ type: 'text', text: '[Excel: ' + part.filename + ']\n' + text.slice(0, 5000) });
      } catch (e) {
        content.push({ type: 'text', text: '[Excel: ' + part.filename + ' 파싱 실패]' });
      }
    }
  }

  if (!content.length) throw new Error('분석할 파일이 없습니다. PDF 또는 Excel 파일을 업로드해 주세요.');

  // 출력 포맷 (간결하게)
  const OUTPUT_FORMAT = `{
  "company": "회사명",
  "report_date": "YYYY-MM-DD",
  "financials": {
    "cash": 0,
    "monthly_net_burn": 0,
    "gov_subsidy_ratio": 0,
    "revenue_history": [{"period":"2023년","revenue":0,"cost":0,"op_income":0}],
    "cash_history": [{"period":"2023년말","cash":0}],
    "plan": {"q2_revenue":0,"q2_cost":0,"q3_revenue":0,"q3_cost":0,"q4_revenue":0,"q4_cost":0}
  },
  "mpes": {
    "history": [{"period":"2023년","L":"C","G":"C","S":"A","P":"C"}],
    "current": {
      "liquidity":    {"grade":"C","value":"계산값","reason":"근거"},
      "growth":       {"grade":"C","value":"계산값","reason":"근거"},
      "stability":    {"grade":"A","value":"계산값","reason":"근거"},
      "profitability":{"grade":"C","value":"계산값","reason":"근거"}
    },
    "overall": "CAAC",
    "group": "성장지원",
    "summary": "종합 코멘트 2문장"
  },
  "triggers": [{"type":"warn","title":"트리거명","desc":"설명"}],
  "matched_programs": [{"rank":1,"name":"프로그램명","priority":"P1","reason":"이유"}],
  "growth_partner_fields": ["투자유치(IR)","세무/회계/재무","해외 진출"],
  "company_industries": ["AI/소프트웨어"],
  "biz_context": {
    "current_status": ["현황1"],
    "risks": ["리스크1"],
    "targets": ["타겟1"]
  },
  "action_items": ["액션1","액션2"]
}`;

  content.push({
    type: 'text',
    text: `위 재무자료를 분석해 아래 JSON 형식으로만 반환하세요.
절대 규칙: { 로 시작해서 } 로 끝나는 JSON만 출력. 설명 텍스트 금지.

그로스파트너스 추천 분야: B2B영업, 세무/회계/재무, 투자유치(IR), 해외 진출, 홍보마케팅, HR/노무/채용, 법무/법률, 빅데이터/AI

밸류업 프로그램:
${VALUEUP_PROGRAMS}

출력 형식:
${OUTPUT_FORMAT}`
  });

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
  });

  const raw = msg.content[0]?.text;
  if (!raw) throw new Error('AI 응답이 없습니다.');
  return safeParseJSON(raw);
}

// 메인 핸들러
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
    // 1. 파일 파싱
    const parts = await parseMultipart(req);
    if (!parts.filter(p => p.filename).length) {
      return res.status(400).json({ error: '파일이 없습니다. PDF 또는 Excel을 업로드해 주세요.' });
    }

    // 2. Claude 재무 분석
    const result = await analyzeWithClaude(parts);

    // 3. 멘토 매칭 (AI 호출 없이 점수 계산만 — 타임아웃 방지)
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
    let msg = err.message || '분석 중 오류가 발생했습니다.';
    if (msg.includes('timeout') || msg.includes('Timeout')) {
      msg = '분석 시간이 초과됐어요. 잠시 후 다시 시도해주세요.';
    } else if (msg.includes('auth') || msg.includes('API_KEY')) {
      msg = 'API 키 오류. Vercel 환경변수를 확인해주세요.';
    } else if (msg.includes('파싱 실패')) {
      msg = 'AI 응답 처리 오류. 다시 업로드해 주세요.';
    }
    res.status(500).json({ error: msg });
  }
};
