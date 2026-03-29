import { useState } from 'react'
import { ClockIcon } from 'lucide-react'
import { reducers } from '../../lib/spacetimedb'
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { memberLabel, memberUsername, type MemberActionModalProps } from './shared'

const TIMEOUT_OPTIONS = [
  { label: '60 seconds', value: 60 },
  { label: '5 minutes', value: 5 * 60 },
  { label: '10 minutes', value: 10 * 60 },
  { label: '1 hour', value: 60 * 60 },
  { label: '1 day', value: 24 * 60 * 60 },
  { label: '1 week', value: 7 * 24 * 60 * 60 },
  { label: '4 weeks', value: 28 * 24 * 60 * 60 },
] as const

export function TimeoutMemberModal({ serverId, member, onClose }: MemberActionModalProps) {
  const [durationSeconds, setDurationSeconds] = useState(10 * 60)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const durationSelectValue = String(durationSeconds)
  const selectedDurationLabel =
    TIMEOUT_OPTIONS.find((opt) => String(opt.value) === durationSelectValue)?.label ?? '10 minutes'

  const handleTimeout = async () => {
    setLoading(true)
    setError(null)
    try {
      await reducers.timeoutMember(serverId, member.userIdentity, durationSeconds)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to timeout member.')
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <ClockIcon className="size-4 text-yellow-500" />
          Timeout {memberLabel(member)}
        </DialogTitle>
        <DialogDescription>
          <strong>@{memberUsername(member)}</strong> will be prevented from sending messages for the selected duration.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label>Duration</Label>
        <Select
          value={durationSelectValue}
          onValueChange={(v) => {
            const selected = TIMEOUT_OPTIONS.find((opt) => String(opt.value) === v)
            if (selected) setDurationSeconds(selected.value)
          }}
        >
          <SelectTrigger className="w-full">
            <span className="truncate font-medium">{selectedDurationLabel}</span>
            <SelectValue className="sr-only" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {TIMEOUT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={String(opt.value)} className="py-1.5">
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={loading} onClick={handleTimeout}>
          {loading ? 'Applying…' : 'Apply Timeout'}
        </Button>
      </div>
    </div>
  )
}

