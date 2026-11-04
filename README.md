# AgentView

BAZE API Gateway 모델로 도는 에이전트와 팀이 각자의 Docker 샌드박스에서 일하는 모습을 3D 오피스로 보여주는 프로젝트. 실행 과정은 AG-UI 이벤트로 기록·전송되고, 외부 도구는 MCP 서버로 붙인다. 설계 문서는 저장소 밖(`docs/`, Git 제외)에 따로 보관한다.

## 구조

```
.env            BAZE 키 (Git 제외, .env.example 참고)
app/
  server/       Fastify 서버: 실행기(에이전트·팀), 도구, MCP, 샌드박스, AG-UI SSE
  web/          React + React Three Fiber: 3D 오피스, 상세 패널, 채팅, 관리 화면
  sandbox/      샌드박스 기본 이미지 Dockerfile (예제 MCP 서버 포함)
  data.example/ 예시 설정 (복사해서 app/data/로 사용, data/는 Git 제외)
```

## 준비

- Node 22.18 이상, Docker Desktop
- `cd app && npm install`
- `docker build -t agentview/sandbox:base app/sandbox`
- `cp -r app/data.example app/data` 후 필요하면 `app/data/models.json`의 `defaultModel` 수정 (기본 `gpt-6-luna`)
- `cp .env.example .env` 후 `BAZE_API_KEY` 입력 (BAZE > API Gateway에서 발급)
- 대화 저장용 PostgreSQL: `cd app && npm run db` (Docker 컨테이너 `agentview-db`, 127.0.0.1:5433). 공유 서버에서는 `.env`에 `DATABASE_URL`을 넣는다. DB가 없어도 실행은 되지만 대화가 저장되지 않는다.
- 가구 모델(선택): [Kenney Furniture Kit](https://kenney.nl/assets/furniture-kit)(CC0) zip을 `app/web/public/models/furniture/`에 풀기 (`kenney_furniture-kit/Models/GLTF format/*.glb`가 되도록). 없으면 가구가 단순한 상자로 그려진다. 이 폴더는 Git 제외.

## 실행 (`app/` 폴더에서)

```bash
npm start -w server      # http://127.0.0.1:8787  (개발 중에는 npm run dev -w server: 파일이 바뀌면 재시작)
npm run dev -w web       # http://localhost:5173
```

화면은 하나다 (`http://localhost:5173`). 오피스가 화면 전체를 차지하고, 그 위에 세 가지가 뜬다.

| 위치 | 내용 |
|---|---|
| 왼쪽 위 목록 | 에이전트와 팀, 상태 색. 누르면 그 대상의 채팅이 열린다 |
| 오른쪽 위 ⚙ 설정 | 에이전트·팀·MCP 관리 창 |
| 오른쪽 아래 채팅 | 대상별 세션 목록, 대화(작업 내역 포함), 메시지마다 모델 선택, 작업 폴더 보기 |

- 오피스에서 캐릭터를 누르면 그 에이전트, 팀 방 이름표를 누르면 그 팀과 대화한다.
- 세션은 대화 하나다. 지난 세션을 고르면 그 대화가 그대로 이어진다. 새 대화는 `+ 새 대화`.
- 캐릭터 발밑 원과 이름표 점의 색이 상태다(회색 대기, 파랑 생각 중, 주황 작업 중, 보라 읽는 중, 노랑 대기열, 초록 완료, 빨강 오류). 일하는 동안 머리 위 말풍선에 모델이 쓰는 문장이나 지금 하는 행동이 뜬다.
- 실행 다시 보기: `/?run=<runId>`

### 팀

| 구조 | 동작 |
|---|---|
| 메인-하위 (`supervisor`) | 메인이 `delegate` 도구로 구성원에게 일을 맡기고 결과를 받아 정리 |
| 병렬 분담 (`parallel`) | 구성원이 같은 요청을 각자 역할로 동시에 처리, 메인이 합침 |
| 토론 (`debate`) | 구성원이 라운드마다 차례로 발언(회의실에 모임), 메인이 결론 |

- 팀을 저장하면 서버가 빈 방(1~4)을 배정한다. 구성원 자리에 `team:<id>`를 넣어 팀을 중첩할 수 있다(순환은 거부).
- 팀원은 샌드박스에서 `/team/<teamId>` 공유 폴더를 함께 쓴다 (호스트: `app/data/teamspaces/<teamId>/`).
- 팀 한도: 모델 호출 수, 중첩 깊이, 시간, 토론 라운드. 넘으면 실행이 `RUN_ERROR`(code `limit`)로 멈춘다.

### MCP

- 관리 > MCP에서 추가(명령·URL·`mcpServers` JSON 붙여넣기)하면 바로 연결되고 도구 목록을 가져온다. 서버 재시작은 필요 없다. 설정은 `app/data/mcp.json`.
- 명령(stdio) 서버는 서버마다 샌드박스 이미지로 만든 별도 컨테이너(`agentview-mcp-<이름>`)에서 돈다. 인터넷은 기본 차단, 필요하면 켠다.
- 도구 이름은 `mcp__<서버>__<도구>`. 에이전트 편집에서 허용한 도구만 그 에이전트가 쓸 수 있다.
- 예제: 샌드박스 이미지에 `@modelcontextprotocol/server-everything` 2.0.0이 들어 있다 (`"command": "mcp-server-everything", "args": ["stdio"]`).

### API로 일 시키기 (AG-UI)

```bash
curl -N -X POST http://127.0.0.1:8787/agui -H 'content-type: application/json' \
  -d '{"threadId":"t1","runId":"demo1","messages":[{"id":"m1","role":"user","content":"Create hello.py that prints hello, run it, and tell me the output."}],"tools":[],"context":[],"forwardedProps":{"target":"agent:nova"}}'
```

- 대상은 `agent:<id>` 또는 `team:<id>`
- 취소: `curl -X POST http://127.0.0.1:8787/runs/<runId>/cancel`
- 작업 파일: `app/data/workspaces/<agentId>/`, 실행 기록: `app/data/runs/<runId>.jsonl`

## 토큰 한도 (기본값)

모델 답변 1024토큰, 모델에 돌려주는 도구 출력 4,000자, 실행당 모델 호출 20회(팀은 팀 설정, 기본 50회), 에이전트 6단계. 자동 테스트는 가짜 모델만 쓴다.

## 테스트 (`app/` 폴더에서)

```bash
npm test
npm run typecheck
```

Docker가 꺼져 있으면 컨테이너 테스트는 건너뛴다.

## 지금 되는 것 / 아직 안 되는 것

- 됨: 에이전트·팀(메인-하위·병렬·토론, 중첩, 한도) 실행, 에이전트별 샌드박스와 팀 공유 폴더, MCP 서버 런타임 추가, AG-UI 스트림·기록·재생·취소, 3D 오피스(방 배정, 위임 연결선, 토론 회의실), 상세 패널, 채팅, 관리 화면
- 아직: DGX 연결, 준화 앱 연결, Blender 캐릭터, 모델 연결 편집·검사 화면, 작업 폴더 초기화

## 서드파티

- 가구 모델: Kenney Furniture Kit (CC0, 저장소에 포함하지 않음)
