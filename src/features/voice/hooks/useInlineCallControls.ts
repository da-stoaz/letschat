import { useUiStore } from '../../../stores/uiStore'

/**
 * True when the floating/sidebar call dock is NOT visible (e.g. on mobile),
 * so the in-panel voice controls should render inline instead.
 */
export function useInlineCallControlsVisible(): boolean {
  const activeCallDockVisible = useUiStore((state) => state.activeCallDockVisible)
  return !activeCallDockVisible
}
