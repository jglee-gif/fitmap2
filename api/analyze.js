/**
 * api/analyze.js — A방향: 정확한 파싱 + 공식 계산 + AI는 코멘트만
 */
const Anthropic = require('@anthropic-ai/sdk');
const XLSX = require('xlsx');
const { VALUEUP_PROGRAMS, SYSTEM_PROMPT } = require('../lib/prompts');
const { matchMentors } = require('../lib/mentors');
const {
  parseBalanceSheet, parseIncomeStatement, extractPeriod, detectDocType
} = require('../lib/parser');
const {
  calcLiquidity, calcGrowth, calcStability, calcProfitability,
  calcOverall, detectTriggers, fmtW
} = require('../lib/calculator');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── 멀티파트 파싱 ──
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
          const he = part.indexOf('\r\n\r\n');
          if (he === -1) { start = end; continue; }
          const headers = part.slice(0, he).toString();
          const data = part.slice(he + 4);
          const nm = headers.match(/name="([^"]+)"/);
          const fn = headers.match(/filename="([^"]+)"/);
          if (nm) parts.push({ name: nm[1], filename: fn?.[1], data });
          start = end;
        }
        resolve(parts);
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// ── PDF 텍스트 추출 (Claude Vision) ──
async function extractPdfText(b64, filename) {
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
        { type: 'text', text: '이 PDF의 모든 텍스트를 원본 그대로 추출해주세요. 숫자, 항목명, 단위 등을 정확히 출력하세요. 다른 설명은 불필요합니다.' }
      ]
    }]
  });
  return msg.content[0]?.text || '';
}

// ── Excel 파싱 ──
function parseExcel(data, filename) {
  const wb = XLSX.read(data, { type: 'buffer' });
  const result = { monthly_cash_in: {}, monthly_cash_out: {}, quarterly: {}, raw_text: '' };
  let fullText = '';

  for (const sn of wb.SheetNames) {
    const ws = wb.Sheets[sn];
    const csv = XLSX.utils.sheet_to_csv(ws);
    fullText += `\n[${sn}]\n${csv}`;
  }
  result.raw_text = fullText.slice(0, 8000);
  return result;
}

// ── AI 코멘트 생성 (숫자 계산은 이미 완료된 상태에서 해석만) ──
async function generateComment(company, mpes, financials, triggers, excelText) {
  const prompt = `아래는 "${company}"의 재무 분석 결과입니다. 심사역을 위한 종합 코멘트와 추천 정보를 JSON으로 반환하세요.

MPES 등급: ${mpes.overall} (${mpes.group})
- 유동성: ${mpes.current.liquidity.grade} (${mpes.current.liquidity.value})
- 성장성: ${mpes.current.growth.grade} (${mpes.current.growth.value})
- 안정성: ${mpes.current.stability.grade} (${mpes.current.stability.value})
- 수익성: ${mpes.current.profitability.grade} (${mpes.current.profitability.value})
현금잔고: ${fmtW(financials.cash)}
국고보조금 의존도: ${financials.gov_subsidy_ratio ? financials.gov_subsidy_ratio.toFixed(0) + '%' : '없음'}

성과 및 계획 (엑셀 요약):
${excelText ? excelText.slice(0, 1500) : '없음'}

반드시 JSON만 반환 ({ 로 시작):
{
  "summary": "종합 코멘트 2~3문장 (재무수치 근거 포함)",
  "matched_programs": [
    {"rank": 1, "name": "프로그램명", "priority": "P1", "reason": "매칭 근거"}
  ],
  "growth_partner_fields": ["추천분야1", "추천분야2", "추천분야3"],
  "company_industries": ["관련산업1"],
  "biz_context": {
    "current_status": ["현황1", "현황2"],
    "risks": ["리스크1"],
    "targets": ["타겟1"]
  },
  "action_items": ["즉시액션1", "액션2", "액션3"]
}`;

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }]
  });

  const raw = msg.content[0]?.text || '';
  const first = raw.indexOf('{'), last = raw.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try { return JSON.parse(raw.slice(first, last + 1)); }
    catch (e) { /* fallback */ }
  }
  return {
    summary: `${company}의 MPES 종합 등급은 ${mpes.overall}입니다.`,
    matched_programs: [],
    growth_partner_fields: ['투자유치(IR)', '세무/회계/재무'],
    company_industries: [],
    biz_context: { current_status: [], risks: [], targets: [] },
    action_items: []
  };
}

