// =============================================================================
// FLATLINE: 2050 — showcase/recorder.js
// "Record to video" for the Media videos: captures THIS browser tab (the 3D
// canvas, every title card / subtitle / HUD overlay, and the game's sound)
// with getDisplayMedia + MediaRecorder, then downloads a .webm file.
//
//   const rec = await startRecorder();      // must start from the click (browser rule)
//   ...play...
//   await rec?.finish('flatline2050_teaser');
//
// The browser asks which tab to share — pick this one ("Share this tab" with
// "Share tab audio" on). If the player cancels, the video simply plays.
// =============================================================================

const MIME_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

export function canRecord() {
  return !!(navigator.mediaDevices?.getDisplayMedia && window.MediaRecorder);
}

/** Ask for the tab and start recording. Resolves a recorder, or null (unsupported / cancelled). */
export async function startRecorder() {
  if (!canRecord()) {
    console.warn('[recorder] this browser cannot record the tab (needs getDisplayMedia + MediaRecorder)');
    return null;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 60 }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false },
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
      surfaceSwitching: 'exclude',
      systemAudio: 'include',
    });
  } catch (err) {
    console.info('[recorder] recording cancelled:', err?.message ?? err);
    return null;
  }
  const mimeType = MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
  let rec;
  try {
    rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 14_000_000, audioBitsPerSecond: 192_000 });
  } catch (err) {
    console.warn('[recorder] MediaRecorder failed:', err);
    stream.getTracks().forEach((t) => t.stop());
    return null;
  }
  const chunks = [];
  rec.ondataavailable = (e) => e.data?.size && chunks.push(e.data);
  rec.start(1000);
  return {
    stream,
    /** Stop, then download the file. */
    async finish(name = 'flatline2050') {
      if (rec.state !== 'inactive') {
        await new Promise((resolve) => {
          rec.onstop = resolve;
          try {
            rec.stop();
          } catch {
            resolve();
          }
        });
      }
      stream.getTracks().forEach((t) => t.stop());
      if (!chunks.length) return false;
      const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name}.webm`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return true;
    },
  };
}
