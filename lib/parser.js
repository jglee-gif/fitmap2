/**
 * lib/parser.js
 * PDF 텍스트에서 재무 수치를 정규식으로 정확하게 추출
 * AI에 의존하지 않고 항목명 매칭으로 숫자를 뽑음
 */

function parseNum(str) {
  if (!str) return null;
  const cleaned = String(str).replace(/[,\s원]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : Math.round(n);
}

// 텍스트에서 항목명 뒤 첫 번째 숫자 추출
function extractByLabel(text, labels) {
  for (const label of labels) {
    const escaped = typeof label === 'string'
      ? label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s\\S]{0,10}')
      : label.source;
    try {
      const re = new RegExp(escaped + '[\\s\\S]{0,150}?([0-9][0-9,]+)', 'i');
      const m = text.match(re);
      if (m) {
        const n = parseNum(m[1]);
        if (n !== null && n > 0) return n;
      }
    } catch(e) { continue; }
  }
  return null;
}

// 재무상태표 파싱
function parseBalanceSheet(text) {
  return {
    cash:               extractByLabel(text, ['보통예금']),
    total_assets:       extractByLabel(text, ['자산총계', '자 산 총 계']),
    current_liabilities:extractByLabel(text, ['유동부채합계', '유 동 부 채 합계', 'Ⅰ. 유 동 부 채']),
    short_term_debt:    extractByLabel(text, ['단기차입금', '단 기 차 입 금']),
    total_liabilities:  extractByLabel(text, ['부채총계', '부 채 총 계']),
    capital:            extractByLabel(text, ['자본금\n자 본 금', /자\s*본\s*금\s*\n?\s*10,/]),
    capital_surplus:    extractByLabel(text, ['주식발행초과금', '자본잉여금']),
    retained_deficit:   extractByLabel(text, ['미처리결손금', '미 처 리 결 손 금']),
    total_equity:       extractByLabel(text, ['자본총계', '자 본 총 계']),
  };
}

// 손익계산서 파싱
function parseIncomeStatement(text) {
  const revenue    = extractByLabel(text, ['매출액\n', '매 출 액\n', '서비스매출']);
  const sga        = extractByLabel(text, ['판매비와관리비\n', '판 매 비 와 관 리 비\n']);
  const salary     = extractByLabel(text, ['직원급여', '직 원 급 여']);
  const outsource  = extractByLabel(text, ['외주용역비', '외 주 용 역 비']);
  const govSub     = extractByLabel(text, ['국고보조금', '국 고 보 조 금']);
  const otherInc   = extractByLabel(text, ['영업외수익\n', '영 업 외 수 익\n']);
  const intExp     = extractByLabel(text, ['이자비용', '이 자 비 용']);

  // 영업이익/손실 — 손실이면 음수로
  let opIncome = extractByLabel(text, ['영업이익\n', '영 업 이 익\n']);
  const opLoss = extractByLabel(text, ['영업손실\n', '영 업 손 실\n']);
  if (opLoss && !opIncome) opIncome = -opLoss;

  let netIncome = extractByLabel(text, ['당기순이익\n', '당 기 순 이 익\n']);
  const netLoss = extractByLabel(text, ['당기순손실\n', '당 기 순 손 실\n']);
  if (netLoss && !netIncome) netIncome = -netLoss;

  return { revenue, sga, salary, outsourcing: outsource, gov_subsidy: govSub,
           other_income: otherInc, interest_expense: intExp,
           operating_income: opIncome, net_income: netIncome };
}

// 문서 기준일 추출
function extractPeriod(text) {
  // "제 5기 2026년 03월 31일 현재"
  const m = text.match(/제\s*(\d+)\s*[기基]\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (m) return { seq: +m[1], year: +m[2], month: +m[3], day: +m[4] };
  // 손익계산서 "2026년 1월 1일부터 2026년 3월 31일까지"
  const m2 = text.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일부터[\s\S]{0,30}?(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (m2) return { year: +m2[4], month: +m2[5], day: +m2[6], start_year: +m2[1] };
  return null;
}

function detectDocType(text) {
  if (text.includes('재무상태표')) return 'balance';
  if (text.includes('손익계산서')) return 'income';
  return 'unknown';
}

module.exports = { parseBalanceSheet, parseIncomeStatement, extractPeriod, detectDocType, parseNum };
