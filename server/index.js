import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fetch from 'node-fetch';
import FormData from 'form-data';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const PORT = process.env.PORT || 3001;
const TRIPO_API_KEY = process.env.TRIPO_API_KEY;
const TRIPO_BASE = 'https://api.tripo3d.ai/v2/openapi';
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const PLACES_BASE = 'https://places.googleapis.com/v1';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE = 'https://api.openai.com/v1';

app.use(cors());
app.use(express.json());

// Shared SSRF guard for any route that fetches a caller-supplied URL
// server-side (the GLB proxy below, and the sticker regenerate path, which
// fetches an existing item's photo from Firebase Storage by URL).
function isSafeUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return false;
  }
  const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
  if (
    parsed.protocol !== 'https:' ||
    blockedHosts.includes(parsed.hostname) ||
    parsed.hostname.startsWith('169.254.') ||
    parsed.hostname.startsWith('192.168.') ||
    parsed.hostname.startsWith('10.')
  ) {
    return false;
  }
  return true;
}

// Tripo's officially documented accepted formats are JPEG/PNG/TIFF only.
// Rather than gamble on whatever format the browser/camera produced (webp,
// heic, gif, avif, ...), normalize every upload server-side before forwarding
// it, so the 'type' we tell Tripo always matches the real bytes.
//
// JPEG (not PNG) is the re-encode target: real photos are high-frequency
// photographic content, and PNG's lossless compression can balloon a ~10MB
// phone photo to 30MB+, which trips Tripo's upload size limit (nginx 413,
// returned as an HTML page that breaks res.json()). JPEG is both officially
// supported and the right lossy format for this kind of content. We also
// cap the resolution — Tripo's model doesn't need full 12MP+ camera output,
// so downscaling keeps uploads small and fast regardless of source size.
async function normalizeForTripo(buffer) {
  return sharp(buffer)
    .rotate() // respect EXIF orientation before any resize
    // Downscaled aggressively (was 2048/90) to cut upload time to our server
    // and onward to Tripo — Tripo's own model-generation compute time is
    // dominated by their server-side pipeline and isn't meaningfully
    // shortened by a smaller input, but a smaller file uploads noticeably
    // faster, which is most of what a visitor perceives as "faster".
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 78 })
    .toBuffer();
}

