// Client for the /api/classify-item endpoint (best-effort AI auto-detection
// of an item's Type field from its front photo — see server/index.js for the
// actual OpenAI vision call). Like stickerClient.ts's functions, this throws
// on failure; the caller is expected to treat it as an optional enhancement
// and silently fall back to leaving the Type field for the user to fill in
// themselves, never blocking the upload flow.

export async function classifyItemType(photo: File, signal?: AbortSignal): Promise<string> {
  const formData = new FormData();
  formData.append('photo', photo);

  const res = await fetch('/api/classify-item', { method: 'POST', body: formData, signal });
  if (!res.ok) {
    let message = 'Failed to classify item';
    try {
      const data = await res.json();
      message = data.error || message;
    } catch {
      // response wasn't JSON — keep the generic message
    }
    throw new Error(message);
  }
  const data = await res.json();
  const type = typeof data.type === 'string' ? data.type.trim() : '';
  if (!type) {
    throw new Error('Classification returned no result');
  }
  return type;
}
