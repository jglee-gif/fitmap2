/**
 * lib/calculator.js
 * 추출된 DB값으로 MPES 등급, 런웨이 등을 공식 기반으로 계산
 * AI 없이 순수 계산만 수행
 */

// MPES 유동성 등급
function calcLiquidity(cash, monthlyNetBurn) {
  if (!cash || !monthlyNetBurn || monthlyNetBurn <= 0) {
    return { grade: 'N/A', value: '계산불가', reason: '현금흐름 데이터 없음' };
  }
  const runway = Math.round(cash / monthlyNetBurn);
  let grade = 'C';
  if (runway >= 18) grade = 'A';
  else if (runway >= 6) grade = 'B';
  return {
    grade,
    value: `런웨이 ${runway}개월`,
    reason: `현금 ${fmtW(cash)} ÷ 월순유출 ${fmtW(monthlyNetBurn)} = ${runway}개월`,
    runway
  };
}

// MPES 성장성 등급
function calcGrowth(currentRevenue, prevRevenue) {
  if (!currentRevenue || !prevRevenue || prevRevenue === 0) {
    return { grade: 'N/A', value: '계산불가', reason: '전기 매출 데이터 없음' };
  }
  const rate = ((currentRevenue - prevRevenue) / prevRevenue) * 100;
  let grade = 'C';
  if (rate >= 20) grade = 'A';
  else if (rate >= 0) grade = 'B';
  return {
    grade,
    value: `${rate >= 0 ? '+' : ''}${rate.toFixed(1)}%`,
    reason: `(${fmtW(currentRevenue)} - ${fmtW(prevRevenue)}) ÷ ${fmtW(prevRevenue)} × 100`,
    rate
  };
}

// MPES 안정성 등급
function calcStability(capital, totalEquity) {
  if (!capital) {
    return { grade: 'N/A', value: '계산불가', reason: '자본금 데이터 없음' };
  }
  // 자본총계가 양수이고 자본금보다 크면 잠식 없음
  if (totalEquity !== null && totalEquity > capital) {
    return { grade: 'A', value: '잠식없음', reason: `자본총계 ${fmtW(totalEquity)} > 자본금 ${fmtW(capital)}` };
  }
  if (totalEquity === null || totalEquity > 0) {
    // 자본총계 데이터 없거나 양수지만 자본금보다 작은 경우
    const rate = totalEquity !== null ? ((capital - totalEquity) / capital) * 100 : null;
    if (rate !== null) {
      const grade = rate < 50 ? 'B' : 'C';
      return { grade, value: `잠식률 ${rate.toFixed(1)}%`, reason: `(자본금 ${fmtW(capital)} - 자본총계 ${fmtW(totalEquity)}) ÷ 자본금` };
    }
  }
  // 자본총계가 음수 = 완전잠식
  if (totalEquity !== null && totalEquity < 0) {
    return { grade: 'C', value: '완전잠식', reason: `자본총계 ${fmtW(totalEquity)} (음수 = 완전잠식)` };
  }
  return { grade: 'N/A', value: '계산불가', reason: '자본 데이터 부족' };
}

// MPES 수익성 등급
function calcProfitability(operatingIncome, revenue) {
  if (operatingIncome === null || operatingIncome === undefined) {
    return { grade: 'N/A', value: '계산불가', reason: '영업이익 데이터 없음' };
  }
  if (operatingIncome > 0) {
    const margin = revenue ? (operatingIncome / revenue * 100).toFixed(1) : '-';
    return { grade: 'A', value: `영업이익 ${fmtW(operatingIncome)}`, reason: `영업이익률 +${margin}%` };
  }
  const loss = Math.abs(operatingIncome);
  if (revenue && revenue > 0) {
    const lossRate = (loss / revenue) * 100;
    const grade = lossRate <= 10 ? 'B' : 'C';
    return {
      grade,
      value: `영업손실 △${fmtW(loss)}`,
      reason: `영업손실률 ${lossRate.toFixed(1)}% (매출 대비) ${grade === 'B' ? '— 손익분기 근접' : '— 적자 지속'}`,
      lossRate
    };
  }
  return { grade: 'C', value: `영업손실 △${fmtW(loss)}`, reason: '영업 적자' };
}

// 종합 MPES 등급
function calcOverall(L, G, S, P) {
  const grades = [L.grade, G.grade, S.grade, P.grade];
  const overall = grades.map(g => g === 'N/A' ? '-' : g).join('');

  // 그룹 분류
  let group = '안정성장';
  const cCount = grades.filter(g => g === 'C').length;
  if (L.grade === 'C' || S.grade === 'C') group = '리스크관리';
  else if (cCount >= 2) group = '성장지원';
  else if (grades.filter(g => g === 'A').length >= 3) group = '스케일업';

  return { overall, group };
}

// 런웨이 임계선
function calcThresholds(monthlyNetBurn) {
  return {
    warn6:     monthlyNetBurn * 6,   // 경고선
    caution12: monthlyNetBurn * 12,  // 주의선
  };
}

// 트리거 감지
function detectTriggers(data, history) {
  const triggers = [];
  const { cash, monthlyNetBurn, operatingIncome, govSubsidy, otherIncome, revenue } = data;

  // T1: 현금 경고선
  if (cash && monthlyNetBurn) {
    const runway = cash / monthlyNetBurn;
    if (runway < 6) triggers.push({ type: 'warn', title: '🚨 현금 경고선 하회', desc: `런웨이 ${Math.round(runway)}개월 — IR 즉시 진행 필요` });
    else if (runway < 12) triggers.push({ type: 'caution', title: '⚠ 현금 주의선 하회', desc: `런웨이 ${Math.round(runway)}개월 — IR 준비 시작 필요` });
    else triggers.push({ type: 'ok', title: '✅ 런웨이 여유', desc: `현재 런웨이 약 ${Math.round(runway)}개월` });
  }

  // T2: 수익성
  if (operatingIncome !== null && operatingIncome < 0) {
    const lossRate = revenue ? Math.abs(operatingIncome) / revenue * 100 : null;
    triggers.push({ type: lossRate > 10 ? 'warn' : 'caution', title: '⚠ 영업 적자', desc: `영업손실 △${fmtW(Math.abs(operatingIncome))}${lossRate ? ` (매출의 ${lossRate.toFixed(0)}%)` : ''}` });
  }

  // T3: 보조금 의존도
  if (govSubsidy && otherIncome) {
    const ratio = govSubsidy / otherIncome * 100;
    if (ratio >= 80) {
      triggers.push({ type: 'caution', title: '⚠ 보조금 의존 고위험', desc: `국고보조금이 영업외수익의 ${ratio.toFixed(0)}% — 수주 연속성 핵심 변수` });
    }
  }

  return triggers;
}

// 금액 포맷
function fmtW(n) {
  if (n === null || n === undefined) return '-';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 100000000) return sign + (abs / 100000000).toFixed(1) + '억';
  if (abs >= 10000) return sign + Math.round(abs / 10000).toLocaleString() + '만';
  return sign + abs.toLocaleString() + '원';
}

module.exports = {
  calcLiquidity, calcGrowth, calcStability, calcProfitability,
  calcOverall, calcThresholds, detectTriggers, fmtW
};
