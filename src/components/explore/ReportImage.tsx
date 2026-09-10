"use client";

import { useEffect, useRef, useState } from "react";
import { ExploreLoading } from "./ExploreLoading";

/** Keep a figure's viewport steady while the browser fetches/decodes its image. */
export function ReportImage({ src, alt, height = 380 }: { src: string; alt: string; height?: number }) {
  const image = useRef<HTMLImageElement>(null);
  const [state, setState] = useState<{ src: string; failed: boolean } | null>(null);
  const settled = state?.src === src;
  useEffect(() => {
    const element = image.current;
    // A cached image may have loaded before React attached the event handlers.
    if (element?.complete) setState({ src, failed: element.naturalWidth === 0 });
  }, [src]);

  return <div className="relative flex w-full min-w-0 items-center justify-center overflow-hidden" style={{ height }} aria-busy={!settled || undefined}>
    {!settled && <div className="absolute inset-0"><ExploreLoading variant="chart" label={`Loading ${alt || "figure"}…`} height="100%" /></div>}
    {settled && state.failed && <p role="alert" className="p-4 text-center text-sm text-destructive">Could not load the image. <a href={src} target="_blank" rel="noopener noreferrer" className="underline">Open original</a></p>}
    {/* eslint-disable-next-line @next/next/no-img-element -- Authenticated artifact routes have no known intrinsic image dimensions. */}
    <img key={src} ref={image} src={src} alt={alt} loading="lazy" decoding="async" className={`h-full w-full object-contain ${settled && !state.failed ? "" : "absolute opacity-0"}`} style={{ maxHeight: height }}
      onLoad={event => { if (event.currentTarget === image.current) setState({ src, failed: false }); }} onError={event => { if (event.currentTarget === image.current) setState({ src, failed: true }); }} />
  </div>;
}
