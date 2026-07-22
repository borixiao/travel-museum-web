export type Generated2DStyle = 'hand-drawn-diary' | 'fridge-magnet';

export interface Generated2DImage {
  style: Generated2DStyle;
  label: string;
  mimeType: string;
  b64Json: string;
}

interface Generate2DResponse {
  images?: Generated2DImage[];
  error?: string;
}

export async function get2DImageApiStatus(): Promise<boolean> {
  const response = await fetch('/api/generate-2d/status');
  if (!response.ok) return false;
  const data = (await response.json()) as { configured?: boolean };
  return data.configured === true;
}

export async function generate2DImages(image: File): Promise<Generated2DImage[]> {
  const formData = new FormData();
  formData.append('image', image);

  const response = await fetch('/api/generate-2d', {
    method: 'POST',
    body: formData,
  });
  const data = (await response.json()) as Generate2DResponse;
  if (!response.ok) {
    throw new Error(data.error || 'Failed to generate 2D images');
  }
  if (!data.images || data.images.length === 0) {
    throw new Error('The image API returned no results');
  }
  return data.images;
}

export function generatedImageDataUrl(image: Generated2DImage): string {
  return `data:${image.mimeType};base64,${image.b64Json}`;
}
