// scenes.json 문장별 say 음성과 frames 캡처를 MP4 하나로 합치는 스크립트
// 실행 기준: node video/build.mjs <출력.mp4>
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const dir = path.dirname(new URL(import.meta.url).pathname);
const out = path.resolve(process.argv[2] ?? path.join(dir, "out", "repropilot-demo.mp4"));
const scenes = JSON.parse(fs.readFileSync(path.join(dir, "scenes.json"), "utf8"));
const work = path.join(dir, "out", "work");
fs.mkdirSync(work, { recursive: true });
const GAP = 0.5; // 문장 사이 쉼 기준, 초 단위
const VOICE = process.env.VOICE ?? "Samantha";
const RATE = process.env.RATE ?? "178";

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"] }).toString();
const duration = (f) => Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).trim());

const clips = [];
const srt = [];
let n = 0;
let t = 0;
const stamp = (s) => new Date(s * 1000).toISOString().slice(11, 23).replace(".", ",");
for (const scene of scenes) {
  for (const text of scene.lines) {
    n += 1;
    const id = String(n).padStart(2, "0");
    const aiff = path.join(work, `${id}.aiff`);
    run("say", ["-v", VOICE, "-r", RATE, "-o", aiff, text]);
    const d = duration(aiff) + GAP;
    const frame = path.join(dir, "frames", `${id}.png`);
    if (!fs.existsSync(frame)) throw new Error(`missing frame ${frame}`);
    const clip = path.join(work, `${id}.mp4`);
    run("ffmpeg", ["-y", "-loop", "1", "-i", frame, "-i", aiff, "-af", `apad=pad_dur=${GAP}`, "-t", d.toFixed(3),
      "-vf", "scale=1920:1080,format=yuv420p", "-r", "30", "-c:v", "libx264", "-tune", "stillimage", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "160k", clip]);
    clips.push(clip);
    srt.push(`${n}\n${stamp(t)} --> ${stamp(t + d - GAP)}\n${text}\n`);
    t += d;
  }
}
const list = path.join(work, "list.txt");
fs.writeFileSync(list, clips.map((c) => `file '${c}'`).join("\n"));
fs.mkdirSync(path.dirname(out), { recursive: true });
run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", out]);
fs.writeFileSync(out.replace(/\.mp4$/, ".srt"), srt.join("\n"));
console.log(JSON.stringify({ out, lines: n, seconds: Number(duration(out).toFixed(1)) }));
