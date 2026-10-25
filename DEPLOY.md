# AutoTube — Deployment Guide

## One-time setup (30 minutes total)

### Step 1: Deploy backend to Railway (10 min)
1. Go to railway.app → sign up with GitHub
2. "New Project" → "Deploy from GitHub repo"
3. Connect this repo
4. Railway auto-detects Node.js and deploys

Set these environment variables in Railway dashboard → Variables:
```
ANTHROPIC_API_KEY=sk-ant-usr-1H6bVkKK7...  ← your key
NOTIFY_EMAIL=prajapatomprakash1008@gmail.com
EMAIL_USER=your_gmail@gmail.com
EMAIL_PASS=your_gmail_app_password          ← Gmail App Password (not regular password)
CHANNEL_NICHE=personal finance
CHANNEL_AUDIENCE=global English
VIDEO_FREQUENCY_DAYS=2
DASHBOARD_URL=https://your-railway-url.railway.app
PORT=4000
```

Add these LATER (Sessions 2-4):
```
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
PICTORY_CLIENT_ID=
PICTORY_CLIENT_SECRET=
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
YOUTUBE_REDIRECT_URI=https://your-railway-url.railway.app/auth/youtube/callback
```

### Step 2: Deploy frontend to Vercel (5 min)
1. Go to vercel.com → "New Project" → import this repo
2. Set root directory: `frontend`
3. Add env var: `REACT_APP_API_URL=https://your-railway-url.railway.app`
4. Deploy

### Step 3: Set up Gmail App Password for email (5 min)
1. Go to myaccount.google.com → Security → 2-Step Verification (enable if not on)
2. Search "App passwords" → Create one for "Mail"
3. Copy the 16-char password → paste as EMAIL_PASS in Railway

### Step 4: Connect YouTube channel (5 min, after Sessions 2-3 APIs are added)
1. Go to console.cloud.google.com → Create project → Enable "YouTube Data API v3"
2. Create OAuth credentials → Web application
3. Add redirect URI: `https://your-railway-url.railway.app/auth/youtube/callback`
4. Copy Client ID + Secret → add to Railway env vars
5. Visit: `https://your-railway-url.railway.app/auth/youtube` → click Allow
6. Done! YouTube is connected.

## How it runs automatically
- Every 2 days at 6 AM, the cron job triggers the pipeline
- Claude researches a topic + writes a 9-min script
- You get an email with a link to review it
- You click the dashboard link, read the script (~10 min), click Approve
- ElevenLabs generates the voiceover (~3 min)
- Pictory renders the video (~15 min)
- Video auto-uploads to YouTube with proper tags + AI disclosure
- You get a "video is live!" email

## Monthly costs (once fully running)
| Service | Cost |
|---------|------|
| Railway (backend hosting) | $5/mo |
| Anthropic API (scripts) | ~₹100-200/mo |
| ElevenLabs Starter | $5/mo |
| Pictory Starter | $19/mo |
| Vercel (frontend) | FREE |
| **Total** | **~₹2,500/mo** |
