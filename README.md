# ReproPilot

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

ReproPilot takes a bug report and returns two things: a test that fails on the current code, and a patch that makes it pass. It runs both before it reports them. A reproduction counts only if the test fails on an assertion. A fix counts only if that test then passes and the rest of the suite still passes.

Built for the Nebius x NVIDIA Global AI Hackathon, track **Coding and Agentic Engineering**. Model calls go to **NVIDIA Nemotron** models on **Nebius Token Factory**, and tests can run in **Token Factory Sandboxes**.

- Demo: https://repropilot.graphite-site.workers.dev
- Video: _link added after upload_

The hosted demo replays a recorded run of the bundled example. Both parts of that recording are real: the model responses came from Nemotron on Nebius Token Factory (`MOCK_LLM=0`), and the pytest runs came from the local runner. A static host cannot run tests, so live runs on other issues need the self-hosted server, see [Run with Nemotron](#run-with-nemotron).

## The problem

Most bug reports come without a reproduction. Someone has to read the report, find the code involved, write a test, and check that the test fails for the reason in the report. A language model can draft that test quickly. A drafted test that nobody ran tells you very little, though. It might pass on the buggy code, or fail with an `ImportError` that has nothing to do with the bug.

ReproPilot treats the test run as the deciding evidence. The model only proposes.

## How it works

```
issue URL or pasted report
  → download the repository into a fresh workspace
  → triage the report                    Nemotron 3.5 Lightning
  → search for known reports (optional)  Tavily
  → collect the relevant source files
  → write a reproduction test            Nemotron 3.5 Super
  → run it                               must fail on an assertion, up to 3 tries
  → propose a patch                      Nemotron 3.5 Super, a larger model on the last try
  → run the test again                   must pass
  → run the full suite                   must pass
  → failing test + unified diff + run logs + PR description
```

When a candidate test passes on the buggy code, or breaks before it reaches an assertion (import error, collection error, missing fixture), the agent sends the real output back to the model and asks again. Patches go through the same loop. The web UI shows every attempt, including the rejected ones, so you can see why a test was thrown out.

In the bundled example the first test is rejected because it imports a module that does not exist (`batchkit.chunking`). The second one fails on the assertion that matches the report. The patch changes one line, the new test passes, and so do the 8 tests in the suite.

## Where Nemotron and Token Factory are used

| What | Code | Default model |
|---|---|---|
| OpenAI-compatible client for `https://api.tokenfactory.nebius.com/v1/` | [`src/agent/llm.ts`](src/agent/llm.ts) | |
| Issue triage, file selection, search query | [`src/agent/pipeline.ts`](src/agent/pipeline.ts), step `triage` | `nvidia/Nemotron-3_5-Lightning` |
| Writing the reproduction test | `pipeline.ts`, step `repro` | `nvidia/Nemotron-3.5-Super-VL` |
| Patch proposals | `pipeline.ts`, step `patch` | `nvidia/Nemotron-3.5-Super-VL`, then `REPRO_MODEL_ESCALATE` |
| Test runs in VM-isolated Sandboxes over REST | [`src/agent/runners/nebius.ts`](src/agent/runners/nebius.ts) | |

Model IDs live in [`src/agent/models.ts`](src/agent/models.ts) and can be overridden with environment variables. The Lightning and Super IDs come from the Token Factory [November 2026 deprecation notice](https://docs.tokenfactory.nebius.com/model-deprecations-november-2026.md), which lists them as the replacements for Nemotron 3 Nano and Nemotron 3 Super. The default escalation ID, `nvidia/Nemotron-3-Ultra-550b-a55b`, does not appear in the public docs, but the Token Factory model list returned it on 2026-10-29. If Token Factory answers 404 for it, the last patch attempt falls back to the Super model. `npm run check:nebius -- models` prints which IDs your key can see.

Not every Token Factory model supports JSON mode. ReproPilot asks for `response_format: json_object` first and retries without it on HTTP 400. Replies are parsed after stripping `<think>` blocks and code fences. Nemotron 3.5 spends several hundred reasoning tokens before it answers, so a reply cut off at `max_tokens` with no content is retried once with twice the limit.

## Quick start

Requirements: Node.js 20.12 or later, Python 3.9 or later.

```bash
npm install
npm run setup:python          # .venv with pytest for the local runner
cp .env.example .env.local
```

### Run without an API key

```bash
MOCK_LLM=1 npm run repro -- --example batchkit     # terminal
MOCK_LLM=1 npm run dev                             # web UI on http://localhost:3000
```

`MOCK_LLM=1` replays the scripted responses in [`examples/batchkit/scripted-responses.json`](examples/batchkit/scripted-responses.json). They are hand-written, not recorded from a model. The tests still run for real.

### Run with Nemotron

Put the key in `.env.local` and turn the mock off:

```bash
NEBIUS_API_KEY=...            # https://tokenfactory.nebius.com/project/api-keys
MOCK_LLM=0
```

Then check the key and run:

```bash
npm run check:nebius -- models chat                # catalog lookup and one Nemotron call
npm run repro -- --example batchkit                # the bundled example
npm run repro -- https://github.com/owner/repo/issues/123
npm run dev                                        # web UI, any GitHub issue
```

The CLI scripts read `.env.local` the same way `next dev` does. Variables already set in the shell win.

### Run tests in Nebius Sandboxes

```bash
REPRO_RUNNER=nebius
NEBIUS_PROJECT_ID=...         # Token Factory > Project settings
NEBIUS_SANDBOX_IMAGE=...      # image UUID or tag:NAME with python
```

`npm run check:nebius -- images` lists tagged images with python in the name. If there are none, `npm run check:nebius -- import-python` imports `python:3.12-slim` and prints its UUID. `npm run check:nebius -- sandbox` then runs `python3 --version` in a disposable instance.

Sandboxes is in beta and is enabled per project on request (the Request beta access button on the Sandboxes page). Until then the API answers 403, and the recorded demo run used the local runner.

The Sandboxes runner uploads the workspace as a tar file, installs dependencies once in a non-disposable instance, keeps the resulting image, and runs each test in a disposable instance started from that image.

## Hosted demo

The demo is a static export of the same UI, served from a Cloudflare Worker. It has no server, so it cannot run tests. It plays back a run recorded with `npm run record:replay`.

```bash
npm run record:replay -- --example batchkit        # writes public/replay/
npm run deploy:demo                                # static export + wrangler deploy
```

`record:replay` uses whatever mode is configured. With `MOCK_LLM=0` and a key, the recording contains real Nemotron responses and the page labels it that way. Local paths are removed from the recording before it is written.

## Configuration

| Variable | Purpose |
|---|---|
| `NEBIUS_API_KEY` | Token Factory API key for Nemotron calls and Sandboxes |
| `MOCK_LLM` | `1` replays the bundled example without model calls |
| `REPRO_MODEL_FAST`, `REPRO_MODEL_REASON`, `REPRO_MODEL_ESCALATE` | Model ID overrides |
| `REPRO_JSON_MODE` | `0` never sends `response_format` |
| `REPRO_RUNNER` | `local`, `docker` or `nebius` |
| `NEBIUS_PROJECT_ID`, `NEBIUS_SANDBOX_IMAGE` | Required by the `nebius` runner |
| `REPRO_INSTALL_DEPS` | `1` lets the local runner install the target repository's dependencies |
| `TAVILY_API_KEY` | Turns on known-issue search |
| `GITHUB_TOKEN` | Higher GitHub API rate limit for issue fetches |

The full list with comments is in [`.env.example`](.env.example).

## Supported projects

- Python with pytest
- JavaScript and TypeScript with vitest or jest

## Runners

| Runner | Isolation | Use |
|---|---|---|
| `local` | None, runs in a temp directory on the host | Development and the bundled example |
| `docker` | One container per run | Self-hosted servers |
| `nebius` | One VM per run in Token Factory Sandboxes | Running untrusted repositories |

Agent runs stream to the browser as NDJSON and can take several minutes on a real repository, so `/api/run` sets `maxDuration = 300`.

## Project layout

```
app/                    Next.js UI and API routes (/api/run streams NDJSON events)
app/*.demo.tsx          static replay build used by the hosted demo
src/agent/pipeline.ts   the agent loop
src/agent/llm.ts        Token Factory client and scripted mock
src/agent/runners/      local, docker and Nebius Sandboxes runners
src/agent/detect.ts     framework detection and failure classification
examples/batchkit/      sample repository, issue and scripted responses
scripts/                CLI, Token Factory checks, replay recorder
video/                  narration, capture and build scripts for the demo video
```

## License

[MIT](LICENSE)
