# AutoTube — How it's deployed

| Piece | Where | What it does |
|---|---|---|
| Dashboard | Vercel (`frontend/`) | Review scripts, approve, watch live progress |
| API server | Render (`backend/server.js`) | Picks topics, writes scripts (Claude), dispatches renders, YouTube OAuth |
| Database | Upstash Redis | Video history (`autotube:data`), live job progress (`autotube:job:<id>`), YouTube tokens |
| Video renderer | GitHub Actions (`.github/workflows/render.yml`) | Voiceover, stock footage, captions, thumbnail, YouTube upload |

Render's free disk is wiped on every deploy, so **nothing important lives on it**: history and
tokens are in Redis, finished videos go to YouTube, and every render's MP4 + thumbnail is also kept
as a GitHub Actions artifact for 14 days.

## Flow

1. **Generate Now** (or the daily cron) → the API server researches a topic and writes the script, reporting each step live.
2. You **approve** → the API server triggers the `Render video` workflow on GitHub.
3. The workflow (4 CPUs / 16 GB, free for public repos) renders a 1080p video:
   - Microsoft neural voice via `edge-tts`, one clip per sentence (Google TTS as fallback)
   - Pixabay stock footage chosen per scene (Claude turns each `[B-ROLL: …]` cue into search terms), a new shot every ~5.5 s with a slow pan
   - Burned-in captions synced to the voice, an intro title card, section headings and an end card
   - A custom thumbnail
4. It uploads to YouTube and reports back; the dashboard shows each stage as it happens.

## Setup checklist

### Render (API server) — environment variables
| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key |
| `UPSTASH_REDIS_URL`, `UPSTASH_REDIS_TOKEN` | Upstash REST URL + token |
| `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REDIRECT_URI` | Google OAuth client |
| `GH_DISPATCH_TOKEN` | GitHub fine-grained token, repo `autotube` only, permission **Actions: Read and write** |
| `DASHBOARD_URL` | `https://autotube-zeta.vercel.app` |
| `EMAIL_USER`, `EMAIL_PASS`, `NOTIFY_EMAIL` | optional — Gmail app password for notifications |

Without `GH_DISPATCH_TOKEN` the server renders in-process instead (fine locally, far too slow on Render's free tier).

### GitHub → repo Settings → Secrets and variables → Actions
Secrets: `UPSTASH_REDIS_URL`, `UPSTASH_REDIS_TOKEN`, `PIXABAY_API_KEY`, `ANTHROPIC_API_KEY`,
`YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REDIRECT_URI`.

Optional variables: `TTS_VOICE` (default `en-US-AndrewNeural`; e.g. `en-US-AvaNeural`, `en-US-BrianNeural`),
`YOUTUBE_PRIVACY` (`public` by default; set `unlisted` or `private` to review on YouTube first).

### YouTube
Visit `https://<render-app>/auth/youtube` once and approve. Tokens are stored in Redis and refresh automatically.
Custom thumbnails only apply once the channel is phone-verified (youtube.com/verify).

## Running locally

```bash
cd backend && npm install && node server.js        # API on :4000 (uses data.json if no Redis)
cd frontend && npm install && npm start             # dashboard on :3000
node backend/render-job.js <jobId> --no-upload      # render one job locally (needs ffmpeg; pip install edge-tts)
```
Offline test mode: `TTS_ENGINE=test FOOTAGE=test` uses placeholder audio and synthetic clips.

## Costs
Everything above runs on free tiers. Claude Haiku costs roughly $0.01–0.03 per video.
GitHub Actions minutes are free and unlimited for public repositories (private repos get 2,000 free minutes/month ≈ 200+ videos).
