import { useCallback, useEffect, useRef, useState } from 'react'
import { reducers } from '../lib/spacetimedb'
import { uploadSingleFile } from '../lib/uploads'
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { toast } from '@/components/ui/sonner'
import { CameraIcon, Loader2Icon, Trash2Icon } from 'lucide-react'
import { serverInitials } from '../layouts/app-layout/helpers'

const MAX_SERVER_ICON_SIZE_BYTES = 10 * 1024 * 1024

export function EditServerModal({
  serverId,
  currentName,
  currentIconUrl,
  onClose,
}: {
  serverId: number
  currentName: string
  currentIconUrl: string | null
  onClose: () => void
}) {
  const [name, setName] = useState(currentName)
  const [iconUrl, setIconUrl] = useState(currentIconUrl ?? '')
  const [iconPreviewUrl, setIconPreviewUrl] = useState<string | null>(null)
  const [isUploadingIcon, setIsUploadingIcon] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const iconInputRef = useRef<HTMLInputElement | null>(null)

  const clearIconPreview = useCallback(() => {
    setIconPreviewUrl((current) => {
      if (current?.startsWith('blob:')) URL.revokeObjectURL(current)
      return null
    })
  }, [])

  useEffect(
    () => () => {
      if (iconPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(iconPreviewUrl)
    },
    [iconPreviewUrl],
  )

  const handleIconFilePicked = useCallback((file: File | null) => {
    if (!file) return

    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file.')
      return
    }
    if (file.size > MAX_SERVER_ICON_SIZE_BYTES) {
      toast.error('Server icon is too large. Max size is 10 MB.')
      return
    }

    setIsUploadingIcon(true)
    void uploadSingleFile(file)
      .then((uploaded) => {
        setIconUrl(uploaded.storageKey)
        setIconPreviewUrl((current) => {
          if (current?.startsWith('blob:')) URL.revokeObjectURL(current)
          return URL.createObjectURL(file)
        })
        toast.success('Server icon uploaded')
      })
      .catch((uploadError) => {
        const message = uploadError instanceof Error ? uploadError.message : 'Could not upload server icon.'
        toast.error(message)
      })
      .finally(() => {
        setIsUploadingIcon(false)
      })
  }, [])

  const effectiveIconUrl = iconPreviewUrl ?? (iconUrl.trim() || null)

  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault()
        setError(null)
        setIsSaving(true)
        try {
          const nextName = name.trim()
          const currentTrimmedName = currentName.trim()
          const nextIconUrl = iconUrl.trim()
          const currentTrimmedIconUrl = (currentIconUrl ?? '').trim()

          if (nextName !== currentTrimmedName) {
            await reducers.renameServer(serverId, nextName)
          }

          if (nextIconUrl !== currentTrimmedIconUrl) {
            await reducers.setServerIcon(serverId, nextIconUrl.length > 0 ? nextIconUrl : null)
          }

          if (nextName !== currentTrimmedName || nextIconUrl !== currentTrimmedIconUrl) {
            toast.success('Server updated')
          }
          onClose()
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Could not update server.'
          setError(message)
        } finally {
          setIsSaving(false)
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>Edit Server</DialogTitle>
        <DialogDescription>Update server name and icon.</DialogDescription>
      </DialogHeader>

      <input
        ref={iconInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null
          event.currentTarget.value = ''
          handleIconFilePicked(file)
        }}
      />

      <div className="space-y-3 rounded-lg border border-border/70 bg-muted/25 px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label className="text-sm">Server icon</Label>
            <p className="text-xs text-muted-foreground">Shown in sidebars and server headers.</p>
          </div>
          <Avatar className="size-14 rounded-xl">
            {effectiveIconUrl ? <AvatarImage src={effectiveIconUrl} alt={name || currentName} /> : null}
            <AvatarFallback className="rounded-xl bg-primary/10 text-sm">
              {serverInitials(name || currentName)}
            </AvatarFallback>
          </Avatar>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isUploadingIcon || isSaving}
            onClick={() => iconInputRef.current?.click()}
          >
            {isUploadingIcon ? <Loader2Icon className="size-4 animate-spin" /> : <CameraIcon className="size-4" />}
            {isUploadingIcon ? 'Uploading...' : 'Change Icon'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isUploadingIcon || isSaving || (!iconPreviewUrl && iconUrl.trim().length === 0)}
            onClick={() => {
              clearIconPreview()
              setIconUrl('')
            }}
          >
            <Trash2Icon className="size-4" />
            Remove
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="edit-server-name">Server name</Label>
        <Input
          id="edit-server-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          minLength={2}
          maxLength={100}
          required
          disabled={isSaving}
        />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSaving || isUploadingIcon}>
          {isSaving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </form>
  )
}
