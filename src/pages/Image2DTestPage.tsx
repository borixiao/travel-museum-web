import { useEffect, useState, type FormEvent } from 'react';
import ProgressBar from '../components/ProgressBar';
import {
  generate2DImages,
  generatedImageDataUrl,
  get2DImageApiStatus,
  type Generated2DImage,
} from '../services/image2dClient';

type ApiStatus = 'checking' | 'ready' | 'missing';

export default function Image2DTestPage() {
  const [image, setImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [results, setResults] = useState<Generated2DImage[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking');

  useEffect(() => {
    let cancelled = false;
    get2DImageApiStatus()
      .then((configured) => {
        if (!cancelled) setApiStatus(configured ? 'ready' : 'missing');
      })
      .catch(() => {
        if (!cancelled) setApiStatus('missing');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!image) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(image);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!image || apiStatus !== 'ready') return;

    setGenerating(true);
    setError(null);
    try {
      setResults(await generate2DImages(image));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image generation failed');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 20, marginBottom: 8 }}>2D Image Test</h1>
      <p style={{ color: '#888', marginBottom: 12 }}>
        Upload one photo to generate a hand-drawn diary image and a travel fridge magnet with GPT Image 2.
      </p>

      <p
        role="status"
        style={{
          color: apiStatus === 'ready' ? '#2f9e63' : apiStatus === 'missing' ? '#d85858' : '#888',
          fontSize: 13,
          marginBottom: 18,
        }}
      >
        {apiStatus === 'checking'
          ? 'Checking image API configuration…'
          : apiStatus === 'ready'
            ? 'OpenRouter API key is configured on the server.'
            : 'OPENROUTER_API_KEY is missing from server/.env.'}
      </p>

      <form onSubmit={handleSubmit}>
        <label
          htmlFor="image-2d-upload"
          style={{
            display: 'block',
            border: '1px dashed #666',
            borderRadius: 8,
            padding: 16,
            cursor: 'pointer',
            textAlign: 'center',
          }}
        >
          {previewUrl ? (
            <>
              <img
                src={previewUrl}
                alt="Selected upload preview"
                style={{ display: 'block', width: '100%', maxHeight: 360, objectFit: 'contain', marginBottom: 8 }}
              />
              <span style={{ fontSize: 12 }}>{image?.name}</span>
            </>
          ) : (
            <span>Choose a JPG, PNG, or WebP photo</span>
          )}
        </label>
        <input
          id="image-2d-upload"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style={{ display: 'none' }}
          onChange={(event) => {
            setImage(event.target.files?.[0] ?? null);
            setResults([]);
            setError(null);
          }}
        />

        <button type="submit" disabled={!image || generating || apiStatus !== 'ready'} style={{ marginTop: 16 }}>
          {generating ? 'Generating two images…' : results.length > 0 ? 'Generate again' : 'Generate 2D images'}
        </button>
      </form>

      {generating && (
        <div style={{ marginTop: 16 }} aria-live="polite">
          <ProgressBar />
          <p style={{ color: '#888', fontSize: 12, marginTop: 8 }}>Two paid image requests are running. This can take a few minutes.</p>
        </div>
      )}
      {error && <p role="alert" style={{ color: 'crimson', marginTop: 12 }}>{error}</p>}

      {results.length > 0 && (
        <section aria-label="Generated 2D images" style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 18 }}>Generated images</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
            {results.map((result) => {
              const dataUrl = generatedImageDataUrl(result);
              return (
                <figure key={result.style} style={{ margin: 0, border: '1px solid #444', borderRadius: 8, padding: 10 }}>
                  <img src={dataUrl} alt={result.label} style={{ width: '100%', display: 'block', borderRadius: 6 }} />
                  <figcaption style={{ marginTop: 8 }}>
                    <strong>{result.label}</strong>{' '}
                    <a href={dataUrl} download={`${result.style}.png`} style={{ marginLeft: 8 }}>Download</a>
                  </figcaption>
                </figure>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
