# Aria: AI Voice Support Agent for Aura Skincare

A browser-based voice customer support agent. Click **Start call**, speak, and Aria answers out loud, looks up live order data through tool calls, enforces brand policy, and writes a transcript and structured summary when the call ends.

## Features

- Natural voice conversation: browser speech recognition, a free neural female Indian voice (Microsoft Neerja for English, Swara for Hinglish) generated on the server, with the browser voice as automatic fallback
- English and Hinglish call modes
- Four tools called by the LLM: `get_order_details`, `check_return_eligibility`, `cancel_order`, `get_shipping_quote`
- Policy enforced **in code**, not only in the prompt (return window, opened products, cancellation only while Processing, cancel needs explicit confirmation)
- Graceful handling of invalid or missing order IDs, unclear audio, out-of-scope requests and silence
- Live order tracker that updates when an order is cancelled, plus a one-click demo reset
- Low latency: the model's reply is streamed and spoken sentence by sentence, with model thinking minimised
- Tool activity shown in the transcript, with time to first words per turn
- Barge-in (Interrupt button), and typing as a fallback to the microphone
- Post-call transcript, structured JSON summary, and downloads for both

## Architecture

<img width="1346" height="933" alt="image" src="https://github.com/user-attachments/assets/3bcfad00-ae05-41c7-8b96-eb5545ed85c1" />

## Setup

Requires Node 18+ and Chrome or Edge (Web Speech API).

```bash
# 1. install
npm install                 # server deps: express cors dotenv msedge-tts
npm install --prefix client # client deps

# 2. configure
cp .env.example .env        # add your GEMINI_API_KEY

# 3. run (two terminals)
node server/index.js        # API on :3001
cd client && npm run dev    # UI on :5173
```

If your Vite dev server does not already proxy `/api`, add this to `client/vite.config.js`:

```js
server: { proxy: { '/api': 'http://localhost:3001' } }
```

## Deploy (Render, single web service)

- Build command: `npm install && npm install --prefix client && npm run build --prefix client`
- Start command: `node server/index.js`
- Environment variables: `GEMINI_API_KEY`, optionally `MODEL`, `THINKING_LEVEL`
- Microphone access needs HTTPS, which Render provides.

## Test script for evaluators

| Say | Expected |
| --- | --- |
| "Where is ORD-101?" | Out for delivery with BlueDart, expected by 6 PM |
| "Can I return ORD-102?" | Declined: delivered 14 days ago, outside the 7-day window |
| "Cancel ORD-103" | Asks to confirm, cancels after "yes", tracker shows Cancelled |
| "Cancel ORD-101" | Declined: already out for delivery, may refuse at the doorstep |
| "Where is ORD-999?" | Could not locate it, asks to verify |
| "Will I pay shipping on a 450 rupee order?" | Yes, Rs 50 fee |
| "Book me a flight to Goa" | Politely declines, only Aura Skincare queries |

## Tell us how you think

### 1. Why this architecture and stack?

I used a modular pipeline: browser STT, then Gemini with function calling, then browser TTS. It needs no telephony or paid voice vendor, runs on a free tier, and each stage can be swapped independently. React gives a responsive live state indicator, and a small Express server keeps the API key private and owns the order data and policy logic. Tool calling lets the model decide when it needs data, while the business rules sit in plain code so they cannot be talked around.

### 2. Most difficult part and how I solved it

Making the turn-taking feel reliable. Speech recognition ends on silence, the agent must not hear itself, and a stale callback can start two overlapping turns. I used refs for call state, a turn counter and abort controller so a cancelled reply can never trigger the next listen, a `busy` guard against double submissions, silence nudges (two prompts, then a polite hang-up), and a manual interrupt. The second challenge was hallucinated policy answers, solved by moving return, cancellation and shipping decisions into tools that return authoritative results.

### 3. One more week: what first?

Latency and barge-in. Replies already stream sentence by sentence into TTS, so next I would stream speech recognition too (so the agent does not wait for the browser to detect silence) and add voice activity detection for true automatic barge-in, plus an official, paid-tier TTS option for production. After that, evaluation: a scripted set of adversarial calls (prompt injection, mumbled order IDs, pushy refund requests) run automatically on every change.

### 4. At 1,000 conversations a day

- Move STT and TTS server-side (streaming, with a telephony provider if phone calls are needed) for consistent quality across devices
- Replace the in-memory mock with a real order service, add authentication or caller verification before sharing order data, and store call records with PII redaction
- Add a queue and rate limiting, response caching for policy questions, retries and fallbacks across model providers
- Add monitoring: latency percentiles, tool error rates, resolution and escalation rates, and a human handoff path for angry or unresolved customers
- Keep reviewing transcripts to catch policy drift



