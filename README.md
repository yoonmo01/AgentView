# AgentView

BAZE API Gateway 모델로 도는 에이전트가 자기 Docker 샌드박스에서 일하는 모습을 3D 오피스로 보여주는 프로젝트. 실행 과정은 AG-UI 이벤트로 기록·전송된다. 설계 문서는 저장소 밖(`docs/`, Git 제외)에 따로 보관한다.

## 구조

```
.env            BAZE 키 (Git 제외, .env.example 참고)
app/
  server/       Fastify 서버: 실행기, 도구, 샌드박스, AG-UI SSE
  web/          React + React Three Fiber 3D 오피스
  sandbox/      샌드박스 기본 이미지 Dockerfile
  data.example/ 예시 설정 (복사해서 app/data/로 사용, data/는 Git 제외)
```

## 준비

- Node 22.18 이상, Docker Desktop
- `cd app && npm install`
- `docker build -t agentview/sandbox:base app/sandbox`
- `cp -r app/data.example app/data` 후 필요하면 `app/data/models.json`의 `defaultModel` 수정 (기본 `gpt-6-luna`)
- `cp .env.example .env` 후 `BAZE_API_KEY` 입력 (BAZE > API Gateway에서 발급)

## 실행 (`app/` 폴더에서)

```bash
npm start -w server      # http://127.0.0.1:8787
npm run dev -w web       # http://localhost:5173
```

에이전트에게 일 시키기 (AG-UI):

```bash
curl -N -X POST http://127.0.0.1:8787/agui -H 'content-type: application/json' \
  -d '{"threadId":"t1","runId":"demo1","messages":[{"id":"m1","role":"user","content":"Create hello.py that prints hello, run it, and tell me the output."}],"tools":[],"context":[],"forwardedProps":{"target":"agent:nova"}}'
```

- 실행 다시 보기: `http://localhost:5173/?run=demo1`
- 취소: `curl -X POST http://127.0.0.1:8787/runs/<runId>/cancel`
- 작업 파일: `app/data/workspaces/<agentId>/`, 실행 기록: `app/data/runs/<runId>.jsonl`

## 토큰 한도 (기본값)

모델 답변 1024토큰, 모델에 돌려주는 도구 출력 4,000자, 실행당 모델 호출 20회, 에이전트 6단계. 자동 테스트는 가짜 모델만 쓴다.

## 테스트 (`app/` 폴더에서)

```bash
npm test
npm run typecheck
```

Docker가 꺼져 있으면 컨테이너 테스트는 건너뛴다.

## 지금 되는 것 / 아직 안 되는 것

- 됨: 단일 에이전트 실행, 에이전트별 샌드박스, AG-UI 스트림·기록·재생·취소, 3D 오피스 실시간 표시
- 아직: 관리 화면, 팀(메인-하위·병렬·토론), MCP, DGX 연결, Claw3D 외형·Blender 캐릭터, 준화 앱 연결
