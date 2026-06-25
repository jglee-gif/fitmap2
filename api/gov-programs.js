/**
 * bizinfo.go.kr 지원사업 API 연동
 * 엔드포인트: https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do
 * 인증키: crtfcKey (환경변수 BIZINFO_API_KEY)
 */

const BIZINFO_API = 'https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do';

// 기업 특성별 검색 키워드 매핑
const KEYWORD_MAP = {
  'AI': ['AI', '인공지능', '빅데이터'],
  'SaaS': ['SaaS', '소프트웨어', 'SW'],
  '해외진출': ['해외진출', '수출', '글로벌'],
  '채용': ['채용', '고용', '인력'],
  'R&D': ['R&D', '연구개발', '기술개발'],
  '투자': ['투자유치', 'VC', '벤처'],
  '뷰티': ['뷰티', '화장품', 'K-뷰티'],
  '제조': ['제조', 'OEM', '생산'],
};

// 공통 정부지원사업 고정 목록 (API 보완용)
const FIXED_PROGRAMS = [
  {
    id: 'tips-bizup',
    name: 'TIPS 비R&D 연계사업 — 창업사업화',
    org: '중소벤처기업부 / TIPS 운영사',
    amount: '최대 1.5억원',
    ratio: '정부 70% / 자부담 30%',
    period: '10개월',
    detail: ['제품·서비스 초기 검증(PoC) 비용', '고객 반응 조사·기능 검증·품질 테스트'],
    tags: ['TIPS 연계', 'AI R&D', '사업화 지원'],
    status: 'open',
    deadline: '상시 접수 · 연간 650개사 선정',
    link: 'https://www.bizinfo.go.kr',
    priority: 'P1',
    conditions: ['TIPS'],
  },
  {
    id: 'youth-job',
    name: '2026 청년일자리도약장려금',
    org: '고용노동부 / 고용24',
    amount: '1인당 최대 720만원',
    ratio: '월 60만원 × 12개월',
    period: '12개월',
    detail: ['만 15~34세 취업애로청년 정규직 채용 시 지원', '채용 후 3개월 이내 신청 필수'],
    tags: ['채용 지원', '청년 고용', '인건비 절감'],
    status: 'open',
    deadline: '2025.12.29~2026.12.31',
    link: 'https://www.work24.go.kr',
    priority: 'P1',
    conditions: ['채용'],
  },
  {
    id: 'kotra-voucher',
    name: 'KOTRA 수출지원기반활용사업 (글로벌 바우처)',
    org: 'KOTRA / 산업통상자원부',
    amount: '바우처 1억~2억원',
    ratio: '서비스 바우처 발급',
    period: '연간',
    detail: ['홍보·광고 / 전시회 참가비 지원', '통번역 / 해외규격인증 / 현지 마케팅'],
    tags: ['해외진출', '수출 바우처', 'KOTRA'],
    status: 'closed',
    deadline: '상반기 마감 → 하반기 2차 준비 권장',
    link: 'https://www.bizinfo.go.kr',
    priority: 'P2',
    conditions: ['해외진출'],
  },
  {
    id: 'ict-rd',
    name: 'AX혁신기업 ICT전략융합 R&D 바우처',
    org: '과학기술정보통신부',
    amount: '최대 1억4,000만원',
    ratio: '정부 75% / 자부담 25%',
    period: '7개월',
    detail: ['PoC·시제품 제작 등 기술검증 비용 지원', '중견기업과 공동 R&D 구조 가능'],
    tags: ['ICT R&D', 'AI·SW', '기술 검증'],
    status: 'closed',
    deadline: '연초(1~2월) 공고 예정 → 지금부터 준비',
    link: 'https://www.bizinfo.go.kr',
    priority: 'P2',
    conditions: ['AI', 'R&D'],
  },
  {
    id: 'ip-pct',
    name: 'IP 바우처 — PCT 해외 출원 지원',
    org: '특허청 / 한국발명진흥회',
    amount: '출원비 최대 70%',
    ratio: 'IP 바우처 발급',
    period: '상시',
    detail: ['PCT 국제 출원 비용 지원', '해외 특허 번역·현지 대리인 비용 포함'],
    tags: ['PCT 특허', 'IP 보호', '해외 출원'],
    status: 'open',
    deadline: '2026.01.26~2026.12.31 · 상시',
    link: 'https://www.bizinfo.go.kr',
    priority: 'P3',
    conditions: ['해외진출', '특허'],
  },
  {
    id: 'k-beauty',
    name: 'K-뷰티론 — 화장품 중소기업 정책자금',
    org: '중소벤처기업부 / 중소기업진흥공단',
    amount: '최대 10억원',
    ratio: '저금리 정책자금 대출',
    period: '5년 이내',
    detail: ['K-뷰티 화장품 분야 중소기업 대상', '시설·운전자금 저금리 대출 지원'],
    tags: ['정책자금', 'K-뷰티', '화장품'],
    status: 'open',
    deadline: '상시 접수',
    link: 'https://www.bizinfo.go.kr',
    priority: 'P1',
    conditions: ['뷰티'],
  },
];

