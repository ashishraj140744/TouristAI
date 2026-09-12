# TouristAI

Point your camera at a place. Get a real, spoken guide — in Hindi or English.

Built for **Hack Solan**. The pitch is not "AI landmark recognition" (Google Lens does that).
It is: **an audio guide for the heritage that has no guide, no signboard and no Wikipedia page.**

## How it works

1. On open, the app asks for your location and **immediately** pulls every named place
   within ~400 m of you from OpenStreetMap + Wikipedia — live, no hardcoded monument list.
2. You photograph what's in front of you.
3. Gemini gets your photo **plus that candidate list** and answers multiple-choice —
   "which of these is it, or none?". Narrowing the search space is what stops it
   hallucinating a confident wrong name.
4. It reads the guide out loud, in your language.

## Setup

```bash
cd backend
npm install
cp .env.example .env      # then paste your key into .env
npm start
```

Get a free key at https://aistudio.google.com/apikey — free tier is enough.

Open http://localhost:3000

### Demoing on a phone

Geolocation and camera capture need a **secure context**. `http://192.168.x.x:3000`
gives you neither — the phone will silently refuse both. Use a tunnel:

```bash
cloudflared tunnel --url http://localhost:3000
```

Open the `https://…trycloudflare.com` URL it prints on the phone.

## Notes

- `backend/.env` is gitignored and must stay that way. If a key ever lands in a chat
  or a commit, rotate it in AI Studio — treat it as burned.
- Guides are cached per place+language+mode in `backend/data/cache.json`, so repeated
  demos cost **zero** API calls and survive a restart. That is also what keeps the
  free tier alive during a live demo.
- `backend/data/places.json` is a hand-seeded Solan-area fallback used when the phone
  has no signal. Coordinates are approximate — verify before relying on them.
