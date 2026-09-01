// Client-side image preprocessing for scanned book pages: downscale, best-effort
// perspective correction (via OpenCV.js/jscanify), then grayscale + contrast
// stretch to improve OCR accuracy before upload.

const MAX_DIMENSION = 2200
const CV_LOAD_TIMEOUT_MS = 8000

let cvReadyPromise = null

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), ms)),
  ])
}

async function loadCv() {
  if (!cvReadyPromise) {
    cvReadyPromise = (async () => {
      const cvModule = (await import('@techstark/opencv-js')).default
      if (cvModule instanceof Promise) return cvModule
      if (cvModule.Mat) return cvModule
      await new Promise((resolve) => {
        cvModule.onRuntimeInitialized = resolve
      })
      return cvModule
    })()
  }
  return cvReadyPromise
}

async function loadBitmap(file) {
  return createImageBitmap(file, { imageOrientation: 'from-image' })
}

function drawToCanvas(bitmap) {
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas
}

// findPaperContour() just Canny-edge-detects and picks the single largest
// contour by area, with no check on whether that's actually most of the
// frame. On an image without a strong page-vs-background edge (e.g. a flat
// desktop scan, or a photo on a similarly-colored surface), it can lock onto
// a small spurious region — and extractPaper() will happily warp that tiny
// crop to fill the whole output, destroying the real page content instead
// of correcting it. Require the detected region to cover most of the frame
// before trusting it.
const MIN_PAPER_AREA_RATIO = 0.35

/** Best-effort perspective correction: finds the page edges and un-warps them flat. */
async function tryPerspectiveCorrect(canvas) {
  let cvImg
  try {
    const cv = await withTimeout(loadCv(), CV_LOAD_TIMEOUT_MS)
    window.cv = cv
    const JScanify = (await import('jscanify/client')).default
    const scanner = new JScanify()

    cvImg = cv.imread(canvas)
    const contour = scanner.findPaperContour(cvImg)
    if (!contour) return canvas

    const areaRatio = cv.contourArea(contour) / (cvImg.rows * cvImg.cols)
    if (areaRatio < MIN_PAPER_AREA_RATIO) {
      console.warn(
        `Perspective correction skipped: detected region only covers ${(areaRatio * 100).toFixed(1)}% of the frame.`
      )
      return canvas
    }

    const extracted = scanner.extractPaper(canvas, canvas.width, canvas.height)
    return extracted || canvas
  } catch (err) {
    console.warn('Perspective correction unavailable, continuing without it:', err)
    return canvas
  } finally {
    cvImg?.delete()
  }
}

/** Grayscale + percentile contrast stretch, in place on the canvas. */
function applyGrayscaleContrast(canvas) {
  const ctx = canvas.getContext('2d')
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const { data } = imageData
  const pixelCount = data.length / 4
  const luminance = new Uint8ClampedArray(pixelCount)

  for (let i = 0; i < pixelCount; i++) {
    const o = i * 4
    luminance[i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]
  }

  const histogram = new Uint32Array(256)
  for (let i = 0; i < pixelCount; i++) histogram[luminance[i]]++

  const clipCount = pixelCount * 0.02
  let lo = 0
  let acc = 0
  while (lo < 255 && (acc += histogram[lo]) < clipCount) lo++
  let hi = 255
  acc = 0
  while (hi > 0 && (acc += histogram[hi]) < clipCount) hi--
  if (hi <= lo) {
    lo = 0
    hi = 255
  }
  const range = hi - lo || 1

  for (let i = 0; i < pixelCount; i++) {
    const stretched = Math.max(0, Math.min(255, ((luminance[i] - lo) / range) * 255))
    const o = i * 4
    data[o] = data[o + 1] = data[o + 2] = stretched
  }

  ctx.putImageData(imageData, 0, 0)
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas export failed'))),
      type,
      quality
    )
  })
}

/**
 * Preprocess a captured page photo for OCR: downscale, correct perspective,
 * and enhance contrast. Falls back gracefully at every optional step so a
 * slow/unsupported device still gets a usable (if less-corrected) image.
 * @param {File} file
 * @returns {Promise<Blob>}
 */
export async function preprocessPageImage(file) {
  const bitmap = await loadBitmap(file)
  let canvas = drawToCanvas(bitmap)
  canvas = await tryPerspectiveCorrect(canvas)
  applyGrayscaleContrast(canvas)
  return canvasToBlob(canvas, 'image/jpeg', 0.85)
}
