# Travel Memory Museum Web

React, TypeScript, and Vite web client for collecting travel objects, generating 2D keepsakes, building textured 3D models, and arranging moodboards.

## Local setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local` and add the public Firebase web configuration.
3. Copy `server/.env.example` to `server/.env` and add only the server-side keys needed for the features being tested.
4. Run `npm run dev`, then open `http://localhost:5173`.

Never put provider keys in a `VITE_` variable. Vite exposes those variables to the browser bundle.

## Add Item modes

- **2D:** sends one photo through the local server to OpenRouter's `openai/gpt-image-2` model and returns a hand-drawn diary image plus a travel fridge magnet. This requires `OPENROUTER_API_KEY`; each click starts two paid image requests.
- **3D:** sends two to four object photos through the local server to Tripo and returns a rotatable model. This requires `TRIPO_API_KEY`.
- **AI sticker:** creates the collection thumbnail through OpenAI's image edit endpoint when `OPENAI_API_KEY` is configured.

## Local test mode

Set `VITE_API_TEST_MODE=true` in `.env.local` to show **Enter local test mode** on the login page. The bypass exists only in Vite development builds. It opens Add Item without Firebase authentication, disables Firebase saving, and prevents Collection and Moodboard from reading Firebase.

## Checks

```bash
npm run build
npm run lint
```
