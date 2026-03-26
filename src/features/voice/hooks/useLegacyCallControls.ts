import { useUiStore } from '../../../stores/uiStore'

export function useLegacyCallControlsVisible(): boolean {
  const activeCallDockVisible = useUiStore((state) => state.activeCallDockVisible)
  return !activeCallDockVisible
}
