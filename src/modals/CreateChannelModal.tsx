import { useMemo, useState } from 'react'
import { reducers } from '../lib/spacetimedb'
import type { ChannelKind } from '../types/domain'
import { useChannelsStore } from '../stores/channelsStore'
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

const SECTION_NONE_VALUE = '__none__'
const SECTION_NEW_VALUE = '__new__'
const EXISTING_SECTION_PREFIX = 'existing:'

function encodeSectionValue(section: string): string {
  return `${EXISTING_SECTION_PREFIX}${section}`
}

function decodeSectionValue(value: string): string | null {
  return value.startsWith(EXISTING_SECTION_PREFIX) ? value.slice(EXISTING_SECTION_PREFIX.length) : null
}

function sectionSelectionLabel(value: string): string {
  if (value === SECTION_NONE_VALUE) return 'No section'
  if (value === SECTION_NEW_VALUE) return 'Create new section...'
  return decodeSectionValue(value) ?? 'Choose section'
}

function initialSectionSelectionValue(initialSection: string | null | undefined): string {
  const normalized = initialSection?.trim()
  return normalized && normalized.length > 0 ? encodeSectionValue(normalized) : SECTION_NONE_VALUE
}

export function CreateChannelModal({
  serverId,
  onClose,
  initialSection = null,
}: {
  serverId: number
  onClose: () => void
  initialSection?: string | null
}) {
  const serverChannels = useChannelsStore((s) => s.channelsByServer[serverId] ?? [])
  const existingSections = useMemo(() => {
    const unique = new Set<string>()
    for (const channel of serverChannels) {
      const normalized = channel.section?.trim()
      if (normalized) unique.add(normalized)
    }
    return [...unique].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
  }, [serverChannels])

  const [name, setName] = useState('')
  const [sectionSelection, setSectionSelection] = useState<string>(() => initialSectionSelectionValue(initialSection))
  const [newSectionName, setNewSectionName] = useState('')
  const [kind, setKind] = useState<ChannelKind>('Text')
  const [moderatorOnly, setModeratorOnly] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault()
        if (submitting) return
        setSubmitting(true)
        setError(null)
        try {
          if (sectionSelection === SECTION_NEW_VALUE && newSectionName.trim().length === 0) {
            setError('Enter a name for the new section.')
            return
          }
          const existingSection = decodeSectionValue(sectionSelection)
          const resolvedSection =
            sectionSelection === SECTION_NONE_VALUE ? null
            : sectionSelection === SECTION_NEW_VALUE ? newSectionName.trim() || null
            : existingSection
          await reducers.createChannel(serverId, name.trim(), kind, moderatorOnly, resolvedSection)
          onClose()
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Could not create channel.'
          setError(message)
        } finally {
          setSubmitting(false)
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>Create Channel</DialogTitle>
        <DialogDescription>Choose a channel type and permissions.</DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        <Label htmlFor="channel-name">Channel name</Label>
        <Input id="channel-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={1} maxLength={100} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="create-channel-section">Section</Label>
        <Select value={sectionSelection} onValueChange={(value) => setSectionSelection(value ?? SECTION_NONE_VALUE)}>
          <SelectTrigger id="create-channel-section" className="w-full">
            <SelectValue>{sectionSelectionLabel(sectionSelection)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SECTION_NONE_VALUE}>No section</SelectItem>
            {existingSections.map((section) => (
              <SelectItem key={section} value={encodeSectionValue(section)}>
                {section}
              </SelectItem>
            ))}
            <SelectItem value={SECTION_NEW_VALUE}>Create new section...</SelectItem>
          </SelectContent>
        </Select>
        {sectionSelection === SECTION_NEW_VALUE ? (
          <>
          <Label htmlFor="create-section-name">New section name</Label>
          <Input
            id="create-section-name"
            value={newSectionName}
            onChange={(event) => setNewSectionName(event.target.value)}
            maxLength={40}
            placeholder="Section name"
          />
          </>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="create-channel-type">Channel type</Label>
        <Select value={kind} onValueChange={(value) => setKind(value as ChannelKind)}>
          <SelectTrigger id="create-channel-type" className="w-full">
            <SelectValue placeholder="Select channel type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Text">Text</SelectItem>
            <SelectItem value="Voice">Voice</SelectItem>
            <SelectItem value="Announcement">Announcement</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
        <div>
          <Label htmlFor="create-channel-mod-only">Moderator only</Label>
          <p className="text-xs text-muted-foreground">Restrict posting/joining to moderators and owners.</p>
        </div>
        <Switch id="create-channel-mod-only" checked={moderatorOnly} onCheckedChange={setModeratorOnly} />
      </div>

      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create'}</Button>
      </div>
    </form>
  )
}
