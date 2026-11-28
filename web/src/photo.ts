/**
 * A photo scaled down in the browser (JPEG) before it is sent anywhere. Meals need 1024 px on the longest side; a
 * nutrition label has small print, so it gets more.
 */
export async function resizePhoto(file: File, max = 1024, quality = 0.8): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const f = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * f);
  canvas.height = Math.round(bitmap.height * f);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', quality);
}
