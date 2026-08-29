import { useCallback, useEffect, useRef, useState } from 'react'
import { CameraIcon, Loader2Icon, Trash2Icon } from 'lucide-react'
import { reducers } from '../../lib/spacetimedb'
import { authServiceAccount, type AccountDetails } from '../../lib/authService'
import { uploadSingleFile } from '../../lib/uploads'
import { useSelfStore } from '../../stores/selfStore'
import { toast } from 'sonner'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

const MAX_AVATAR_SIZE_BYTES = 10 * 1024 * 1024

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  registered: 'Awaiting email confirmation',
  email_verified: 'Awaiting admin approval',
  disabled: 'Disabled',
  rejected: 'Rejected',
}

function formatMemberSince(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

function AccountRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <p className="text-xs uppercase tracking-wide text-muted-foreground shrink-0">{label}</p>
      <div className="min-w-0 text-right text-sm">{children}</div>
    </div>
  )
}

export function AccountTab() {
  const user = useSelfStore((s) => s.user)

  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? '')
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null)
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false)
  const [account, setAccount] = useState<AccountDetails | null>(null)
  // `null` while loading; the tab never blocks on this fetch — a failure just
  // degrades the read-only rows to what the SpacetimeDB user row already knows.
  const [accountError, setAccountError] = useState<string | null>(null)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let active = true
    void authServiceAccount()
      .then((details) => {
        if (active) setAccount(details)
      })
      .catch(() => {
        if (active) setAccountError("Couldn't load your account details.")
      })
    return () => {
      active = false
    }
  }, [])

  // The effect below revokes the previous blob URL on every change and on
  // unmount, so the updaters stay pure (StrictMode runs updaters twice — a
  // createObjectURL inside one leaks a blob per double-invoke).
  const clearAvatarPreview = useCallback(() => {
    setAvatarPreviewUrl(null)
  }, [])

  const setAvatarPreviewFromFile = useCallback((file: File) => {
    setAvatarPreviewUrl(URL.createObjectURL(file))
  }, [])

  const handleAvatarFilePicked = useCallback(
    (file: File | null) => {
      if (!file) return

      if (!file.type.startsWith('image/')) {
        toast.error('Please select an image file.')
        return
      }
      if (file.size > MAX_AVATAR_SIZE_BYTES) {
        toast.error('Profile picture is too large. Max size is 10 MB.')
        return
      }

      setIsUploadingAvatar(true)
      void uploadSingleFile(file)
        .then((uploaded) => {
          setAvatarUrl(uploaded.storageKey)
          setAvatarPreviewFromFile(file)
          toast.success('Profile picture uploaded')
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : 'Could not upload profile picture.'
          toast.error(message)
        })
        .finally(() => {
          setIsUploadingAvatar(false)
        })
    },
    [setAvatarPreviewFromFile],
  )

  useEffect(
    () => () => {
      if (avatarPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(avatarPreviewUrl)
    },
    [avatarPreviewUrl],
  )

  const profileDisplayName = displayName.trim() || user?.displayName || user?.username || 'No display name'
  const isLoadingAccount = account === null && accountError === null

  return (
    <div className="space-y-3">
      <Card className="border-border/70 bg-muted/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Profile</CardTitle>
          <CardDescription>What other members see in chat, member lists and calls.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault()
              setIsSavingProfile(true)
              try {
                await reducers.updateProfile(displayName || null, avatarUrl.trim())
                clearAvatarPreview()
                toast.success('Profile updated')
              } catch (error) {
                const message = error instanceof Error ? error.message : 'Could not save profile.'
                toast.error(message)
              } finally {
                setIsSavingProfile(false)
              }
            }}
          >
            <div className="flex items-center gap-4 rounded-lg border border-border/70 bg-card/70 p-3">
              <Avatar className="size-16 rounded-full">
                {avatarPreviewUrl || avatarUrl ? (
                  <AvatarImage src={avatarPreviewUrl ?? avatarUrl} alt={profileDisplayName} />
                ) : null}
                <AvatarFallback className="rounded-full bg-primary/10 text-lg">
                  {profileDisplayName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>

              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null
                  event.currentTarget.value = ''
                  handleAvatarFilePicked(file)
                }}
              />

              <div className="min-w-0 space-y-2">
                <Label className="text-sm">Profile picture</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isUploadingAvatar}
                    onClick={() => avatarInputRef.current?.click()}
                  >
                    {isUploadingAvatar ? <Loader2Icon className="size-4 animate-spin" /> : <CameraIcon className="size-4" />}
                    {isUploadingAvatar ? 'Uploading…' : 'Change Photo'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isUploadingAvatar || (!avatarPreviewUrl && !avatarUrl)}
                    onClick={() => {
                      clearAvatarPreview()
                      setAvatarUrl('')
                      toast.message('Profile picture will be removed after saving.')
                    }}
                  >
                    <Trash2Icon className="size-4" />
                    Remove
                  </Button>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="settings-display-name">Display name</Label>
              <Input
                id="settings-display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Display name"
              />
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={isSavingProfile || isUploadingAvatar}>
                {isSavingProfile ? 'Saving…' : 'Save Profile'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-muted/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Account</CardTitle>
          <CardDescription>Your sign-in identity. Contact an admin to change these.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-border/60 rounded-lg border border-border/70 bg-card/70 px-3">
            <AccountRow label="Username">
              <Badge variant="secondary">{account ? `@${account.username}` : user ? `@${user.username}` : '—'}</Badge>
            </AccountRow>
            <AccountRow label="Email">
              {isLoadingAccount ? (
                <Skeleton className="h-4 w-44" />
              ) : account ? (
                <span className="flex items-center justify-end gap-2">
                  <span className="truncate">{account.email || 'No email on file'}</span>
                  {account.email && !account.emailConfirmed ? (
                    <Badge variant="outline" className="text-[10px]">
                      Unconfirmed
                    </Badge>
                  ) : null}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">{accountError}</span>
              )}
            </AccountRow>
            <AccountRow label="Status">
              {isLoadingAccount ? (
                <Skeleton className="h-4 w-16" />
              ) : account ? (
                <Badge variant={account.status === 'active' ? 'secondary' : 'outline'}>
                  {STATUS_LABELS[account.status] ?? account.status}
                </Badge>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </AccountRow>
            <AccountRow label="Member since">
              {isLoadingAccount ? (
                <Skeleton className="h-4 w-28" />
              ) : account ? (
                <span>{formatMemberSince(account.createdAt)}</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </AccountRow>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
