/**
 * @param {Blob} imageBlob
 * @returns {Promise<{ text: string, lowConfidence: boolean, uncertainPassages: string[] }>}
 */
export async function ocrImage(imageBlob) {
  const formData = new FormData()
  formData.append('image', imageBlob, 'page.jpg')

  let response
  try {
    response = await fetch('/ocr', { method: 'POST', body: formData })
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.')
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error || 'OCR failed, please retry.')
  }

  return response.json()
}
