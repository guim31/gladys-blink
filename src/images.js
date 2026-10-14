// -----------------------------------------------------------------------------
// Thumbnails within the limits of Gladys: 150 KB for a camera image
// (publishCameraImage, onGetImage: the base64 string), 300 KB for a widget
// image (decoded). A Blink
// thumbnail is usually far below; a larger one (a 2K camera, a detailed
// scene) is halved and re-encoded with jpeg-js (pure JavaScript, no native
// build) until it fits. Rare, and bounded: a 2K frame decodes in ~15 MB.
// -----------------------------------------------------------------------------

import jpeg from 'jpeg-js';

const CAMERA_PREFIX = 'image/jpg;base64,';
// The 150 KB of the camera channel bound the whole `image/jpg;base64,…`
// string (the SDK and the core measure the string): ~112 KB of JPEG.
export const CAMERA_IMAGE_MAX_BYTES = Math.floor((150 * 1024 - CAMERA_PREFIX.length) / 4) * 3;
export const WIDGET_IMAGE_MAX_BYTES = 300 * 1024;

const MIN_WIDTH = 160;
const QUALITY = 75;

/** Is it a JPEG (magic number FF D8 FF)? */
export function isJpeg(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8;
}

/** Halve an RGBA image (2×2 box average). */
function halve({ width, height, data }) {
  const w = Math.max(1, Math.floor(width / 2));
  const h = Math.max(1, Math.floor(height / 2));
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      for (let c = 0; c < 4; c += 1) {
        const at = (yy, xx) =>
          data[(Math.min(yy, height - 1) * width + Math.min(xx, width - 1)) * 4 + c];
        out[(y * w + x) * 4 + c] =
          (at(2 * y, 2 * x) +
            at(2 * y, 2 * x + 1) +
            at(2 * y + 1, 2 * x) +
            at(2 * y + 1, 2 * x + 1)) >>
          2;
      }
    }
  }
  return { width: w, height: h, data: out };
}

/**
 * The JPEG itself when it fits in `maxBytes`, else a smaller copy.
 * @returns {Buffer|null} null when it is not a JPEG or cannot be made to fit
 */
export function fitJpeg(buffer, maxBytes) {
  if (!isJpeg(buffer)) {
    return null;
  }
  if (buffer.length <= maxBytes) {
    return buffer;
  }
  let image;
  try {
    image = jpeg.decode(buffer, { useTArray: false, maxMemoryUsageInMB: 64, formatAsRGBA: true });
  } catch {
    return null;
  }
  while (image.width > MIN_WIDTH) {
    image = halve(image);
    const encoded = jpeg.encode(image, QUALITY).data;
    if (encoded.length <= maxBytes) {
      return Buffer.from(encoded);
    }
  }
  return null;
}

/** The `image/jpg;base64,…` string of the camera channel of Gladys. */
export const cameraImage = (buffer) => `${CAMERA_PREFIX}${buffer.toString('base64')}`;
