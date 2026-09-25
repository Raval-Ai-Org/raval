export type VideoQualityCheck = {
  validResultUrl: boolean;
  https: boolean;
  passed: boolean;
};

export function checkVideoResult(videoUrl: string): VideoQualityCheck {
  const https = /^https:\/\//i.test(videoUrl);
  const validResultUrl = https && videoUrl.length <= 4096;
  return { validResultUrl, https, passed: validResultUrl };
}
