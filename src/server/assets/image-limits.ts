/**
 * Phone cameras save 48-108 MP photos. Decoding is shrink-on-load, so this
 * bounds memory without refusing a person's ordinary camera photo. Every
 * place that opens a person's own photo uses it, so a photo that uploads
 * also renders.
 */
export const PHOTO_PIXEL_LIMIT = 120_000_000;