async function fetchBizinfoPrograms(keywords = [], apiKey) {
  if (!apiKey) return [];

  const results = [];
  const seen = new Set();

  for (const keyword of keywords.slice(0, 3)) {
    try {
      const url = new URL(BIZINFO_API);
      url.searchParams.set('crtfcKey', apiKey);
      url.searchParams.set('keyword', keyword);
      url.searchParams.set('dataType', 'json');
      url.searchParams.set('numOfRows', '5');
      url.searchParams.set('pageIndex', '1');

      const res = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) continue;
      const data = await res.json();
      const items = data?.items?.item || data?.response?.body?.items?.item || [];
      const list = Array.isArray(items) ? items : [items];

      for (const item of list) {
        const id = item.pblancId || item.pblancNm;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        results.push({
          id,
          name: item.pblancNm || item.title || '(제목 없음)',
          org: item.jrsdInsttNm || item.insttNm || '',
          amount: item.applyAmt || '',
          ratio: '',
          period: `${item.rcptBgnDd || ''} ~ ${item.rcptEndDd || ''}`,
          detail: [item.bsnsSumCn || ''],
          tags: [keyword],
          status: isOpen(item.rcptBgnDd, item.rcptEndDd) ? 'open' : 'closed',
          deadline: `${item.rcptBgnDd||''} ~ ${item.rcptEndDd||''}`,
          link: item.detailUrl || 'https://www.bizinfo.go.kr',
          priority: 'P2',
          _fromApi: true,
        });
      }
    } catch (_) {
      // API 호출 실패 시 고정 목록으로 fallback
    }
  }
  return results;
}

function isOpen(start, end) {
  if (!start || !end) return null;
  const now = new Date();
  const s = new Date(start.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'));
  const e = new Date(end.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'));
  return now >= s && now <= e;
}

function selectPrograms(bizContext, industries, mpes) {
  // 기업 맥락 기반으로 관련 프로그램 필터링
  const conditions = new Set();

  // MPES 기반 조건
  const cur = mpes?.current || {};
  if (cur.liquidity?.grade === 'C' || cur.profitability?.grade === 'C') conditions.add('투자');
  if (cur.liquidity?.grade !== 'A') conditions.add('채용');

  // 업종/현황 기반 조건
  const ctx = JSON.stringify(bizContext || '').toLowerCase();
  if (/ai|인공지능|빅데이터/.test(ctx)) conditions.add('AI');
  if (/해외|일본|싱가포르|글로벌|수출/.test(ctx)) conditions.add('해외진출');
  if (/채용|인력|구인/.test(ctx)) conditions.add('채용');
  if (/r&d|연구|개발/.test(ctx)) conditions.add('R&D');
  if (/특허|ip|지식재산/.test(ctx)) conditions.add('특허');
  if (/뷰티|화장품/.test(ctx)) conditions.add('뷰티');
  if (/tips/.test(ctx)) conditions.add('TIPS');

  // 산업 기반 조건
  for (const ind of industries || []) {
    if (/뷰티|화장품/.test(ind)) conditions.add('뷰티');
    if (/ai|소프트웨어|sw/.test(ind.toLowerCase())) conditions.add('AI');
    if (/해외|글로벌/.test(ind)) conditions.add('해외진출');
  }

  // 조건 없으면 전체 추천
  if (!conditions.size) return FIXED_PROGRAMS;

  // 조건 매칭 점수 계산
  const scored = FIXED_PROGRAMS.map(p => {
    let score = 0;
    for (const c of p.conditions || []) {
      if (conditions.has(c)) score += 2;
    }
    if (p.priority === 'P1') score += 1;
    return { ...p, _score: score };
  }).sort((a, b) => b._score - a._score || (a.priority > b.priority ? 1 : -1));

  return scored;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    let body = {};
    if (req.method === 'POST') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    }

    const { biz_context, company_industries, mpes, keywords = [] } = body;
    const apiKey = process.env.BIZINFO_API_KEY;

    // 1. 기업 맥락 기반 고정 프로그램 선택
    const fixed = selectPrograms(biz_context, company_industries, mpes);

    // 2. bizinfo API 실시간 검색 (키 있을 때만)
    let apiResults = [];
    if (apiKey && keywords.length) {
      apiResults = await fetchBizinfoPrograms(keywords, apiKey);
    }

    // 3. 합치기 (API 결과 우선, 고정 목록으로 보완)
    const combined = [...apiResults, ...fixed].slice(0, 8);

    res.status(200).json({
      programs: combined,
      api_connected: !!apiKey,
      total: combined.length,
      from_api: apiResults.length,
    });
  } catch (err) {
    console.error('gov-programs error:', err);
    // 오류 시에도 고정 목록 반환
    res.status(200).json({
      programs: FIXED_PROGRAMS,
      api_connected: false,
      error: err.message,
    });
  }
};
