export const CELEBRATIONS = [
  "amazing_animation.mp4",
  "excellent_animation.mp4",
  "nice_work_animation.mp4",
  "good_job_animation.mp4",
  "fantastic_animation.mp4",
  "well_done_animation.mp4",
].map((fileName) => ({
  assetId: fileName.replace(/\.mp4$/, ""),
  assetUrl: `/celebrations/${fileName}`,
}));

export function chooseCelebration(random = Math.random) {
  const index = Math.floor(random() * CELEBRATIONS.length);
  return structuredClone(CELEBRATIONS[index]);
}
