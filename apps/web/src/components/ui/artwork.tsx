"use client";

import type { ImageRef } from "@app/shared";
import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils";

const UNOPTIMIZED = process.env.NEXT_PUBLIC_IMAGE_UNOPTIMIZED === "1";

interface ArtworkProps {
  image: ImageRef | null | undefined;
  alt: string;
  sizes: string;
  className?: string;
  imgClassName?: string;
  /** Above-the-fold artwork (billboard, open modal) */
  preload?: boolean;
  /** Text shown when there is no artwork */
  fallbackLabel?: string;
  quality?: 60 | 75 | 85;
}

function placeholderStyle(blur: string | null | undefined): React.CSSProperties {
  if (!blur) return {};
  if (blur.startsWith("#") || blur.startsWith("rgb")) return { backgroundColor: blur };
  if (blur.startsWith("data:")) return { backgroundImage: `url("${blur}")`, backgroundSize: "cover", backgroundPosition: "center" };
  return {};
}

/**
 * Fills its (positioned) parent with artwork. Uses the ImageRef blur/colour as an instant
 * placeholder, fades the real image in, and degrades to a branded gradient when missing/broken.
 */
export function Artwork({ image, alt, sizes, className, imgClassName, preload, fallbackLabel, quality = 75 }: ArtworkProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const showImage = !!image?.url && !failed;

  return (
    <div className={cn("absolute inset-0 overflow-hidden bg-[#232323]", className)} style={placeholderStyle(image?.blur)}>
      {showImage ? (
        <Image
          src={image.url}
          alt={alt}
          fill
          sizes={sizes}
          quality={quality}
          preload={preload}
          loading={preload ? undefined : "lazy"}
          unoptimized={UNOPTIMIZED}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn("object-cover transition-opacity duration-500", loaded ? "opacity-100" : "opacity-0", imgClassName)}
        />
      ) : (
        <div className="absolute inset-0 flex items-end bg-[radial-gradient(120%_90%_at_10%_0%,rgb(255_90_60/0.35),transparent_60%),linear-gradient(135deg,#2a2a2a,#121212)] p-[8%]">
          {fallbackLabel && <span className="line-clamp-2 text-[clamp(0.8rem,1.1vw,1.15rem)] font-bold text-white/90">{fallbackLabel}</span>}
        </div>
      )}
    </div>
  );
}
