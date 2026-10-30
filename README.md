# 📐 수학 문제 저장소

PDF·사진으로 된 문제지와 답지에서 문제를 **잘라** 단원·유형별로 저장하고, 골라서 **시험지(정답·해설 포함)**를 만드는 웹 앱입니다.

- 설치 없이 브라우저에서 실행 (PC·태블릿·휴대폰)
- 데이터는 **내 Google 드라이브 › 문제 저장소** 폴더에 저장 (`bank.json` + `원본/` + `이미지/`)
- 서버 없음: GitHub Pages 같은 정적 호스팅에 그대로 올리면 끝

## 기능
- **입력**: PDF·사진 업로드(카메라 촬영 가능) → 드래그로 문제/해설 영역 지정 → 저장
  - 단·페이지가 넘어가는 문제는 영역 여러 개를 그리면 위아래로 이어 붙임
  - 답지를 따로 올린 경우, 해설 영역만 그려서 기존 문제에 연결 (다음 문제 자동 선택)
  - 2022·2015 개정 과목/단원 프리셋, 객관식 ①~⑤ 버튼, 난이도 ★1~5, 태그
  - 해설 메모에 LaTeX 수식 `$f'(x)=3x^2$` 사용 가능 (KaTeX)
  - 단축키: `Ctrl+Enter` 저장, `←/→` 페이지, `Q`/`W` 문제/해설 모드, `Z` 마지막 영역 취소
- **문제 은행**: 과목·단원·유형·형식·출처·태그·난이도·검색어로 필터, 무작위 N문제 뽑기, 정답·해설 누락 문제 찾기
- **시험지**: 순서 조정·섞기, 1/2단, 풀이 공간, 문제지 / 정답·해설 / 둘 다 출력 → 인쇄 또는 PDF 저장

## 배포 (GitHub Pages)
1. 이 저장소 **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`** → Save
2. 1~2분 뒤 `https://<GitHub아이디>.github.io/<저장소이름>/` 에서 열림

## Google 드라이브 연결 (한 번만)
1. [Google Cloud 콘솔](https://console.cloud.google.com/projectcreate)에서 새 프로젝트 만들기
2. [Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com) → **사용**
3. [Google 인증 플랫폼](https://console.cloud.google.com/auth/overview) → 시작하기 (앱 이름, 이메일, 대상: **외부**)
4. **대상** → **테스트 사용자**에 본인 Gmail 추가
5. **클라이언트** → 만들기 → **웹 애플리케이션** → 승인된 JavaScript 원본에 `https://<GitHub아이디>.github.io` 추가
   (로컬 테스트용으로 `http://localhost:8000` 도 추가 가능)
6. 발급된 클라이언트 ID를 `config.js` 의 `GOOGLE_CLIENT_ID` 에 넣고 커밋 (또는 첫 화면에서 입력)

권한은 `drive.file` 하나만 사용합니다. 이 앱이 만든 파일만 볼 수 있고, 드라이브의 다른 파일에는 접근하지 못합니다.

## 로컬 실행
```
python -m http.server 8000
```
→ http://localhost:8000 (드라이브 없이 이 브라우저에만 저장하는 테스트 모드: http://localhost:8000/?local)

## 구조
```
index.html, style.css, config.js
js/app.js     화면·자르기·필터·시험지
js/store.js   Google Drive 저장소 (+ 테스트용 브라우저 저장소)
js/math.js    과목·단원 프리셋
vendor/       pdf.js 4.10.38, KaTeX 0.16.11 (각 라이선스 포함, PDF 글꼴 데이터는 jsDelivr CDN)
```
