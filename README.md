# 직업상담 질문지 생성기 — 관리자 승인 로그인

로그인·가입 신청·관리자 승인/거절/정지·비밀번호 변경 및 재설정을 구현했습니다. 질문 생성 API가 실패하면 **호출 실패만 표시하며 기본 질문을 만들지 않습니다.**

## 현재 상태

- 로컬 구현 및 자동 테스트 완료. 원본 HTML/JS는 보호된 private 폴더로 이동했습니다.
- 운영 DB가 아직 없으므로 실제 사이트에 적용하려면 PostgreSQL 생성, 환경변수 설정, DB 초기화, 관리자 생성 및 Vercel 재배포가 필요합니다.
- 이 작업에서는 운영 서비스에 배포하거나 외부 DB를 생성하지 않았습니다.
- 실제 Gemini 성공 호출은 운영 키가 없어 수행하지 않았으며, 성공/실패 응답은 테스트에서 모의 검증했습니다.

## 1. PostgreSQL 준비

관리형 PostgreSQL DB를 준비하고 제공받은 TLS 연결 문자열을 DATABASE_URL에 설정합니다. 서버리스 연결에는 제공업체의 pooled 연결 문자열을 사용하세요. 인증서 검증이 가능한 sslmode=verify-full을 사용하고 검증을 끄지 마세요. DB와 서비스는 가능하면 가까운 리전에 둡니다.

DB 공급자는 지정하지 않았습니다. 기존 Vercel 계정에서 연결 가능한 서비스를 선택하면 됩니다. 이용 요금은 해당 서비스에서 확인하세요.

## 2. 로컬 환경변수

Node.js 22 이상에서 프로젝트 폴더를 열고 실행합니다.

```powershell
npm install
Copy-Item .env.example .env.local
```

.env.local에 다음 값을 설정합니다. 비밀값을 Git이나 채팅에 붙여넣지 마세요.

| 변수 | 값 |
|---|---|
| APP_ORIGIN | 로컬 http://localhost:3000, 운영 https://실제도메인 (끝 / 없음) |
| DATABASE_URL | PostgreSQL TLS 연결 문자열 |
| ID_ENCRYPTION_KEY | 랜덤 32바이트를 base64로 표현한 암호화키 |
| ID_LOOKUP_KEY | 위 키와 다른 랜덤 32바이트 base64 조회 키 |
| GEMINI_API_KEY | 기존 Gemini API 키 |
| NODE_ENV | 운영은 production |

키는 다음 명령을 **두 번** 실행해 서로 다른 값으로 만듭니다. 출력은 본인의 비밀 저장소에 보관하세요.

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

## 3. DB 초기화 및 최초 관리자

```powershell
npm run db:migrate
npm run admin:create
npm start
```

admin:create는 터미널에서 아이디·이름·비밀번호를 묻습니다. 비밀번호 입력은 숨김 처리합니다. 이미 존재하는 아이디를 임의로 관리자 승격하지 않습니다. localhost:3000을 열어 로그인할 수 있습니다.

아이디는 영문·숫자·점·밑줄·하이픈 4~40자, 앞뒤 공백 제거 및 소문자 정규화를 적용합니다. 비밀번호는 15~128자입니다.

## 4. Vercel 적용

1. 변경된 프로젝트 전체를 기존 Vercel 배포 소스에 반영합니다. 예전 index.html과 script.js는 루트에 남기지 않습니다.
2. 프로젝트 Root Directory는 package.json과 vercel.json이 있는 폴더로 지정합니다.
3. Framework는 Other, Output Directory는 public입니다. 저장된 vercel.json을 사용하며 기존 대시보드의 충돌하는 빌드/출력 설정은 제거합니다. Node.js 22.x를 선택합니다.
4. Vercel 환경변수에 위 값들을 설정합니다. APP_ORIGIN은 실제 사용 도메인 하나와 정확히 일치해야 합니다. 다른 별칭은 대표 도메인으로 리디렉션하거나 별도 환경으로 분리합니다.
5. 로컬에서 운영 DB를 대상으로 마이그레이션 및 최초 관리자 생성을 완료한 뒤 재배포합니다. 운영 DB 자격증명은 .env.local 등 비밀 환경에서만 사용합니다.
6. 배포 후 비로그인 /app, /admin, /script.js, /api/generate 직접 접근이 차단되는지 확인합니다. 로그인 → 가입 승인 → 사용자 로그인 → 질문 생성 → 로그아웃 순서도 실제 도메인에서 확인합니다.

정적 호스팅만으로는 동작하지 않습니다. api/index.js 서버 함수가 필요합니다. public에는 스타일과 공개 로그인 스크립트만 있고 상담·관리자 HTML/JS는 서버 권한 검사 후 제공합니다. 함수에 private/server/public 파일이 포함되도록 설정했습니다.

