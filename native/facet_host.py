#!/usr/bin/env python3
"""Chrome native messaging host for local transcription and translation.

Only the actions in HANDLERS exist. Nothing here runs shell commands or opens
paths supplied by the browser.
"""
import base64
import io
import json
import os
import struct
import sys
import threading

MAX_AUDIO_BYTES = 64 * 1024 * 1024
MAX_TEXT_CHARS = 200_000
MAX_REPLY_BYTES = 900_000  # Chrome rejects host messages over 1 MB
WHISPER_MODEL = os.environ.get("FACET_WHISPER_MODEL", "base")

_lock = threading.Lock()
_whisper = None


def read_message():
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        return None
    size = struct.unpack("=I", raw)[0]
    return json.loads(sys.stdin.buffer.read(size))


def send_message(message):
    body = json.dumps(message).encode()
    if len(body) > MAX_REPLY_BYTES:
        body = json.dumps({"id": message.get("id"), "ok": False, "error": "reply too large"}).encode()
    sys.stdout.buffer.write(struct.pack("=I", len(body)) + body)
    sys.stdout.buffer.flush()


def whisper():
    global _whisper
    if _whisper is None:
        from faster_whisper import WhisperModel
        # CPU by default: Parish1's GPU is shared with other jobs.
        _whisper = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
    return _whisper


def transcribe(req):
    audio = base64.b64decode(req["audio"], validate=True)
    if len(audio) > MAX_AUDIO_BYTES:
        raise ValueError("audio too large")
    segments, info = whisper().transcribe(
        io.BytesIO(audio), language=req.get("language"), vad_filter=True
    )
    parts = [{"start": s.start, "end": s.end, "text": s.text.strip()} for s in segments]
    return {"language": info.language, "text": " ".join(p["text"] for p in parts), "segments": parts}


def ensure_argos_path(source, target):
    import argostranslate.package as pkg
    import argostranslate.translate as tr

    def has(a, b):
        langs = {l.code: l for l in tr.get_installed_languages()}
        return a in langs and b in langs and langs[a].get_translation(langs[b]) is not None

    if has(source, target):
        return
    pkg.update_package_index()
    available = pkg.get_available_packages()
    pairs = [(source, target)] if source == "en" or target == "en" else [(source, "en"), ("en", target)]
    direct = [p for p in available if (p.from_code, p.to_code) == (source, target)]
    chosen = direct or [p for p in available if (p.from_code, p.to_code) in pairs]
    if not direct and len(chosen) != len(pairs):
        raise ValueError(f"no translation path from {source} to {target}")
    for package in chosen:
        pkg.install_from_path(package.download())


def detect_language(text):
    from langdetect import detect
    return detect(text)


def translate(req):
    import argostranslate.translate as tr

    text = req["text"]
    if not isinstance(text, str) or len(text) > MAX_TEXT_CHARS:
        raise ValueError("text missing or too long")
    target = req["target"]
    source = req.get("source") or detect_language(text)
    if source == target:
        return {"source": source, "target": target, "text": text}
    ensure_argos_path(source, target)
    return {"source": source, "target": target, "text": tr.translate(text, source, target)}


def status(_req):
    return {"whisperModel": WHISPER_MODEL, "actions": sorted(HANDLERS)}


HANDLERS = {"status": status, "transcribe": transcribe, "translate": translate}


def handle(req):
    reply = {"id": req.get("id") if isinstance(req, dict) else None}
    try:
        with _lock:
            reply |= {"ok": True, "result": HANDLERS[req["action"]](req)}
    except Exception as err:
        reply |= {"ok": False, "error": f"{type(err).__name__}: {err}"}
    send_message(reply)


def main():
    while (req := read_message()) is not None:
        handle(req)


if __name__ == "__main__":
    main()
