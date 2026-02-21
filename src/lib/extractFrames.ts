export interface ExtractedFrame {
  dataUrl: string;
  timestamp: number;
}

export async function extractFramesFromVideo(
  file: File,
  maxFrames = 16,
  onProgress?: (progress: number) => void
): Promise<ExtractedFrame[]> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;

    const url = URL.createObjectURL(file);
    video.src = url;

    video.onloadedmetadata = async () => {
      const duration = video.duration;
      if (duration === 0 || !isFinite(duration)) {
        URL.revokeObjectURL(url);
        reject(new Error("Invalid video duration"));
        return;
      }

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d")!;

      // Scale down for efficiency
      const scale = Math.min(1, 512 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);

      const interval = duration / maxFrames;
      const frames: ExtractedFrame[] = [];

      for (let i = 0; i < maxFrames; i++) {
        const time = i * interval;
        try {
          await seekTo(video, time);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          frames.push({
            dataUrl: canvas.toDataURL("image/jpeg", 0.7),
            timestamp: time,
          });
          onProgress?.(((i + 1) / maxFrames) * 100);
        } catch {
          // Skip frame on error
        }
      }

      URL.revokeObjectURL(url);
      resolve(frames);
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load video. Unsupported format or corrupted file."));
    };
  });
}

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Seek timeout")), 5000);
    video.onseeked = () => {
      clearTimeout(timeout);
      resolve();
    };
    video.currentTime = time;
  });
}
