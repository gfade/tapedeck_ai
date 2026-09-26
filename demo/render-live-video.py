import argparse
import bisect
import hashlib
import json
import subprocess
import textwrap
import wave
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description="Encode actual timestamped browser captures, without reconstructing the UI.")
parser.add_argument("--ffmpeg", required=True)
parser.add_argument("--capture", type=Path, required=True)
parser.add_argument("--frames", type=Path, required=True)
parser.add_argument("--result", type=Path, required=True)
args = parser.parse_args()
build = ROOT / "agent-exports/live-screen-build"
build.mkdir(parents=True, exist_ok=True)
capture = json.loads(args.capture.read_text())
result = json.loads(args.result.read_text())
plan = json.loads((ROOT / "presentation/live-narration.json").read_text())
if result["status"] != "complete" or result["replayCalls"] != 0 or result["atlas"]["status"] != "verified":
    raise RuntimeError("Only a completed, verified recording can be packaged as this demo")
duration = 60
sample_rate = 24000
audio = bytearray(duration * sample_rate * 2)
voice = []


def execute(command):
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


for index, segment in enumerate(plan):
    source = build / f"live-voice-{index}.aiff"
    decoded = build / f"live-voice-{index}.wav"
    adjusted = build / f"live-voice-{index}-timed.wav"
    execute(["/usr/bin/say", "-v", "Samantha", "-r", "160", "-o", str(source), segment["text"]])
    execute([args.ffmpeg, "-y", "-i", str(source), "-ar", str(sample_rate), "-ac", "1", str(decoded)])
    with wave.open(str(decoded), "rb") as recording:
        original_duration = recording.getnframes() / recording.getframerate()
    available = segment["end"] - segment["start"] - 0.25
    tempo = max(1, original_duration / available)
    execute([args.ffmpeg, "-y", "-i", str(decoded), "-af", f"atempo={tempo:.8f},loudnorm=I=-16:TP=-1.5:LRA=7", "-ar", str(sample_rate), "-ac", "1", str(adjusted)])
    with wave.open(str(adjusted), "rb") as recording:
        speech = recording.readframes(recording.getnframes())
    speech_duration = len(speech) / (sample_rate * 2)
    if speech_duration > available + 0.05:
        raise RuntimeError("Narration overruns its slot")
    offset = int((segment["start"] + 0.1) * sample_rate) * 2
    audio[offset:offset + len(speech)] = speech
    voice.append({"start": segment["start"] + 0.1, "duration": speech_duration, "tempo": tempo, "text": segment["text"]})
with wave.open(str(build / "live-narration.wav"), "wb") as destination:
    destination.setnchannels(1)
    destination.setsampwidth(2)
    destination.setframerate(sample_rate)
    destination.writeframes(audio)


def timestamp(seconds):
    milliseconds = int(round(seconds * 1000))
    return f"{milliseconds // 3600000:02}:{milliseconds // 60000 % 60:02}:{milliseconds // 1000 % 60:02},{milliseconds % 1000:03}"


captions = []
for index, segment in enumerate(plan, 1):
    captions.append(f"{index}\n{timestamp(segment['start'])} --> {timestamp(segment['end'])}\n{textwrap.fill(segment['text'], 56)}\n")
(ROOT / "presentation/TapeDeck-Live-60s.srt").write_text("\n".join(captions))

width = capture["bounds"]["width"]
height = capture["bounds"]["height"]
timestamps = [frame["elapsedMs"] / 1000 for frame in capture["frames"]]
if timestamps != sorted(timestamps) or timestamps[0] != 0:
    raise RuntimeError("Invalid capture timestamps")
movie = ROOT / "presentation/TapeDeck-Live-60s.mp4"
log = open(build / "live-encode.log", "w")
encoder = subprocess.Popen([
    args.ffmpeg, "-y", "-f", "rawvideo", "-pixel_format", "rgb24", "-video_size", f"{width}x{height}",
    "-framerate", "30", "-i", "pipe:0", "-i", str(build / "live-narration.wav"),
    "-vf", "scale=-2:1080:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x07151b,setsar=1",
    "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-t", "60", "-movflags", "+faststart", str(movie)
], stdin=subprocess.PIPE, stderr=log)
previous_index = None
pixels = None
for frame_number in range(duration * 30):
    source_index = max(0, bisect.bisect_right(timestamps, frame_number / 30) - 1)
    if source_index != previous_index:
        with Image.open(args.frames / capture["frames"][source_index]["file"]) as image:
            if image.size != (width, height):
                raise RuntimeError("Capture changed dimensions")
            pixels = image.convert("RGB").tobytes()
        previous_index = source_index
    encoder.stdin.write(pixels)
encoder.stdin.close()
if encoder.wait() != 0:
    raise RuntimeError("Video encoding failed")
log.close()
execute([args.ffmpeg, "-y", "-i", str(movie), "-t", str(capture["liveFootageMs"] / 1000), "-an", "-c:v", "copy", str(ROOT / "presentation/TapeDeck-Live-Unnarrated.mp4")])
execute([args.ffmpeg, "-y", "-ss", "55", "-i", str(movie), "-frames:v", "1", str(ROOT / "presentation/TapeDeck-Live-Poster.png")])
evidence = {
    "format": "tapedeck.live-screen-evidence/v1",
    "capturedAt": capture["capturedAt"],
    "method": capture["method"],
    "durationSeconds": 60,
    "liveFootageSeconds": capture["liveFootageMs"] / 1000,
    "finalVerifiedResultHoldSeconds": capture["finalVerifiedResultHoldMs"] / 1000,
    "sourceFrames": len(timestamps),
    "sourceDimensions": capture["bounds"],
    "outputDimensions": {"width": 1920, "height": 1080, "fps": 30},
    "captureManifestSha256": hashlib.sha256(args.capture.read_bytes()).hexdigest(),
    "videoSha256": hashlib.sha256(movie.read_bytes()).hexdigest(),
    "syntheticNarration": {"voice": "macOS Samantha", "writerVoiceClone": False, "timing": voice},
    "result": result,
}
(ROOT / "presentation/live-screen-evidence.json").write_text(json.dumps(evidence, indent=2) + "\n")
print(json.dumps({"video": str(movie), "bytes": movie.stat().st_size, "sourceFrames": len(timestamps), "voice": voice}, indent=2))
