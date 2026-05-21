import { useEffect, useState } from "react";
import NeutralPreview from "./NeutralPreview";
import { resolveExerciseMedia } from "../media/ExerciseMediaProvider";

export default function ExerciseMedia({ exercise, className = "", compact = false }) {
  const [retry, setRetry] = useState(0);
  const media = resolveExerciseMedia(exercise);
  const mediaKey = media.video || exercise?.rf_video_url || exercise?.video_url || exercise?.exercise_name || exercise?.name || "neutral";
  const videoSrc = retry && media.video ? `${media.video}${media.video.includes("?") ? "&" : "?"}retry=${retry}` : media.video;

  useEffect(() => {
    setRetry(0);
  }, [mediaKey]);

  return (
    <div className={`relative overflow-hidden rounded-2xl bg-[#172018] ${className}`}>
      {compact && media.preview ? (
        <img
          src={media.preview}
          alt={exercise?.exercise_name || ""}
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
        />
      ) : compact ? (
        <NeutralPreview compact={compact} className="h-full w-full rounded-none border-0" />
      ) : media.video ? (
        <video
          key={mediaKey}
          src={videoSrc}
          poster={media.preview || undefined}
          controls
          playsInline
          preload="metadata"
          crossOrigin="anonymous"
          onError={() => setRetry((value) => (value < 2 ? value + 1 : value))}
          className="h-full w-full object-cover"
        />
      ) : media.preview ? (
        <img
          src={media.preview}
          alt={exercise?.exercise_name || ""}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <NeutralPreview compact={compact} className="h-full w-full rounded-none border-0" />
      )}
    </div>
  );
}
