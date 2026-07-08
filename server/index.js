import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fetch from 'node-fetch';
import FormData from 'form-data';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const PORT = process.env.PORT || 3001;
const TRIPO_API_KEY = process.env.TRIPO_API_KEY;
const TRIPO_BASE = 'https://api.tripo3d.ai/v2/openapi';

app.use(cors());
app.use(express.json());

async function uploadImageToTripo(buffer, originalname, mimetype) {
  const form = new FormData();
  form.append('file', buffer, { filename: originalname, contentType: mimetype });

  const res = await fetch(`${TRIPO_BASE}/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TRIPO_API_KEY}`,
      ...form.getHeaders(),
    },
    body: form,
  });

  const json = await res.json();
  if (json.code !== 0) {
    throw new Error(`Upload failed: ${json.message || JSON.stringify(json)}`);
  }
  return json.data.image_token || json.data.file_token;
}

function extToType(filename, mimetype) {
  if (mimetype === 'image/png') return 'png';
  if (mimetype === 'image/jpeg' || mimetype === 'image/jpg') return 'jpg';
  const ext = filename.split('.').pop().toLowerCase();
  if (ext === 'png') return 'png';
  return 'jpg';
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
        const type = extToType(f.originalname, f.mimetype);
        const token = await uploadImageToTripo(f.buffer, f.originalname, f.mimetype);
        fileEntries.push({ slot, type, file_token: token });
      } else {
        fileEntries.push(null);
      }
    }

    const providedCount = fileEntries.filter(Boolean).length;
    if (providedCount < 1) {
      return res.status(400).json({ error: 'At least one photo is required (front recommended).' });
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

    let parsed;
    try {
      parsed = new URL(modelUrl);
    } catch {
      return res.status(400).json({ error: 'Invalid url' });
    }
    const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
    if (parsed.protocol !== 'https:' || blockedHosts.includes(parsed.hostname) || parsed.hostname.startsWith('169.254.') || parsed.hostname.startsWith('192.168.') || parsed.hostname.startsWith('10.')) {
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

app.listen(PORT, () => {
  console.log(`Tripo proxy server running at http://localhost:${PORT}`);
});
