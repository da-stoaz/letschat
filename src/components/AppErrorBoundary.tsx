import { Component, type ErrorInfo, type ReactNode } from 'react'

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
      <main className="fatal-shell">
        <section className="fatal-card">
          <h1>Something went wrong</h1>
          <p>The app hit a runtime error. Please reload.</p>
          <code>{this.state.message}</code>
          {this.state.componentStack ? <pre>{this.state.componentStack}</pre> : null}
          <button onClick={() => window.location.reload()}>Reload App</button>
        </section>
      </main>
    )
  }
}