// ── 메인 핸들러 ──
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY 환경변수가 없습니다.' });
  }

  try {
    const parts = await parseMultipart(req);
    const files = parts.filter(p => p.filename);
    if (!files.length) return res.status(400).json({ error: '파일이 없습니다.' });

    // ── 1. 파일별 파싱 ──
    const balanceSheets = [];  // 연도별 재무상태표
    const incomeStmts = [];    // 연도별 손익계산서
    let excelData = null;
    let companyName = '(기업명 미확인)';

    for (const file of files) {
      const ext = file.filename.toLowerCase();

      if (ext.endsWith('.pdf')) {
        const b64 = file.data.toString('base64');
        const text = await extractPdfText(b64, file.filename);

        // 회사명 추출
        const cmatch = text.match(/회사명\s*[:：]?\s*(주식회사\s*\S+|\S+주식회사|\S+)/);
        if (cmatch && companyName === '(기업명 미확인)') companyName = cmatch[1].trim();

        const docType = detectDocType(text);
        const period = extractPeriod(text);

        if (docType === 'balance') {
          const bs = parseBalanceSheet(text);
          bs._period = period;
          bs._text = text.slice(0, 200);
          balanceSheets.push(bs);
        } else if (docType === 'income') {
          const is = parseIncomeStatement(text);
          is._period = period;
          incomeStmts.push(is);
        } else {
          // 둘 다 포함된 경우
          const bs = parseBalanceSheet(text);
          const is = parseIncomeStatement(text);
          bs._period = period; is._period = period;
          if (bs.cash || bs.total_assets) balanceSheets.push(bs);
          if (is.revenue || is.operating_income) incomeStmts.push(is);
        }
      } else if (ext.endsWith('.xlsx') || ext.endsWith('.xls')) {
        excelData = parseExcel(file.data, file.filename);
      }
    }

    // ── 2. 기간별 정렬 (최신순) ──
    const sortByPeriod = (arr) => arr.sort((a, b) => {
      const ay = a._period?.year || 0, by2 = b._period?.year || 0;
      const am = a._period?.month || 0, bm = b._period?.month || 0;
      return (by2 - ay) || (bm - am);
    });
    sortByPeriod(balanceSheets);
    sortByPeriod(incomeStmts);

    const latestBS = balanceSheets[0] || {};
    const latestIS = incomeStmts[0] || {};
    const prevIS   = incomeStmts[1] || {};

    // ── 3. 핵심 수치 계산 ──
    const cash = latestBS.cash || 0;

    // 월 순유출 계산 — Excel이 있으면 Excel 기준, 없으면 판관비 추정
    let monthlyNetBurn = null;
    if (excelData?.raw_text) {
      // Excel에서 월 Cash-out 추정 (연간 판관비 ÷ 12)
      if (latestIS.sga) monthlyNetBurn = Math.round(latestIS.sga / 12);
    } else if (latestIS.sga) {
      // 분기 자료면 ÷ 3, 연간이면 ÷ 12
      const period = latestIS._period;
      const isQuarter = period && period.month <= 3;
      monthlyNetBurn = Math.round(latestIS.sga / (isQuarter ? 3 : 12));
    }

    // 보조금 의존도
    const govSubsidyRatio = latestIS.gov_subsidy && latestIS.other_income
      ? (latestIS.gov_subsidy / latestIS.other_income) * 100 : null;

    // ── 4. MPES 공식 계산 ──
    const liquidity     = calcLiquidity(cash, monthlyNetBurn);
    const growth        = calcGrowth(latestIS.revenue, prevIS.revenue);
    const stability     = calcStability(latestBS.capital, latestBS.total_equity);
    const profitability = calcProfitability(latestIS.operating_income, latestIS.revenue);
    const { overall, group } = calcOverall(liquidity, growth, stability, profitability);

    const mpes = {
      history: balanceSheets.map((bs, i) => {
        const is = incomeStmts[i] || {};
        const prevIs = incomeStmts[i + 1] || {};
        const mn = is.sga ? Math.round(is.sga / 12) : null;
        const p = bs._period;
        const label = p ? `${p.year}년${p.month <= 3 ? '.1Q' : ''}` : `${i+1}기`;
        return {
          period: label,
          L: calcLiquidity(bs.cash, mn).grade,
          G: calcGrowth(is.revenue, prevIs.revenue).grade,
          S: calcStability(bs.capital, bs.total_equity).grade,
          P: calcProfitability(is.operating_income, is.revenue).grade,
        };
      }).reverse(),
      current: { liquidity, growth, stability, profitability },
      overall,
      group,
    };

    // ── 5. 현금 이력 ──
    const cashHistory = balanceSheets.map(bs => {
      const p = bs._period;
      return { period: p ? `${p.year}년${p.month<=3?'.1Q':'말'}` : '?', cash: bs.cash || 0 };
    }).reverse();

    // ── 6. 트리거 감지 ──
    const triggers = detectTriggers({
      cash, monthlyNetBurn,
      operatingIncome: latestIS.operating_income,
      govSubsidy: latestIS.gov_subsidy,
      otherIncome: latestIS.other_income,
      revenue: latestIS.revenue,
    });

    // ── 7. AI 코멘트 생성 (숫자는 이미 계산됨) ──
    const financialsSummary = { cash, gov_subsidy_ratio: govSubsidyRatio };
    const aiResult = await generateComment(
      companyName, mpes, financialsSummary, triggers, excelData?.raw_text
    );
    mpes.summary = aiResult.summary || '';

    // ── 8. 멘토 매칭 ──
    const topFields = (aiResult.growth_partner_fields || []).slice(0, 3);
    const companyIndustries = aiResult.company_industries || [];
    const recommendedMentors = {};
    for (const field of topFields) {
      recommendedMentors[field] = matchMentors([field], companyIndustries, 5);
    }

    // ── 9. 최종 결과 조립 ──
    const result = {
      company: companyName,
      report_date: (() => {
        const p = balanceSheets[0]?._period;
        return p ? `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}` : new Date().toISOString().slice(0,10);
      })(),
      financials: {
        cash,
        monthly_net_burn: monthlyNetBurn,
        gov_subsidy_ratio: govSubsidyRatio,
        revenue_history: incomeStmts.map((is, i) => {
          const p = is._period;
          return {
            period: p ? `${p.year}년${p.month<=3?'.1Q':''}` : `${i+1}기`,
            revenue: is.revenue || 0,
            cost: is.sga || 0,
            op_income: is.operating_income || 0,
          };
        }).reverse(),
        cash_history: cashHistory,
        plan: { q2_revenue: 0, q2_cost: 0, q3_revenue: 0, q3_cost: 0, q4_revenue: 0, q4_cost: 0 },
      },
      mpes,
      triggers,
      matched_programs: aiResult.matched_programs || [],
      growth_partner_fields: topFields,
      company_industries: companyIndustries,
      biz_context: aiResult.biz_context || { current_status: [], risks: [], targets: [] },
      action_items: aiResult.action_items || [],
      recommended_mentors: recommendedMentors,
    };

    res.status(200).json(result);

  } catch (err) {
    console.error('analyze error:', err.message);
    let msg = err.message || '분석 오류';
    if (msg.includes('timeout')) msg = '분석 시간 초과. 잠시 후 다시 시도해주세요.';
    res.status(500).json({ error: msg });
  }
};
