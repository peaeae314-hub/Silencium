import React, { useEffect, useRef, memo } from 'react';

/**
 * Inline-only image renderer (MVP).
 *
 * Draws already-decrypted image data onto a canvas inside the message bubble.
 * Fullscreen viewer, zoom/pan, download, and context-menu "protection" are
 * intentionally out of scope (see CUT-LIST R2 / R17 / R18).
 */
const CanvasImageRenderer = memo(({ imageData, imageName }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageData) return;

    const ctx = canvas.getContext('2d');
    const img = new Image();

    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
    };

    img.onerror = () => {
      console.error('Failed to load decrypted image');
    };

    img.src = imageData;
  }, [imageData]);

  if (!imageData) {
    return <div>No image data</div>;
  }

  return (
    <canvas
      ref={canvasRef}
      title={imageName || 'Encrypted image'}
      style={{
        maxWidth: '100%',
        display: 'block',
        borderRadius: '8px',
      }}
    />
  );
});

CanvasImageRenderer.displayName = 'CanvasImageRenderer';

export default CanvasImageRenderer;
