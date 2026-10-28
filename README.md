# ReproPilot

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

ReproPilot turns a bug report into a test that fails on the current code, then into a patch that makes it pass. Both claims are checked by running the tests in an isolated sandbox, so the output is evidence rather than a guess.

Built for the Nebius x NVIDIA Global AI Hackathon, track **Coding and Agentic Engineering**. Every model call goes to **NVIDIA Nemotron** models served by **Nebius Token Factory**, and tests run in **Token Factory Sandboxes**.

## Why

Most bug reports arrive without a reproduction. A maintainer has to read the report, guess which code is involved, write a test, and check whether the test fails for the right reason. Language models can draft that test, but a drafted test that was never run proves nothing. It may pass on the buggy code, or fail with an import error that has nothing to do with the bug.

ReproPilot only accepts a reproduction when it has watched the test fail on an assertion. It only accepts a fix when the same test passes and the rest of the suite still passes.

## How it works

```
issue URL or pasted report
  → download the repository into a fresh workspace
  → triage the report                    Nemotron 3.5 Lightning
  → search for known reports (optional)  Tavily
  → collect the relevant source files
  → write a reproduction test            Nemotron 3.5 Super
  → run it in the sandbox                must fail on an assertion, retried up to 3 times
  → propose a patch                      Nemotron 3.5 Super, Nemotron 3 Ultra on the last try
  → run the test again                   must pass
  → run the full suite                   must pass
  → failing test + unified diff + run logs + PR description
```

When a candidate test passes on the buggy code, or breaks before reaching an assertion (import error, collection error, missing fixture), the agent sends the real output back to the model and asks for another attempt. The same loop applies to patches. The web UI shows every attempt, including the rejected ones.

## Where Nemotron and Token Factory are used

| What | Where in the code | Default model |
|---|---|---|
| OpenAI-compatible client pointed at `https://api.tokenfactory.nebius.com/v1/` | [`src/agent/llm.ts`](src/agent/llm.ts) | |
| Issue triage, file selection, search query | [`src/agent/pipeline.ts`](src/agent/pipeline.ts) step `triage` | `nvidia/Nemotron-3_5-Lightning` |
| Reproduction test writing | `pipeline.ts` step `repro` | `nvidia/Nemotron-3.5-Super-VL` |
| Patch proposals | `pipeline.ts` step `patch` | `nvidia/Nemotron-3.5-Super-VL`, then `nvidia/Nemotron-3-Ultra-550b-a55b` |
| Test execution in VM-isolated Sandboxes (REST API) | [`src/agent/runners/nebius.ts`](src/agent/runners/nebius.ts) | |

Model IDs live in [`src/agent/models.ts`](src/agent/models.ts) and can be overridden with environment variables. The Lightning and Super IDs come from the Token Factory [model deprecation notice](https://docs.tokenfactory.nebius.com/model-deprecations-november-2026.md), which lists them as the current replacements for Nemotron 3 Nano and Super. The Ultra ID has not been checked against the live catalog yet and is marked `verified: false`.

## Quick start

Requirements: Node.js 20 or later, Python 3.9 or later.

```bash
npm install
npm run setup:python          # creates .venv with pytest for the local runner
cp .env.example .env.local
```

### Run without an API key

`MOCK_LLM=1` replays scripted model responses for the bundled example. The tests still run for real, so you can watch the first test get rejected, the second one fail on an assertion, and the patch turn it green.

```bash
MOCK_LLM=1 npm run repro -- --example batchkit     # terminal
MOCK_LLM=1 npm run dev                             # web UI on http://localhost:3000
```

The scripted responses are hand-written fixtures in [`examples/batchkit/scripted-responses.json`](examples/batchkit/scripted-responses.json), not recordings of a real model.

### Run with Nemotron

```bash
export NEBIUS_API_KEY=...                          # https://tokenfactory.nebius.com/project/api-keys
npm run repro -- https://github.com/owner/repo/issues/123
npm run dev
```

### Run tests in Nebius Sandboxes

```bash
export REPRO_RUNNER=nebius
export NEBIUS_PROJECT_ID=...                       # Project settings in Token Factory
export NEBIUS_SANDBOX_IMAGE=tag:<image>            # an image with python, see `contree images`
```

The Sandboxes runner uploads the workspace as a tar file, installs dependencies once in a non-disposable instance, keeps the resulting image, and runs each test in a disposable instance started from that image.

## Configuration

| Variable | Purpose |
|---|---|
| `NEBIUS_API_KEY` | Token Factory API key for Nemotron calls and Sandboxes |
| `MOCK_LLM` | `1` replays the bundled example without model calls |
| `REPRO_MODEL_FAST`, `REPRO_MODEL_REASON`, `REPRO_MODEL_ESCALATE` | Model ID overrides |
| `REPRO_RUNNER` | `local`, `docker` or `nebius` |
| `NEBIUS_PROJECT_ID`, `NEBIUS_SANDBOX_IMAGE` | Required by the `nebius` runner |
| `REPRO_INSTALL_DEPS` | `1` lets the local runner install the target repository's dependencies |
| `TAVILY_API_KEY` | Enables known-issue search |
| `GITHUB_TOKEN` | Raises the GitHub API rate limit for issue fetches |

See [`.env.example`](.env.example) for the full list.

## Supported projects

- Python with pytest
- JavaScript and TypeScript with vitest or jest

## Runners and deployment

| Runner | Isolation | Use |
|---|---|---|
| `local` | None. Runs in a temp directory on the host | Development and the bundled example |
| `docker` | Container per run | Self-hosted servers |
| `nebius` | VM per run in Token Factory Sandboxes | Production and the hosted demo |

The web app is a standard Next.js App Router project and builds for Vercel. A Vercel function has no Python interpreter and no Docker, so the `local` runner cannot run pytest there. The hosted demo needs the `nebius` runner, also in `MOCK_LLM=1` mode. Agent runs stream to the browser and can take several minutes, so the API route sets `maxDuration = 300`.

## Project layout

```
app/                    Next.js UI and API routes (/api/run streams NDJSON events)
src/agent/pipeline.ts   the agent loop
src/agent/llm.ts        Token Factory client and scripted mock
src/agent/runners/      local, docker and Nebius Sandboxes runners
src/agent/detect.ts     framework detection and failure classification
examples/batchkit/      sample repository, issue and scripted responses
scripts/repro.ts        command-line entry point
```

## License

[MIT](LICENSE)
