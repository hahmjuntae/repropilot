import fs from "node:fs/promises";
import path from "node:path";
import type { Runner } from "./runners";

export type Framework = "pytest" | "vitest" | "jest";

export interface TestPlan {
  framework: Framework;
  language: "python" | "javascript";
  install: string | null;
  env: Record<string, string>;
  testCommand(testPath?: string): string;
  isTestFile(p: string): boolean;
}

async function exists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true, () => false);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function detectPlan(workdir: string, runner: Runner): Promise<TestPlan> {
  const pkgPath = path.join(workdir, "package.json");
  if (await exists(pkgPath)) {
    const pkg = JSON.parse(await fs.readFile(pkgPath, "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const framework: Framework = deps.vitest ? "vitest" : "jest";
    const lock = (await exists(path.join(workdir, "package-lock.json"))) ? "npm ci" : "npm install";
    return {
      framework,
      language: "javascript",
      install: `${lock} --ignore-scripts --no-audit --no-fund`,
      env: { CI: "1" },
      testCommand: (p) =>
        framework === "vitest"
          ? `npx vitest run ${p ? shellQuote(p) : ""}`.trim()
          : `npx jest ${p ? shellQuote(p) : ""}`.trim(),
      isTestFile: (p) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(p),
    };
  }
  const py = runner.python;
  const hasReqs = await exists(path.join(workdir, "requirements.txt"));
  const hasProject = (await exists(path.join(workdir, "pyproject.toml"))) || (await exists(path.join(workdir, "setup.py")));
  const installParts = [`${py} -m pip install -q pytest`];
  if (hasReqs) installParts.push(`${py} -m pip install -q -r requirements.txt`);
  if (hasProject) installParts.push(`(${py} -m pip install -q -e . || true)`);
  return {
    framework: "pytest",
    language: "python",
    install: installParts.join(" && "),
    env: { PYTHONPATH: ".:src", PYTHONDONTWRITEBYTECODE: "1" },
    testCommand: (p) => `${shellQuote(py)} -m pytest -q -p no:cacheprovider ${p ? shellQuote(p) : ""}`.trim(),
    isTestFile: (p) => /(^|\/)(test_[^/]+|[^/]+_test)\.py$/.test(p),
  };
}

export type FailureVerdict = "fails-as-expected" | "passes" | "broken";

const PY_BROKEN = /(ERROR collecting|ImportError|ModuleNotFoundError|SyntaxError|IndentationError|NameError: name|fixture '.+' not found|ERROR at setup|AttributeError: module ')/;
const JS_BROKEN = /(SyntaxError|Cannot find module|Failed to load|Failed to resolve import|is not defined|No test files? found)/;

/** Classifies a run of the reproduction test: a real reproduction must fail on an assertion, not on setup. */
export function classifyRun(plan: TestPlan, exitCode: number, output: string): FailureVerdict {
  if (exitCode === 0) return "passes";
  if (plan.framework === "pytest") {
    if (exitCode !== 1) return "broken";
    return PY_BROKEN.test(output) ? "broken" : "fails-as-expected";
  }
  return JS_BROKEN.test(output) ? "broken" : "fails-as-expected";
}
