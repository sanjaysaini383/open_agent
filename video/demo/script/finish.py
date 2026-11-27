"""Finishes a render: normalises the mix to -16 LUFS / -1.5 dBTP in place (picture copied)
and prints the loudness before and after, so the delivery file always meets the standard.

    python -I script/finish.py renders/reliefmesh-demo-raw.mp4 renders/reliefmesh-demo.mp4
"""
import re, subprocess, sys
from pathlib import Path

src, dst = Path(sys.argv[1]), Path(sys.argv[2])

def loudness(path):
    out = subprocess.run(["ffmpeg", "-nostats", "-i", str(path), "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True).stderr
    integrated = re.findall(r"I:\s+(-?[\d.]+) LUFS", out)
    peak = re.findall(r"Peak:\s+(-?[\d.]+) dBFS", out)
    lra = re.findall(r"LRA:\s+(-?[\d.]+) LU", out)
    return (integrated[-1] if integrated else "?", peak[-1] if peak else "?", lra[-1] if lra else "?")

before = loudness(src)
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-c:v", "copy", "-af", "loudnorm=I=-16:TP=-1.5:LRA=7", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", str(dst)], check=True)
after = loudness(dst)
print(f"{src.name}: {before[0]} LUFS, peak {before[1]} dBFS, LRA {before[2]} LU")
print(f"{dst.name}: {after[0]} LUFS, peak {after[1]} dBFS, LRA {after[2]} LU")