// Reference image sent to gpt-image-2's images/edits endpoint for AI sticker
// generation. Kept smaller than the Tripo reference (1024 vs 2048) since
// OpenAI bills input images by token count regardless of resolution — there's
// no quality benefit to sending a larger image, just extra cost.
async function normalizeForSticker(buffer) {
  return sharp(buffer)
    .rotate()
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function uploadImageToTripo(buffer, originalname) {
  const jpegBuffer = await normalizeForTripo(buffer);
  const form = new FormData();
  form.append('file', jpegBuffer, { filename: `${originalname}.jpg`, contentType: 'image/jpeg' });

  const res = await fetch(`${TRIPO_BASE}/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TRIPO_API_KEY}`,
      ...form.getHeaders(),
    },
    body: form,
  });

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await res.text();
    throw new Error(`Tripo upload returned a non-JSON response (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }

  const json = await res.json();
  if (json.code !== 0) {
    throw new Error(`Upload failed: ${json.message || JSON.stringify(json)}`);
  }
  return json.data.image_token || json.data.file_token;
}

app.post('/api/generate', upload.fields([
  { name: 'front', maxCount: 1 },
  { name: 'left', maxCount: 1 },
  { name: 'back', maxCount: 1 },
  { name: 'right', maxCount: 1 },
]), async (req, res) => {
  try {
    if (!TRIPO_API_KEY) {
      return res.status(500).json({ error: 'TRIPO_API_KEY not set on server' });
    }

    const files = req.files || {};
    const order = ['front', 'left', 'back', 'right'];
    const fileEntries = [];

    for (const slot of order) {
      const f = files[slot]?.[0];
      if (f) {
        const token = await uploadImageToTripo(f.buffer, f.originalname);
        fileEntries.push({ slot, type: 'jpg', file_token: token });
      } else {
        fileEntries.push(null);
      }
    }

    // Tripo's multiview_to_model rejects the task outright (400 "parameter
    // invalid") with fewer than 2 real images, confirmed via direct API
    // testing — this isn't just a quality recommendation, it's a hard floor.
    const providedCount = fileEntries.filter(Boolean).length;
    if (providedCount < 2) {
      return res.status(400).json({ error: 'At least 2 photos are required (front + one more angle).' });
    }

    const files_payload = fileEntries.map((entry) =>
      entry ? { type: entry.type, file_token: entry.file_token } : {}
    );

    const taskRes = await fetch(`${TRIPO_BASE}/task`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TRIPO_API_KEY}`,
      },
      body: JSON.stringify({
        type: 'multiview_to_model',
        files: files_payload,
        model_version: 'v2.5-20250123',
        texture: true,
        pbr: true,
      }),
    });

    const taskJson = await taskRes.json();
    if (taskJson.code !== 0) {
      return res.status(500).json({ error: taskJson.message || 'Task creation failed', raw: taskJson });
    }

    res.json({ task_id: taskJson.data.task_id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/task/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const r = await fetch(`${TRIPO_BASE}/task/${taskId}`, {
      headers: { Authorization: `Bearer ${TRIPO_API_KEY}` },
    });
    const json = await r.json();
    if (json.code !== 0) {
      return res.status(500).json({ error: json.message || 'Task status fetch failed', raw: json });
    }

    const data = json.data;
    res.json({
      status: data.status,
      progress: data.progress,
      task_id: data.task_id,
      model_url: data.output?.pbr_model || data.output?.model || null,
      rendered_image: data.output?.rendered_image || null,
      error_msg: data.error_msg || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Proxies the GLB so the browser doesn't hit Tripo's storage domain directly (CORS).
app.get('/api/model', async (req, res) => {
  try {
    const modelUrl = req.query.url;
    if (!modelUrl) {
      return res.status(400).json({ error: 'Missing url query parameter' });
    }

    if (!isSafeUrl(modelUrl)) {
      return res.status(400).json({ error: 'URL not allowed' });
    }

    const upstream = await fetch(modelUrl);
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `Upstream fetch failed: ${upstream.status}` });
    }

    res.set('Content-Type', upstream.headers.get('content-type') || 'model/gltf-binary');
    res.set('Access-Control-Allow-Origin', '*');
    upstream.body.pipe(res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Generates a stylized "AI sticker" illustration of an item from its
// reference photo, using OpenAI's gpt-image-2 image-to-image endpoint
// (images/edits). This is a best-effort enhancement on the client side — if
// this route fails, the client falls back to the real photo thumbnail rather
// than blocking the save/edit flow.
//
// Accepts either an uploaded file (new item, saved at the same time as the
// rest of the item) or a photoUrl (regenerating a sticker for an existing
// item, where we only have its Storage download URL, not a live File).
// Exactly one of the two must be provided.
app.post('/api/sticker', upload.single('photo'), async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY not set on server' });
    }

    const { photoUrl, name, type } = req.body;
    const hasFile = !!req.file;
    const hasUrl = typeof photoUrl === 'string' && photoUrl.length > 0;
    if (hasFile === hasUrl) {
      return res.status(400).json({ error: 'Provide exactly one of photo (file) or photoUrl' });
    }

    let sourceBuffer;
    if (hasFile) {
      sourceBuffer = req.file.buffer;
    } else {
      if (!isSafeUrl(photoUrl)) {
        return res.status(400).json({ error: 'photoUrl not allowed' });
      }
      const photoRes = await fetch(photoUrl);
      if (!photoRes.ok) {
        return res.status(400).json({ error: `Failed to fetch photoUrl: ${photoRes.status}` });
      }
      sourceBuffer = Buffer.from(await photoRes.arrayBuffer());
    }

    const jpegBuffer = await normalizeForSticker(sourceBuffer);

    const prompt = `Turn this photographed travel souvenir into a flat-vector sticker illustration: thick white die-cut border, solid pastel background, vibrant flat colors, single centered object, simple clean shading, no text or watermarks. Item: "${name || ''}" (${type || ''}).`;

    const form = new FormData();
    form.append('model', 'gpt-image-2');
    form.append('image[]', jpegBuffer, { filename: 'reference.jpg', contentType: 'image/jpeg' });
    form.append('prompt', prompt);
    form.append('size', '1024x1024');
    form.append('background', 'opaque');
    form.append('output_format', 'png');
    form.append('n', '1');

    const upstream = await fetch(`${OPENAI_BASE}/images/edits`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        ...form.getHeaders(),
      },
      body: form,
    });

    const json = await upstream.json();
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: json.error?.message || 'Sticker generation failed' });
    }

    const b64 = json.data?.[0]?.b64_json;
    if (!b64) {
      return res.status(500).json({ error: 'Sticker generation returned no image data' });
    }

    const pngBuffer = Buffer.from(b64, 'base64');
    res.set('Content-Type', 'image/png');
    res.send(pngBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Proxies Google's Places Autocomplete (New) so the API key stays server-side
// only (same rationale as the Tripo key: never ship a billed key in the
// client bundle). Used by the item Location field's city/country search.
app.get('/api/places/autocomplete', async (req, res) => {
  try {
    if (!GOOGLE_PLACES_API_KEY) {
      return res.status(500).json({ error: 'GOOGLE_PLACES_API_KEY not set on server' });
    }

    const input = typeof req.query.input === 'string' ? req.query.input.trim() : '';
    if (input.length < 2) {
      return res.json({ suggestions: [] });
    }

    const upstream = await fetch(`${PLACES_BASE}/places:autocomplete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
      },
      body: JSON.stringify({ input }),
    });

    const json = await upstream.json();
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: json.error?.message || 'Places autocomplete failed' });
    }

    const suggestions = (json.suggestions || [])
      .map((s) => s.placePrediction)
      .filter(Boolean)
      .map((p) => ({
        placeId: p.placeId,
        mainText: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
        secondaryText: p.structuredFormat?.secondaryText?.text ?? '',
      }));

    res.json({ suggestions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Tripo proxy server running at http://localhost:${PORT}`);
});
