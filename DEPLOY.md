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
3. The workflow (4 CPUs / 16 GB, free for public repos) produces a 2D animated explainer:
   - Kokoro neural voice (open-source, offline), one clip per sentence so everything syncs to the words
     (Microsoft edge-tts and Google TTS are fallbacks)
   - Claude storyboards the narration into ~45 animated beats using 13 templates — title, section heading,
     key idea, counter, stat ring, bar chart, money flow, percentage split, comparison, checklist,
     timeline, icon group, subscribe outro — with the WealthSutra character reacting on the left
   - Every number on screen is checked against the narration; invented figures are dropped
   - Frames are drawn in headless Chromium (parallel pages), captions are burned in, plus a custom thumbnail
   - `VISUAL_STYLE=footage` switches back to Pixabay stock footage
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
Secrets: `UPSTASH_REDIS_URL`, `UPSTASH_REDIS_TOKEN`, `ANTHROPIC_API_KEY`,
`YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REDIRECT_URI`
(`PIXABAY_API_KEY` only for `VISUAL_STYLE=footage`).

Optional variables: `TTS_ENGINE` (`kokoro` default, or `edge`), `KOKORO_VOICE` (default `am_michael`; e.g. `af_heart`, `am_adam`, `bf_emma`),
`TTS_VOICE` (Microsoft voice when `TTS_ENGINE=edge`, default `en-US-AndrewNeural`), `CHANNEL_NAME` (logo text, default `WealthSutra`),
`VISUAL_STYLE` (`animated` default, or `footage`),
`YOUTUBE_PRIVACY` (`public` by default; set `unlisted` or `private` to review on YouTube first),
`YOUTUBE_AI_LABEL` (`true` to tick YouTube's "altered or synthetic content" box on every upload; off by default),
`OUTPUT_HEIGHT` (footage style, `1440` default), `OUTPUT_HEIGHT_ANIMATED` (`1080` default).

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
