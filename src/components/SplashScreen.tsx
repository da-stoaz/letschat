import { LoaderCircleIcon } from 'lucide-react'

export function SplashScreen() {
  return (
    <main className="grid min-h-screen place-items-center bg-[radial-gradient(1200px_800px_at_10%_-20%,theme(colors.blue.500/20),transparent),radial-gradient(900px_700px_at_100%_0%,theme(colors.cyan.500/15),transparent)]">
      <div className="flex flex-col items-center gap-4 animate-in fade-in duration-500">
        <LoaderCircleIcon className="size-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground tracking-wide">LetsChat</p>
      </div>
    </main>
  )
}
