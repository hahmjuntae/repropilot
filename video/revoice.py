# 사용: revoice.py <원본.mp4> <자막.srt> <출력.mp4> [음성] [언어코드]
# 화면은 그대로 복사하고 srt 문장 시작 시각에 Kokoro 음성만 다시 입히는 스크립트
import re, sys, subprocess, numpy as np, soundfile as sf
from kokoro import KPipeline

src, srt_path, out = sys.argv[1:4]
voice = sys.argv[4] if len(sys.argv) > 4 else "af_heart"
lang = sys.argv[5] if len(sys.argv) > 5 else "a"
SR = 24000
MAX_SPEED = 1.25  # 자연스러운 말 빠르기 상한 기준

def sec(s):
    h, m, rest = s.split(":")
    return int(h) * 3600 + int(m) * 60 + float(rest.replace(",", "."))

cues = []
for block in re.split(r"\n\s*\n", open(srt_path, encoding="utf-8").read().strip()):
    rows = block.strip().splitlines()
    a, b = rows[1].split(" --> ")
    cues.append((sec(a), sec(b), " ".join(rows[2:]).strip()))

total = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src],
                             capture_output=True, text=True).stdout)
pipe = KPipeline(lang_code=lang, repo_id="hexgrad/Kokoro-82M")
LEXICON = {"pytest": "pˈaɪtˌɛst"}  # Kokoro 오독 단어 발음 고정 대상
fix = lambda text: re.sub(r"\b(" + "|".join(LEXICON) + r")\b", lambda m: f"[{m[1]}](/{LEXICON[m[1].lower()]}/)", text, flags=re.I)
say = lambda text, speed: np.concatenate([a.numpy() for _, _, a in pipe(fix(text), voice=voice, speed=speed)])

track = np.zeros(int(total * SR) + SR, dtype=np.float32)
report = []
for i, (start, end, text) in enumerate(cues):
    slot = (cues[i + 1][0] if i + 1 < len(cues) else total) - start - 0.15
    speed, audio = 1.0, say(text, 1.0)
    for _ in range(4):
        if len(audio) / SR <= slot or speed >= MAX_SPEED:
            break
        speed = min(MAX_SPEED, round(speed * (len(audio) / SR / slot) + 0.01, 3))
        audio = say(text, speed)
    pos = int(start * SR)
    track[pos:pos + len(audio)] += audio[: len(track) - pos]
    report.append(f"{i+1:02d} start={start:.2f} slot={slot:.2f} dur={len(audio)/SR:.2f} speed={speed}"
                  + (" OVER" if len(audio) / SR > slot else ""))

wav = out.rsplit(".", 1)[0] + ".voice.wav"
sf.write(wav, track[: int(total * SR)], SR)
subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", src, "-i", wav, "-map", "0:v", "-map", "1:a", "-c:v", "copy",
                "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "160k", "-t", f"{total:.3f}", "-movflags", "+faststart", out],
               check=True)
print("\n".join(report))
print(f"{out} total={total:.2f}")
