// Client for the /api/sticker endpoint (best-effort gpt-image-2 "AI sticker"
// generation — see server/index.js for the actual OpenAI call). Both
// functions throw on failure; callers are expected to treat sticker
// generation as optional and fall back to the real photo on error rather
// than letting it block a save/edit flow.

async function parseStickerResponse(res: Response): Promise<Blob> {
  if (!res.ok) {
    let message = 'Failed to generate sticker';
    try {
      const data = await res.json();
      message = data.error || message;
    } catch {
      // response wasn't JSON — keep the generic message
    }
    throw new Error(message);
  }
  return res.blob();
}

export async function generateStickerFromFile(photo: File, name: string, type: string): Promise<Blob> {
  const formData = new FormData();
  formData.append('photo', photo);
  formData.append('name', name);
  formData.append('type', type);

  const res = await fetch('/api/sticker', { method: 'POST', body: formData });
  return parseStickerResponse(res);
}

export async function generateStickerFromUrl(photoUrl: string, name: string, type: string): Promise<Blob> {
  const formData = new FormData();
  formData.append('photoUrl', photoUrl);
  formData.append('name', name);
  formData.append('type', type);

  const res = await fetch('/api/sticker', { method: 'POST', body: formData });
  return parseStickerResponse(res);
}
