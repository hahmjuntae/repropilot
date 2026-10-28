// next dev 와 같은 .env.local 우선 규칙, 이미 설정된 셸 변수 우선
import fs from "node:fs";

for (const file of [".env.local", ".env"]) {
  if (fs.existsSync(file)) process.loadEnvFile(file);
}
