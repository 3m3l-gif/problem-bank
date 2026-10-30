# 📐 수학 문제 저장소

과외 준비용 수학 문제 은행입니다. PDF·사진으로 된 문제지와 답지에서 문제를 잘라 저장하면 **글자와 수식을 인식해 텍스트로** 보관하고, 학년·단원별로 골라 **한글(HWPX) 또는 PDF** 시험지로 만듭니다.

- 주소: https://3m3l-gif.github.io/problem-bank/
- 저장: 내 Google 드라이브 › **문제 저장소** 폴더 (`bank.json` + `원본/` + `이미지/`)
- 서버 없음. 브라우저에서 Google 드라이브, Claude API 와 직접 통신합니다.

## 쓰는 순서
1. **⚙ 설정**에서 Claude API 키 입력 ([Anthropic 콘솔](https://console.anthropic.com/settings/keys)에서 발급, 결제 수단 필요). 키는 그 브라우저에만 저장됩니다.
2. **① 문제 입력**: PDF·사진 업로드 → 학년(중1~고3) · 과목(고등만) · 단원 선택 → 페이지에서 드래그
   - 🟦 **문제** 영역: 문제 전체 (여러 개 그리면 위아래로 이어 붙임)
   - 🟧 **그림** 영역: 그래프·도형·표 → 이미지로 따로 저장되어 본문의 `[그림1]` 자리에 들어감
   - 🟩 **해설** 영역: 정답과 해설 (답지가 따로면 해설만 그려서 기존 문제에 연결)
   - 저장하면 Claude 가 본문·선택지·정답·해설을 **텍스트 + LaTeX 수식**으로 옮깁니다 (백그라운드, 몇 초).
   - 단축키: `Ctrl+Enter` 저장, `←/→` 페이지, `Q` 문제 · `E` 그림 · `W` 해설, `Z` 마지막 영역 취소
3. **② 문제 은행**: 학년·과목·단원·유형·형식·출처·태그·난이도로 거르기, 무작위 N문제 뽑기.
   **검수 필요** 필터로 인식 결과를 원본과 나란히 보며 고치고 "검수 완료"를 누릅니다.
4. **③ 시험지**: 순서 조정 → **📄 한글 파일(.hwpx)** 또는 **🖨 PDF**
   - 한글 파일: 수식은 **한글 수식 개체**(더블클릭으로 편집 가능), 그림은 문서에 포함. 1단/2단, 풀이 공간, 정답·해설 페이지.
   - 글자 인식이 안 된 문제는 원본 이미지로 들어갑니다.
5. **④ 분류 관리**: 중1~중3 학년별 단원, 고등 과목별 단원을 추가·삭제·순서 변경·이름 변경. 과목 추가·삭제도 가능합니다.
   (기본 과목: 공통수학 · 대수 · 미적분 · 확률과 통계 · 기하)

## 배포 / 설정
- GitHub Pages: Settings → Pages → `main` / `(root)`
- Google OAuth 클라이언트 ID: `config.js` (승인된 JavaScript 원본: `https://3m3l-gif.github.io`)
- 권한은 `drive.file` 하나만 사용 (이 앱이 만든 파일만 접근)

## 로컬 실행
```
python -m http.server 8000
```
→ http://localhost:8000 (드라이브 없이 브라우저에만 저장하는 테스트 모드: `?local`)

## 구조
```
index.html, style.css, config.js
js/app.js        화면 · 자르기 · 인식 대기열 · 필터 · 시험지 · 분류 관리
js/store.js      Google 드라이브 저장소 (+ 테스트용 브라우저 저장소)
js/ocr.js        Claude 로 문제·해설 이미지 → 텍스트/LaTeX
js/hwpx.js       한글(HWPX) 시험지 만들기
js/eqedit.js     LaTeX → 한글 수식 스크립트 변환
js/eqmeasure.js  한글 수식 상자 크기 계산
js/math.js       기본 학년·과목·단원
vendor/          pdf.js 4.10.38 (Apache-2.0), KaTeX 0.16.11 (MIT), JSZip 3.10.1 (MIT),
                 Anthropic TypeScript SDK 1.3.0 (MIT), python-hwpx 6.10.0 의 Skeleton.hwpx (Apache-2.0)
```
`js/eqedit.js`, `js/eqmeasure.js`, `js/hwpx.js` 의 수식 변환·크기 계산·문서 구조는
[python-hwpx](https://github.com/airmang/python-hwpx) (Apache-2.0) 를 자바스크립트로 옮긴 것입니다 (`vendor/hwpx/LICENSE`, `NOTICE`).
