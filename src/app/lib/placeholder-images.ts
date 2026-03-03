import data from './placeholder-images.json';

export type ImagePlaceholder = {
  id: string;
  description: string;
  imageUrl: string;
  imageHint: string;
};

// Aseguramos que PlaceHolderImages sea siempre un array para evitar errores de .find()
export const PlaceHolderImages: ImagePlaceholder[] = data.placeholderImages || [];
