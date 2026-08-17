# SquadAi-Back

Backend del orquestador multi-agente local. Un **Jefe** (planner/QA) y un **Trabajador** (codegen) se coordinan por JSON y escriben en un workspace que tú eliges.

No usa CrewAI, LangChain ni LangGraph: el loop es código propio (promesas + reintentos).

```text
  CLI / HTTP
       |
       v
  POST /api/orchestrate
       |
       +-- FileService.listTree
       v
  Jefe (plan)  -->  archivos[]
       |
       +-- por cada archivo (max 3-5 intentos)
       |      Trabajador.generate  -->  { filepath, code }
       |      Jefe.QA              -->  { approved, feedback }
       |         |
       |         +-- no --> retry con feedback
       |         +-- sí  --> FileService.write
       v
  { status, summary, changes, trace }
```

## Stack

- Node.js + TypeScript (ESM, `strict`)
- Express 5
- SDK `openai` apuntando a DeepSeek (`https://api.deepseek.com/v1`)
- SQLite (`better-sqlite3`) para settings y API keys

Modelos por defecto: `deepseek-reasoner` (jefe) y `deepseek-chat` (trabajador). Se pueden cambiar en config.

## Arranque

```bash
cd SquadAi-Back
cp .env.example .env   # rellena DEEPSEEK_API_KEY si aún no está en SQLite
npm install
npm run dev            # http://localhost:4000
```

Scripts: `dev` (nodemon + tsc), `build`, `start`, `check` (selfcheck sin red).

## Config

El `.env` solo siembra. Después las keys y settings viven en `data/squad.sqlite` (gitignored).

| Variable | Qué hace |
|---|---|
| `PORT` | default 4000 |
| `DEEPSEEK_API_KEY` | semilla; luego `PUT /api/config/keys/deepseek` |
| `DEEPSEEK_BASE_URL` | default `https://api.deepseek.com/v1` |
| `BOSS_MODEL` / `WORKER_MODEL` | modelos |
| `WORKSPACE_DIR` | fallback si el request no manda carpeta |
| `MAX_RETRIES` | 1–5, default 3 |

## API

| Método | Ruta | Notas |
|---|---|---|
| `GET` | `/health` | `{ ok, deepseek }` |
| `GET`/`PUT` | `/api/config` | settings + keys enmascaradas |
| `GET` | `/api/config/keys` | lista |
| `PUT`/`DELETE` | `/api/config/keys/:id` | p.ej. `deepseek` |
| `POST` | `/api/orchestrate` | el job |

Body de orquestación:

```json
{
  "requirement": "crea un hello world en ts",
  "workspaceDir": "/home/ramces/Documentos/Proyectos/Personal/pruebas",
  "maxRetries": 3,
  "permissions": { "writeFiles": true, "createDirs": true, "runCommands": false }
}
```

`runCommands` se acepta pero **no ejecuta shells** (fase 1). El FileService bloquea path traversal y secretos (`.env`, `*.pem`, `credentials.json`).

`POST /api/orchestrate` es **bloqueante**: el `trace` llega al terminar, no hay SSE todavía. HTTP 200 = success, 422 = partial/failed con el mismo JSON.

## Estructura

```text
src/
  agents/       bossAgent, workerAgent, llm
  config/       env + cliente DeepSeek
  controllers/  orchestrate + config
  db/           sqlite
  services/     orchestrator, fileService, configService
  utils/        json resiliente, logger, secrets
  server.ts
```

El parser JSON (`utils/json.ts`) parsea el objeto entero **antes** de mirar fences markdown, para no romper READMEs con ` ```bash ` dentro de `code`.
