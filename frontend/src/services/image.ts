import api from './api';

/**
 * Upload an image file
 * @param file - The image file to upload
 * @param postSlug - Optional post slug to associate with the image
 * @returns The upload response with image filepath
 */
export async function uploadImage(file: File, postSlug?: string): Promise<{ filepath: string }> {
  const formData = new FormData();
  formData.append('file', file);
  
  if (postSlug) {
    formData.append('post_slug', postSlug);
  }

  const response = await api.post<{ filepath: string }>('/images/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });

  return response.data;
}

/**
 * Get the full URL for an image filepath
 * @param filepath - The image filepath returned from upload
 * @returns The full URL to the image
 */
export function getImageUrl(filepath: string): string {
  return `/api/images/${filepath}`;
}
