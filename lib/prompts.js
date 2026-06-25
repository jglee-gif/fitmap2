const VALUEUP_PROGRAMS = `
1. Private IR (후속투자 강화) — 외부 투자자 3~5개사와 포트폴리오사 1:1 소규모 IR, 3~11월 월 1회
2. 데모데이 (후속투자 강화) — 2026년 7월, ICT·로봇·모빌리티 세션 IR, 200명 참석
3. 후속투자자 연계 (VC DB 매칭) — 섹터/라운드/규모별 투자사 DB 매칭, 신규 투자사 DB 50개+
4. 그로스파트너스 전문가 활용 (필수) — 상시 멘토링 (세무/회계/재무, 투자유치, 법률, 해외진출 등)
5. Global Express Program — 일본·동남아 현지 파트너 연결 (유통, 마케팅, 법무)
6. 고민나눔소 — 전문가 초청 소규모 세션 (반기 5회차)
7. TIPS/서울형TIPS 졸업 지원 — 협약 종료 예정 기업 밀착 관리
8. 기업간 교류회 / 오픈세미나 — CTO 교류회, OI 교류회 (반기 1회)
`;

const GP_FIELDS = [
  'B2B영업', '세무/회계/재무', '투자유치(IR)', '해외 진출',
  '홍보마케팅', 'HR/노무/채용', '법무/법률', '빅데이터/AI',
  '고객검증/사업개발', 'R&D/기술사업화', '오픈이노베이션', 'IP/인증',
  'ESG/지속가능경영', '유통/판로', 'SCM/물류'
];

const SYSTEM_PROMPT = `당신은 마크앤컴퍼니 투자관리팀 AI 어시스턴트 Fit Map입니다.
포트폴리오사의 재무 데이터를 분석해 종합 진단 결과를 생성합니다.

MPES 평가 기준:
- 유동성(Runway) = 현금 ÷ 월평균순유출 → A:≥18개월, B:6~18개월, C:<6개월
- 성장성 = (당기매출-전기매출)/전기매출×100 → A:≥+20%, B:0~20%, C:<0%
- 안정성 = 자본잠식률=(자본금-자본총계)/자본금×100 → A:<0%(잠식없음), B:0~50%, C:≥50%
- 수익성 = 영업이익 → A:흑자, B:손실≤매출10%, C:손실>매출10%

임계선:
- 경고선 = 월순유출 × 6개월
- 주의선 = 월순유출 × 12개월

반드시 JSON만 반환하고 다른 텍스트(마크다운 포함)는 절대 포함하지 마세요.`;

const OUTPUT_FORMAT = `{
  "company": "회사명",
  "report_date": "기준일(YYYY-MM-DD)",
  "financials": {
    "cash": 현금잔고_원단위,
    "monthly_net_burn": 월순유출_원단위,
    "gov_subsidy_ratio": 보조금의존도_퍼센트,
    "revenue_history": [{"period":"2023년","revenue":0,"cost":0,"op_income":0},{"period":"2024년","revenue":0,"cost":0,"op_income":0},{"period":"2025년","revenue":0,"cost":0,"op_income":0},{"period":"2026.1Q","revenue":0,"cost":0,"op_income":0}],
    "cash_history": [{"period":"2023년말","cash":0},{"period":"2024년말","cash":0},{"period":"2025년말","cash":0},{"period":"2026.1Q","cash":0}],
    "plan": {"q2_revenue":0,"q2_cost":0,"q3_revenue":0,"q3_cost":0,"q4_revenue":0,"q4_cost":0}
  },
  "mpes": {
    "history": [
      {"period":"2023년","L":"A/B/C","G":"A/B/C","S":"A/B/C","P":"A/B/C"},
      {"period":"2024년","L":"A/B/C","G":"A/B/C","S":"A/B/C","P":"A/B/C"},
      {"period":"2025년","L":"A/B/C","G":"A/B/C","S":"A/B/C","P":"A/B/C"},
      {"period":"2026.1Q","L":"A/B/C","G":"A/B/C","S":"A/B/C","P":"A/B/C"}
    ],
    "current": {
      "liquidity": {"grade":"A/B/C","value":"계산값","reason":"근거 1문장"},
      "growth":    {"grade":"A/B/C","value":"계산값","reason":"근거 1문장"},
      "stability": {"grade":"A/B/C","value":"계산값","reason":"근거 1문장"},
      "profitability":{"grade":"A/B/C","value":"계산값","reason":"근거 1문장"}
    },
    "overall": "4자리등급(예:AABC)",
    "group": "리스크관리 또는 성장지원 또는 스케일업 또는 안정성장",
    "summary": "종합 코멘트 3~4문장"
  },
  "triggers": [
    {"type":"warn 또는 caution 또는 ok","title":"트리거명","desc":"설명"}
  ],
  "matched_programs": [
    {"rank":1,"name":"프로그램명","priority":"P1","reason":"매칭 근거"}
  ],
  "growth_partner_fields": ["추천분야1","추천분야2","추천분야3"],
  "company_industries": ["관련산업1","관련산업2"],
  "biz_context": {
    "current_status": ["현황1","현황2"],
    "risks": ["리스크1","리스크2"],
    "targets": ["타겟1","타겟2"]
  },
  "action_items": ["즉시액션1","액션2","액션3"]
}`;

module.exports = { VALUEUP_PROGRAMS, GP_FIELDS, SYSTEM_PROMPT, OUTPUT_FORMAT };
