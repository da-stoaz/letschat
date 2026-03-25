import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangleIcon, RefreshCwIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface AppErrorBoundaryProps {
  children: ReactNode
}

interface AppErrorBoundaryState {
  hasError: boolean
  message: string
  componentStack: string
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    hasError: false,
    message: '',
    componentStack: '',
  }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return {
      hasError: true,
      message: error.message,
      componentStack: '',
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('App crashed', error, info.componentStack)
    this.setState({ componentStack: info.componentStack ?? '' })
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <main className="min-h-screen bg-[radial-gradient(1200px_800px_at_10%_-20%,theme(colors.blue.500/20),transparent),radial-gradient(900px_700px_at_100%_0%,theme(colors.cyan.500/15),transparent)] p-4 text-foreground">
        <div className="mx-auto grid min-h-[calc(100vh-2rem)] max-w-3xl place-items-center">
          <Card className="w-full border-border/70 bg-card/85 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-2xl">
                <AlertTriangleIcon className="size-6 text-destructive" />
                Something went wrong
              </CardTitle>
              <CardDescription>The app hit a runtime error. Please reload.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <pre className="overflow-x-auto rounded-md border border-border/70 bg-muted/40 p-3 text-xs text-muted-foreground">
                {this.state.message}
              </pre>
              {this.state.componentStack ? (
                <pre className="max-h-52 overflow-auto rounded-md border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
                  {this.state.componentStack}
                </pre>
              ) : null}
              <Button onClick={() => window.location.reload()}>
                <RefreshCwIcon className="size-4" />
                Reload App
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    )
  }
}
