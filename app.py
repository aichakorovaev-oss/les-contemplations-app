import os, sys, re, urllib.request, urllib.parse, urllib.error
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse, Response
import edge_tts

app = FastAPI()
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

def log(msg):
    print(msg, flush=True, file=sys.stderr)

log("=== DÉMARRAGE ===")
log(f"GROQ_API_KEY  : {'OK' if GROQ_API_KEY else 'MANQUANT'}")
log(f"GEMINI_API_KEY: {'OK' if GEMINI_API_KEY else 'MANQUANT'}")

with open("index.html") as f:
    _html = f.read()
_html_ready = _html.replace("'%%GROQ_API_KEY%%'", f"'{GROQ_API_KEY}'")
_html_ready = _html_ready.replace("'%%GEMINI_API_KEY%%'", f"'{GEMINI_API_KEY}'")

@app.get("/")
def serve():
    return HTMLResponse(_html_ready)

WIKI_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://en.wikipedia.org/',
    'Accept': 'image/webp,image/jpeg,image/*,*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
}


@app.post("/tts")
async def tts_proxy(request: Request):
    body = await request.json()
    text = body.get("text", "").strip()
    voice = body.get("voice", "fr-FR-HenriNeural")
    if not text:
        return JSONResponse({"error": "text vide"}, status_code=400)
    try:
        communicate = edge_tts.Communicate(text, voice, rate="-5%", pitch="-3Hz")
        chunks = []
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                chunks.append(chunk["data"])
        audio = b"".join(chunks)
        return StreamingResponse(iter([audio]), media_type="audio/mpeg",
                                 headers={"Cache-Control": "no-store"})
    except Exception as e:
        log(f"/tts ERREUR: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)