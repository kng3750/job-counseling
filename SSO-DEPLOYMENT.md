# Job Counseling · Job Star 통합 로그인 적용 안내

운영 배포: 2026-09-20. 중앙 DB SSO 등록 및 두 Vercel 프로젝트 배포 완료. 기존 회원 2명과 암호화키를 유지했습니다. 비로그인 접근 차단·중앙 클라이언트 인증·중앙 로그인 화면 이동을 운영에서 확인했습니다. 실제 사용자 로그인 이후 흐름은 사용자 확인 대기입니다. 아래 운영 적용 순서는 이후 재설치·변경 시 참고용입니다.

## 관리 방식
- 회원가입·아이디·비밀번호·관리자 승인·비밀번호 재설정은 Job Counseling에서 관리합니다.
- 아이디는 AES-256-GCM 암호화, 검색값은 별도 키로 HMAC 처리합니다. 비밀번호는 복호화할 수 없는 Argon2id 해시로 저장합니다.
- 승인된 계정은 두 서비스를 이용합니다. Job Star 접속 시 중앙 로그인 후 원래 화면으로 돌아옵니다.
- 세션과 클라이언트 인증값은 중앙 DB에 해시로 저장합니다. Job Star에는 중앙 DB 접속 정보와 아이디 암호화키를 복사하지 않습니다.
- Job Star는 서버 간 인증용 AUTH_CLIENT_SECRET만 보유합니다. 이것은 회원 암호화키와 다른 별도 비밀값입니다.
- 통합 로그아웃은 현재 중앙 로그인에 연결된 두 서비스 세션을 종료합니다. 다른 기기의 독립 로그인까지 종료하는 기능은 아닙니다. 계정 정지·비밀번호 재설정은 해당 사용자의 모든 세션을 폐기합니다.
- 유휴 30분, 절대 8시간 만료를 두 서비스가 공유합니다. 중앙 인증 실패 시 접근을 차단합니다.
- AI 호출 실패 시 이전 결과를 지우고 호출 실패를 표시합니다. 기본 질문지나 가짜 결과를 생성하지 않습니다.
- JOB-starDB는 유지하며 이번 인증에는 사용하지 않습니다.

## 운영 적용 순서
1. 두 소스를 각각 기존 Vercel 프로젝트와 연결했는지 확인합니다. 운영 도메인은 아래 주소 변수에 https://부터 입력하고 마지막 /는 붙이지 않습니다.
2. 기존 중앙 DATABASE_URL, ID_ENCRYPTION_KEY, ID_LOOKUP_KEY를 유지합니다. 기존 회원이 있으면 암호화키를 새로 만들거나 덮어쓰지 않습니다. 암호화키가 없는 신규 설치만 서로 다른 32바이트 난수를 Base64로 생성합니다.
3. 중앙 프로젝트에서 의존성 설치 후 npm run db:migrate를 실행합니다. 기존 테이블을 삭제하지 않고 SSO 테이블을 추가합니다. 운영 DB는 적용 전에 백업합니다.
4. 별도 서버 인증 비밀값(32바이트 이상의 난수, Base64url 43자 이상)을 생성합니다. 중앙 등록 작업의 SSO_CLIENT_SECRET과 Job Star의 AUTH_CLIENT_SECRET에는 동일한 값을 안전하게 입력합니다.
5. 중앙에서 SSO_CLIENT_ID=job-star, SSO_REDIRECT_URI=Job Star 운영 주소/auth/callback을 설정하고 npm run sso:register를 실행합니다. 이 작업은 클라이언트를 등록하며 재실행하면 기존 Job Star 세션이 종료됩니다. 중앙 DB에는 비밀값 원문 대신 해시를 저장합니다.
6. 중앙을 먼저 배포하고 Job Star를 배포합니다. Vercel 환경변수 수정 후에는 재배포해야 반영됩니다. 중앙 SSO_CLIENT_SECRET은 등록 작업에만 필요하며 상시 런타임에는 필요하지 않습니다.
7. 기존 관리자를 사용합니다. 신규 설치로 관리자가 전혀 없는 경우에만 중앙에서 npm run admin:create를 실행하여 관리자를 만듭니다.
8. 실제 도메인에서 가입 신청 → 중앙 관리자 승인 → 두 서비스 접속 → 통합 로그아웃 → 정지 계정 차단을 확인합니다. AI 생성도 실제 API 키로 확인합니다.

## 환경변수
| 위치 | 이름 | 용도 |
|---|---|---|
| 중앙 | APP_ORIGIN | 중앙의 고정 운영 주소 |
| 중앙 | DATABASE_URL | 기존 중앙 PostgreSQL |
| 중앙 | ID_ENCRYPTION_KEY / ID_LOOKUP_KEY | 기존 중앙 암호화·검색 키 유지 |
| 중앙 | GEMINI_API_KEY / GEMINI_MODEL | 중앙 질문 생성 |
| 등록 작업 | SSO_CLIENT_ID / SSO_REDIRECT_URI / SSO_CLIENT_SECRET | Job Star 서버 등록 |
| Job Star | APP_ORIGIN | Job Star 고정 운영 주소 |
| Job Star | AUTH_SERVER_ORIGIN | 중앙 고정 운영 주소 |
| Job Star | AUTH_CLIENT_ID | job-star |
| Job Star | AUTH_CLIENT_SECRET | 등록 작업과 같은 서버 인증 비밀값 |
| Job Star | AUTH_REDIRECT_URI | Job Star 운영 주소/auth/callback |
| Job Star | GEMINI_API_KEY / GEMINI_MODEL | Job Star 문서 생성 |

Preview는 별도 테스트 중앙 DB·클라이언트·고정 콜백 주소를 사용합니다. 임의 주소와 와일드카드 콜백은 허용하지 않습니다. .env.local과 실제 비밀값은 Git이나 압축파일에 포함하지 않습니다.

## 검증
중앙 자동 테스트 8개, 두 서비스 통합 테스트 12개를 통과했습니다. 시험용 메모리 PostgreSQL과 모의 생성기를 사용했으며 운영 DB·실제 Gemini 호출 결과를 검증한 것은 아닙니다. 브라우저에서 중앙 로그인 후 Job Star 복귀, 시험 결과의 안전한 문자 표시, Job Star 로그아웃 후 중앙 접근 차단을 확인했습니다.

Job Star에서 npm test를 실행할 때 CENTRAL_PROJECT_PATH를 중앙 소스의 절대 경로로 설정합니다. 기본값은 다운로드 폴더의 원래 두 프로젝트 배치입니다. 압축을 다른 곳에 풀면 이 값을 지정합니다. npm run check:config는 설정 형식만 검사하며 실제 접속 여부를 판정하지 않습니다.

## 배포 범위와 복구
두 프로젝트의 server, private, public, api, scripts 및 package 파일·잠금파일·vercel.json을 함께 적용합니다. Job Star의 예전 public/index.html, public/script.js, public/prompts.js, api/generate.js, api/health.js, api/_gemini.js는 제거된 구조를 유지합니다. 예전 공개 화면 파일을 다시 올리면 접근 보호를 우회할 수 있습니다.
문제가 생기면 접근 보호가 있는 이전 배포로 복구합니다. 공개 접근이 가능했던 예전 Job Star 배포로 되돌리지 않습니다. 추가된 중앙 SSO 테이블은 기존 계정·세션 테이블과 함께 백업하며, 이번 변경에서 기존 회원 정보는 삭제하지 않습니다.
