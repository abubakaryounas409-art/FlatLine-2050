// =============================================================================
// FLATLINE: 2050 — showcase/index.js
// Entry point for the Settings → Media videos:
//
//   const recorder = record ? startRecorder() : null;   // in the click handler
//   await playShowcase('teaser' | 'reel', { recorder });
//
// Both videos expect a black screen and end on black (the caller rebuilds the
// menu garage). They never throw: a failure is logged and the video ends.
// =============================================================================

import { playStoryTeaser } from './teaser.js';
import { playGameplayReel } from './gameplayReel.js';
import { startRecorder, canRecord } from './recorder.js';

export const SHOWCASE_VIDEOS = {
  teaser: { title: 'Story Teaser', play: playStoryTeaser, file: 'flatline2050_story_teaser' },
  reel: { title: 'Gameplay Overview', play: playGameplayReel, file: 'flatline2050_gameplay' },
};

export { startRecorder, canRecord };

/**
 * @param {'teaser'|'reel'} id
 * @param {object} [o]
 * @param {Promise|null} [o.recorder]  from startRecorder() (started inside the click)
 * @param {string} [o.from]            dev: jump to a section
 */
export async function playShowcase(id, { recorder = null, from = null } = {}) {
  const video = SHOWCASE_VIDEOS[id];
  if (!video) return { completed: false };
  const rec = recorder ? await recorder : null;
  let result = { completed: false };
  try {
    result = await video.play({ from });
  } catch (err) {
    console.error(`[showcase] ${id} failed:`, err);
  }
  if (rec) await rec.finish(video.file).catch((err) => console.warn('[recorder] save failed', err));
  return result;
}
