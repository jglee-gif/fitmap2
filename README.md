# GMS 3.0 — 포트폴리오 진단 시스템

## 배포 방법

### 1. Vercel 환경변수 설정
Vercel → Settings → Environment Variables
- `ANTHROPIC_API_KEY` = `sk-ant-...`

### 2. GitHub에 업로드
이 폴더의 모든 파일을 GitHub 레포에 업로드 후 Vercel 연결

## 파일 구조
```
/
├── index.html          ← 업로드 페이지 (루트에 배치 = 자동 서빙)
├── report.html         ← 진단 리포트
├── api/
│   ├── analyze.js      ← 메인 분석 (파싱+계산+AI코멘트)
│   ├── health.js       ← 서버 상태
│   └── gov-programs.js ← 정부지원사업
├── lib/
│   ├── parser.js       ← 재무제표 정규식 파싱
│   ├── calculator.js   ← MPES 공식 계산
│   ├── mentors.js      ← 멘토 매칭
│   └── prompts.js      ← AI 프롬프트
└── data/
    └── mentors.csv     ← 그로스파트너스 177명
```
