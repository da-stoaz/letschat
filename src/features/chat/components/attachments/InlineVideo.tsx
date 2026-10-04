import { useEffect, useRef, useState } from 'react'
import { Loader2Icon, PictureInPicture2Icon, PlayIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { authServiceVideoPlayback } from '@/lib/authService'
import { getSignedDownloadUrl, invalidateSignedDownloadUrl } from '@/lib/downloadUrls'
import { withSessionTokenRetry } from '@/lib/uploadSession'
import { attachInlineVideo } from './inlineVideoSession'
import { observeVideoPresentation, videoSize } from './videoPresentation'

export type VideoSource = { url: string; storageKey: string; fileName: string; poster?: string | null; aspectRatio?: number }
type InlineVideoProps = VideoSource & {
  startAt: number
  onStop: (position: number) => void
  onPopOut?: (position: number) => void
  persistent?: boolean
  expanded?: boolean
  onAspectRatio?: (ratio: number) => void
}

/** Mount on Play; let native media controls paint above the native poster. */
export function InlineVideo({ url, storageKey, fileName, poster, aspectRatio = 16 / 9, startAt, onStop, onPopOut, persistent = false, expanded = false, onAspectRatio }: InlineVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const resumePosition = useRef(startAt)
  const resumeAutoplay = useRef(true)
  const [frame, setFrame] = useState(false)
  const [missingPicture, setMissingPicture] = useState(false)
  const [buffering, setBuffering] = useState(true)
  const [blocked, setBlocked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pipError, setPipError] = useState(false)
  const [inPip, setInPip] = useState(false)
  const [original, setOriginal] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [ratio, setRatio] = useState(aspectRatio)
  const [processing, setProcessing] = useState(false)
  const [sourceLabel, setSourceLabel] = useState('Preparing playback…')

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let disposed = false
    let teardown: (() => void) | undefined
    let refresh: ReturnType<typeof setTimeout> | undefined
    const fail = () => { setError('Video could not be played. Try again or play the original.'); setBuffering(false) }
    const load = async (position: number, autoplay = true) => {
      try {
        const playback = original ? null : await withSessionTokenRetry(sessionToken => authServiceVideoPlayback({ sessionToken, storageKey }))
        if (!playback?.url) invalidateSignedDownloadUrl(storageKey)
        const sourceUrl = playback?.url ?? await getSignedDownloadUrl(storageKey)
        if (disposed) return
        teardown?.()
        setError(null)
        setFrame(false)
        setMissingPicture(false)
        setBuffering(autoplay)
        setBlocked(!autoplay)
        setProcessing(playback?.state === 'processing')
        setSourceLabel(playback?.url ? 'Adaptive streaming' : playback?.state === 'processing' ? 'Original · streaming version is being prepared' : 'Original')
        teardown = attachInlineVideo(video, sourceUrl, position, onStop, {
          hls: Boolean(playback?.url), originalUrl: url, persistent, autoplay,
          onError: fail,
          onBlocked: () => { setBlocked(true); setBuffering(false) },
        })
        // Renew the scoped grant before expiry, including for long videos.
        refresh = setTimeout(() => { void load(video.currentTime, !video.paused) }, 50 * 60_000)
      } catch {
        if (!disposed) fail()
      }
    }
    void load(resumePosition.current, resumeAutoplay.current)
    return () => {
      disposed = true
      resumePosition.current = video.currentTime || resumePosition.current
      clearTimeout(refresh)
      teardown?.()
    }
  }, [url, storageKey, startAt, onStop, original, attempt, persistent])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    return observeVideoPresentation(video, {
      onFrame: () => setFrame(true),
      onMissingPicture: setMissingPicture,
      onBuffering: setBuffering,
      onRatio: ratio => { setRatio(ratio); onAspectRatio?.(ratio) },
    })
  }, [onAspectRatio])

  useEffect(() => {
    if (!processing || original) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    const check = async () => {
      try {
        const result = await withSessionTokenRetry(sessionToken => authServiceVideoPlayback({ sessionToken, storageKey }))
        if (disposed) return
        if (result.state === 'ready') {
          resumeAutoplay.current = !videoRef.current?.paused
          setAttempt(value => value + 1)
          return
        }
        if (result.state === 'unavailable') { setProcessing(false); setSourceLabel('Original'); return }
      } catch { /* Playback continues; a temporary status failure is retried. */ }
      if (!disposed) timer = setTimeout(() => { void check() }, 15_000)
    }
    timer = setTimeout(() => { void check() }, 15_000)
    return () => { disposed = true; clearTimeout(timer) }
  }, [processing, original, storageKey])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const enter = () => setInPip(true)
    const leave = () => setInPip(false)
    video.addEventListener('enterpictureinpicture', enter)
    video.addEventListener('leavepictureinpicture', leave)
    return () => {
      video.removeEventListener('enterpictureinpicture', enter)
      video.removeEventListener('leavepictureinpicture', leave)
    }
  }, [])

  const pipSupported = typeof document !== 'undefined' && document.pictureInPictureEnabled
  return (
    <div className="flex w-full min-w-0 flex-col items-center">
      <div className="relative max-w-full overflow-hidden rounded-md bg-black" style={videoSize(ratio, expanded ? 78 : persistent ? 40 : 60)}>
        <video ref={videoRef} aria-label={fileName} controls playsInline disablePictureInPicture={Boolean(onPopOut)} preload="none" poster={poster ?? undefined}
          className="absolute inset-0 h-full w-full object-contain"
          onPlaying={() => { setBlocked(false); setError(null) }}
        />
        {inPip ? <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-muted p-4 text-center text-sm">Playing in picture in picture</div> : null}
        {error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 p-3 text-center text-sm text-white" role="alert">
            <p>{error}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => { resumeAutoplay.current = true; setAttempt(value => value + 1) }}>Retry</Button>
              {!original ? <Button variant="secondary" size="sm" onClick={() => { resumeAutoplay.current = true; setOriginal(true) }}>Play original</Button> : null}
            </div>
          </div>
        ) : blocked ? (
          <button type="button" aria-label={`Play ${fileName}`} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full focus-visible:outline-2 focus-visible:outline-primary" onClick={() => { void videoRef.current?.play().catch(() => setBlocked(true)) }}>
            <PlayIcon className="size-14 rounded-full bg-black/60 p-3 text-white" />
          </button>
        ) : buffering ? <div role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center"><Loader2Icon className="size-10 animate-spin rounded-full bg-black/60 p-2 text-white" /><span className="sr-only">Loading video…</span></div> : null}
      </div>
      <div className="flex w-full flex-wrap items-center justify-between gap-1 px-2 py-1">
        <span className="text-xs text-muted-foreground" aria-live="polite">{sourceLabel}</span>
        {onPopOut ? <Button size="sm" variant="ghost" onClick={() => onPopOut(videoRef.current?.currentTime ?? startAt)}><PictureInPicture2Icon className="size-4" />Pop out</Button> : pipSupported ? (
          <Button size="sm" variant="ghost" disabled={!frame} onClick={() => {
            const video = videoRef.current
            if (video) void (document.pictureInPictureElement === video ? document.exitPictureInPicture() : video.requestPictureInPicture()).catch(() => setPipError(true))
          }}><PictureInPicture2Icon className="size-4" />{inPip ? 'Return to player' : 'Picture in picture'}</Button>
        ) : null}
      </div>
      {missingPicture ? <p role="status" className="px-2 pb-2 text-sm text-muted-foreground">
        {processing ? 'This browser is playing audio without a video picture. Playback will switch when the streaming version is ready.' : 'No video picture has loaded. You can save the original and open it in another player.'}
      </p> : null}
      {pipError ? <p role="status" className="px-2 pb-2 text-xs text-muted-foreground">Picture-in-picture is unavailable. You can keep watching here.</p> : null}
    </div>
  )
}
