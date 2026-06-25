# Fit Map — 포트폴리오 진단 시스템

포트폴리오사 결산 자료를 업로드하면 AI가 자동으로 진단합니다.

## 기능

1. **재무 경향성 분석** — 현금잔고 추이, 런웨이 예측 (3분기), 경고선/주의선
2. **MPES 진단** — 유동성·성장성·안정성·수익성 4개 지표 + 경향성
3. **밸류업 프로그램** — 그로스파트너스 멘토 매칭 + 우선순위 프로그램 추천
4. **사업개발 연계** — 그로스브릿지 OI + 정부지원사업 연계

---

## 배포 (GitHub + Vercel)

### 1단계 — GitHub 레포 생성

```bash
git init
git add .
git commit -m "feat: Fit Map 초기 배포"
git remote add origin https://github.com/YOUR_USERNAME/fitmap.git
git push -u origin main
```

### 2단계 — Vercel 배포

1. [vercel.com](https://vercel.com) 로그인 → **New Project**
2. GitHub 레포 선택 (`fitmap`)
3. **Environment Variables** 추가:
   - Key: `ANTHROPIC_API_KEY`
   - Value: `sk-ant-...` (Anthropic Console에서 발급)
4. **Deploy** 클릭

### 3단계 — Anthropic API 키 발급

1. [console.anthropic.com](https://console.anthropic.com) 접속
2. **API Keys** → **Create Key**
3. 발급된 키를 Vercel 환경변수에 입력

---

## 로컬 실행

```bash
npm install -g vercel
npm install
cp .env.example .env.local  # API 키 입력
vercel dev
```

---

## 파일 구조

```
fitmap/
├── api/
│   ├── analyze.js     # 메인 분석 엔드포인트
│   └── health.js      # 서버 상태 확인
├── lib/
│   ├── mentors.js     # 멘토 매칭 로직
│   └── prompts.js     # AI 프롬프트 및 상수
├── public/
│   ├── index.html     # 업로드 페이지
│   └── report.html    # 4탭 진단 리포트
├── data/
│   └── mentors.csv    # 그로스파트너스 177명
├── package.json
├── vercel.json
└── README.md
```

---

## 업로드 파일 형식

| 파일 | 형식 | 내용 |
|------|------|------|
| 재무상태표 | PDF | 현금, 자본, 부채 등 |
| 손익계산서 | PDF | 매출, 판관비, 영업손익 등 |
| 성과 및 계획 | Excel (.xlsx) | 월별 현금흐름, 분기 실적/계획 |
