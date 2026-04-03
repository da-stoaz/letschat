import { useMemo, useState } from 'react'
import { reducers } from '../lib/spacetimedb'
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

export function EditChannelModal({
  channelId,
  currentName,
  currentModeratorOnly,
  currentSection,
  onClose,
}: {
  channelId: number
  currentName: string
  currentModeratorOnly: boolean
  currentSection: string | null
  onClose: () => void
}) {
  const channelsByServer = useChannelsStore((s) => s.channelsByServer)
  const serverChannels = useMemo(() => {
    for (const channels of Object.values(channelsByServer)) {
      if (channels.some((channel) => channel.id === channelId)) {
        return channels
      }
    }
    return []
  }, [channelId, channelsByServer])
  const existingSections = useMemo(() => {
    const unique = new Set<string>()
    for (const channel of serverChannels) {
      const normalized = channel.section?.trim()
      if (normalized) unique.add(normalized)
    }
    const normalizedCurrent = currentSection?.trim()
    if (normalizedCurrent) unique.add(normalizedCurrent)
    return [...unique].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
  }, [currentSection, serverChannels])

  const initialSelection =
    currentSection && currentSection.trim().length > 0 ? encodeSectionValue(currentSection.trim()) : SECTION_NONE_VALUE

  const [name, setName] = useState(currentName)
  const [moderatorOnly, setModeratorOnly] = useState(currentModeratorOnly)
  const [sectionSelection, setSectionSelection] = useState<string>(initialSelection)
  const [newSectionName, setNewSectionName] = useState('')
  const [error, setError] = useState<string | null>(null)

  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault()
        setError(null)
        try {
          if (sectionSelection === SECTION_NEW_VALUE && newSectionName.trim().length === 0) {
            setError('Enter a name for the new section.')
            return
          }
          await reducers.updateChannel(channelId, { name, moderatorOnly })
          const existingSection = decodeSectionValue(sectionSelection)
          const resolvedSection =
            sectionSelection === SECTION_NONE_VALUE ? null
            : sectionSelection === SECTION_NEW_VALUE ? newSectionName.trim() || null
            : existingSection
          if ((resolvedSection ?? '').trim() !== (currentSection ?? '').trim()) {
            await reducers.setChannelSection(channelId, resolvedSection)
          }
          onClose()
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Could not update channel.'
          setError(message)
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>Edit Channel</DialogTitle>
        <DialogDescription>Update channel details or delete it.</DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="edit-channel-name">Channel name</Label>
        <Input
          id="edit-channel-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={1}
          maxLength={100}
        />
      </div>
      <div className="space-y-2">
        <Label>Section</Label>
        <Select value={sectionSelection} onValueChange={(value) => setSectionSelection(value ?? SECTION_NONE_VALUE)}>
          <SelectTrigger className="w-full">
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
          <Input
            value={newSectionName}
            onChange={(event) => setNewSectionName(event.target.value)}
            maxLength={40}
            placeholder="Section name"
          />
        ) : null}
      </div>
      <div className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/25 px-3 py-2">
        <Label htmlFor="edit-channel-mod-only">Moderator only</Label>
        <Switch id="edit-channel-mod-only" checked={moderatorOnly} onCheckedChange={setModeratorOnly} />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex items-center justify-end gap-2">
        <Button type="submit">Save</Button>
        <Button
          variant="destructive"
          type="button"
          onClick={async () => {
            await reducers.deleteChannel(channelId)
            onClose()
          }}
        >
          Delete Channel
        </Button>
      </div>
    </form>
  )
}
