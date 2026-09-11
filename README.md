# TouristAI

**See the Place. Know the Story.**

A simple hackathon MVP for identifying tourist landmarks from an uploaded/captured image using the Gemini API.

## Structure

- `frontend/` — simple HTML/CSS/JS frontend
- `backend/` — Node.js + Express API
- `backend/data/landmarks.json` — small landmark dataset
- `.env.example` — environment variable template

## Setup

1. Copy `.env.example` to `backend/.env`
2. Put your Gemini API key in `GEMINI_API_KEY`
3. From `backend/` run:
   ```bash
   npm install
   npm start
   ```
4. Open `http://localhost:3000`

## Important security note

Never put your Gemini API key in frontend JavaScript or commit `backend/.env` to GitHub. The key in the chat should be considered exposed; create/rotate it in Google AI Studio before using this project.