설정 참고: [Vercel 함수 설정](https://vercel.com/docs/project-configuration/vercel-json#functions), [Vercel rewrite](https://vercel.com/docs/routing/rewrites).

## 5. 이용 흐름

- 사용자가 /register에서 가입 신청합니다. 신청은 항상 일반 사용자·승인 대기로 저장됩니다.
- 관리자가 /admin에서 이름과 아이디를 확인하고 승인합니다. 승인 후 사용자가 로그인합니다.
- 거절 또는 정지 시 이용할 수 없으며 정지 이전 세션도 폐기합니다. 마지막 승인 관리자는 거절/정지할 수 없습니다.
- 비밀번호 분실 시 본인 확인 후 관리자가 일회용 링크를 발급해 별도로 전달합니다. 링크는 30분 동안 한 번만 유효합니다. 링크 자체가 권한이므로 전달 대상을 확인하세요.
- 비밀번호 변경/재설정은 기존 세션을 모두 해제합니다. 관리자 복구는 서버 터미널에서 npm run admin:reset을 실행합니다.
- 자동 이메일/문자 알림은 포함하지 않습니다.

## 6. 보호 방식

- 아이디: AES-256-GCM 암호화, 매번 새 nonce, v1 포맷. 조회·중복 검사용으로 별도 키를 사용하는 HMAC-SHA-256만 저장.
- 비밀번호: Argon2id (19 MiB, 2회, 병렬도 1)와 개별 salt. 관리자도 원문 조회 불가.
- 세션: 랜덤 256비트 토큰. DB에는 SHA-256 해시만 저장. 운영 쿠키는 __Host-session / Secure / HttpOnly / SameSite=Strict.
- 미사용 30분 또는 절대 8시간 만료. 모든 보호 요청에서 DB의 현재 상태 확인.
- 상태 변경 요청의 Origin과 CSRF 토큰 검사, 로그인/가입/질문 생성 횟수 제한. DB 장애 시 접근 차단.
- 사용자 입력·AI 응답은 textContent로 출력. 질문 생성 오류는 기본 질문으로 대체하지 않음.
- 보호 응답은 no-store, 외부 프레임 삽입 금지. AI 키는 서버 요청 헤더에만 사용.
- 상담 내역은 DB에 저장하지 않음. 질문 생성을 위해 입력한 상담 정보는 기존과 같이 Gemini로 전송됨.

## 7. 운영·키 교체

DB와 암호화키를 각각 안전하게 백업합니다. 키가 없으면 아이디를 복호화할 수 없습니다. DB의 이름은 운영 조회용 평문이며 아이디와 비밀번호가 보호 대상입니다.

만료된 세션·재설정 토큰·요청 제한 레코드는 정기적으로 아래 명령으로 정리합니다.

```powershell
node --env-file-if-exists=.env.local scripts/manage.js cleanup
```

키 교체는 점검 시간에 수행합니다. 트래픽과 기존 실행 인스턴스를 중단하고 DB와 기존 키를 함께 백업합니다. .env.local에는 기존 키를 유지한 채 NEW_ID_ENCRYPTION_KEY와 NEW_ID_LOOKUP_KEY를 새 랜덤 값으로 추가합니다.

```powershell
node --env-file-if-exists=.env.local scripts/rotate-keys.js
```

명령은 한 트랜잭션에서 전체 아이디 재암호화·조회 키 갱신·세션 폐기를 수행합니다. 성공하면 로컬 및 Vercel의 ID_ENCRYPTION_KEY/ID_LOOKUP_KEY를 새 값으로 교체하고 재배포한 후 서비스를 재개합니다. 교체 실패 시 트랜잭션은 롤백됩니다. 성공 후 배포 설정 실패 시에는 새 키 적용을 완료하거나 DB와 키를 같은 시점의 백업으로 함께 복원해야 합니다. 무중단 다중 키 교체는 지원하지 않습니다.

## 8. 검증

```powershell
npm test
npm audit --omit=dev
```

자동 테스트는 메모리에서 실행되는 PostgreSQL 엔진(PGlite)을 사용하며 운영 DB에 접속하지 않습니다. 인증 우회, 승인 상태, 암호화, 역할 변조, CSRF, 질문 API 오류, 정지 세션, 마지막 관리자, 비밀번호 재설정, 만료/로그아웃, 요청 제한, DB 장애를 검증합니다.

실제 관리형 PostgreSQL 연결·Vercel 배포·Gemini 실호출은 환경변수와 운영 DB 설정 후 추가 확인해야 합니다. 개발용 미리보기 계정은 운영 DB나 배포 파일에 포함되지 않습니다.

