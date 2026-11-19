import { Toaster as Sonner, type ToasterProps } from 'sonner'
// sonner injects its styles with a <style> tag at runtime, which the packaged app's
// CSP blocks (Tauri's style nonce disables 'unsafe-inline'). Ship them as a file.
import 'sonner/dist/styles.css'

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast border border-border/70 bg-card text-foreground shadow-lg',
          description: 'text-muted-foreground',
          actionButton: 'bg-primary text-primary-foreground',
          cancelButton: 'bg-muted text-muted-foreground',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
