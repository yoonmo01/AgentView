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
- 대화 저장용 PostgreSQL: `cd app && npm run db` (Docker 컨테이너 `agentview-db`, 127.0.0.1:5433). 처음 한 번만 실행하면 되고, 이후에는 Docker Desktop이 켜질 때 같이 켜진다. 공유 서버에서는 `.env`에 `DATABASE_URL`을 넣는다. DB가 없어도 실행은 되지만 대화가 저장되지 않는다.
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
| 오른쪽 아래 채팅 | 대상별 세션 목록, 대화(작업 내역과 토큰 사용량 포함), 메시지마다 모델 선택, 작업 폴더 보기 |

- 오피스에서 캐릭터를 누르면 그 에이전트, 팀 방 이름표를 누르면 그 팀과 대화한다.
- 세션은 대화 하나다. 지난 세션을 고르면 그 대화가 그대로 이어진다. 새 대화는 `+ 새 대화`.
- 이름표 위의 상태 칩: 초록 대기 중, 주황 작업 중, 노랑 대기열, 파랑 완료, 빨강 오류. 일하는 동안 머리 위 말풍선에 모델이 쓰는 문장이나 지금 하는 행동이 뜬다.
- 혼자 일할 때는 로비의 공용 책상(8개)에 순서대로 앉고, 책상이 모자라면 서서 기다린다. 팀으로 일할 때는 그 팀 방의 자기 자리에 앉는다. 자리까지는 2초 안에 걸어간다.
- 답변 아래에 그 실행의 토큰 사용량(입력·출력)이 나온다. 팀 실행은 눌러서 에이전트별로 볼 수 있다.
- 실행 다시 보기: `/?run=<runId>`

### 팀

| 구조 | 동작 | 방 |
|---|---|---|
| 메인-하위 (`supervisor`) | 메인이 `delegate` 도구로 구성원에게 일을 맡기고 결과를 받아 정리 | 메인 책상이 뒤에서 구성원 줄(3명씩)을 바라봄 |
| 병렬 분담 (`parallel`) | 구성원이 같은 요청을 각자 역할로 동시에 처리, 메인이 합침 | 구성원이 나란히(4명씩), 메인 책상이 앞에서 마주봄 |
| 토론 (`debate`) | 구성원이 라운드마다 차례로 발언, 메인(사회자)이 결론 | 둥근 탁자, 사회자가 상석, 구성원은 발언 순서대로 시계방향 |

- 팀을 저장하면 방 번호와 색이 정해진다. 방은 구성원 수만큼 커지고, 오피스는 팀이 늘수록 옆으로 넓어진다.
- 팀 설정의 "팀에서의 역할과 지시"는 그 팀으로 일할 때만 쓰인다. 비워 두면 에이전트 설정의 역할과 지시문을 쓴다.
- 구성원 순서(↑↓)는 토론 팀에만 있다(발언 순서).
- 팀 안에 팀(구성원 자리에 `team:<id>`)은 서버에서 지원하지만 화면에서는 아직 숨겨 두었다.
- 팀원은 샌드박스에서 `/team/<teamId>` 공유 폴더를 함께 쓴다 (Docker 볼륨 `agentview-team-<teamId>`).
- 팀 한도: 모델 호출 수, 중첩 깊이, 시간, 토론 라운드. 넘으면 실행이 `RUN_ERROR`(code `limit`)로 멈춘다.

### 샌드박스와 작업 폴더

- 에이전트마다 컨테이너 하나(`agentview-<id>`)가 있다. 명령 실행이나 파일 작업을 처음 할 때 만들어지고, 30분 동안 쓰지 않으면 멈춘다. 서버를 다시 켜면 남아 있던 샌드박스를 멈춘다.
- 작업 파일은 PC 폴더가 아니라 Docker 볼륨(`agentview-ws-<id>`)에 있다. 채팅의 "작업 폴더" 탭에서 폴더 구조와 내용을 보고, 파일 하나나 폴더 전체(.zip)를 내려받는다.
- 예전 `app/data/workspaces/<id>`, `app/data/teamspaces/<id>` 폴더는 처음 컨테이너를 만들 때 볼륨으로 한 번 옮겨지고 `<id>.moved`로 이름이 바뀐다. 확인한 뒤 지워도 된다.
- 동시에 도는 샌드박스는 최대 4개(`.env`의 `AGENTVIEW_MAX_SANDBOXES`로 변경). 넘으면 가장 오래 쉰 샌드박스를 멈추고, 모두 일하는 중이면 대기열에서 기다린다.
- 에이전트는 한 번에 일 하나만 한다. 같은 에이전트에게 일이 겹치면 줄을 서고, 구성원의 답을 기다리는 동안에는 줄의 다음 일을 먼저 처리한다(서로 부탁하는 팀도 멈추지 않는다).
- 에이전트를 지울 때 작업 폴더(볼륨)도 지울지 묻는다.

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
- 작업 파일: `GET /agents/<id>/files`, `GET /agents/<id>/files/<경로>?download=true`, `GET /agents/<id>/zip`
- 실행 기록: `app/data/runs/<runId>.jsonl`

## 토큰 한도 (기본값)

모델 답변 1024토큰, 모델에 돌려주는 도구 출력 4,000자, 실행당 모델 호출 20회(팀은 팀 설정, 기본 50회), 에이전트 6단계. 자동 테스트는 가짜 모델만 쓴다.

## 테스트 (`app/` 폴더에서)

```bash
npm test
npm run typecheck
```

Docker가 꺼져 있으면 컨테이너 테스트는 건너뛴다.

## 지금 되는 것 / 아직 안 되는 것

- 됨: 에이전트·팀(메인-하위·병렬·토론, 한도, 팀 내 역할) 실행, 에이전트별 샌드박스(볼륨, 동시 실행 상한)와 팀 공유 폴더, 작업 폴더 보기·내려받기, MCP 서버 런타임 추가, AG-UI 스트림·기록·재생·취소, 토큰 사용량, 3D 오피스(구조별 팀 방, 로비 공용 책상, 위임 연결선), 채팅과 세션 저장, 관리 화면
- 아직: 플러그인·스킬, 새 팀 구조(순차 파이프라인·검토 반복·라우터·투표), 전체 소집(회의실), DGX 연결과 모델 설정 화면, 준화 앱 연결, 배포용 빌드 스크립트

## 서드파티

- 가구 모델: Kenney Furniture Kit (CC0, 저장소에 포함하지 않음)
