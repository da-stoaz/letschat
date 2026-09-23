import { useEffect, useRef } from 'react'
import { attachInlineVideo } from './inlineVideoSession'

type InlineVideoProps = {
  url: string
  startAt: number
  /** Called with the position to resume from once the player should unload. */
  onStop: (position: number) => void
}

/**
 * The only place a chat video element exists. It unloads — which is what makes
 * WebKit abort the in-flight range download — when playback ends, stays
 * paused, or scrolls out of view. Resuming continues from `startAt`.
 */
export function InlineVideo({ url, startAt, onStop }: InlineVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    return video ? attachInlineVideo(video, url, startAt, onStop) : undefined
  }, [url, startAt, onStop])

  return <video ref={videoRef} autoPlay controls className="max-h-56 w-full bg-black" />
}
