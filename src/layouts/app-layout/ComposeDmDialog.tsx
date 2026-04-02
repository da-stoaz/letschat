import { useMemo, useState } from 'react'
import { SearchIcon } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { userInitials } from './helpers'

interface ComposeDmFriend {
  identity: string
  label: string
  username: string
  avatarUrl: string | null
}

interface ComposeDmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  friends: ComposeDmFriend[]
  onSelectFriend: (identity: string) => void
}

export function ComposeDmDialog({ open, onOpenChange, friends, onSelectFriend }: ComposeDmDialogProps) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return friends
    return friends.filter((friend) => {
      const haystack = `${friend.label} ${friend.username}`.toLowerCase()
      return haystack.includes(normalized)
    })
  }, [friends, query])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Compose New DM</DialogTitle>
          <DialogDescription>Select a friend to start or continue a direct message.</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by display name or username"
            className="pl-8"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="none"
            autoComplete="off"
          />
        </div>

        <ScrollArea className="h-72 rounded-md border border-border/70 bg-muted/20 p-2">
          <div className="space-y-1">
            {filtered.length > 0 ? (
              filtered.map((friend) => (
                <Button
                  key={friend.identity}
                  variant="ghost"
                  className="h-auto w-full justify-start gap-2 rounded-lg py-2"
                  onClick={() => {
                    onSelectFriend(friend.identity)
                    onOpenChange(false)
                    setQuery('')
                  }}
                >
                  <Avatar className="size-8 rounded-lg">
                    {friend.avatarUrl ? <AvatarImage src={friend.avatarUrl} alt={friend.label} /> : null}
                    <AvatarFallback className="rounded-lg bg-primary/10 text-[10px]">{userInitials(friend.label)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 text-left">
                    <p className="truncate text-sm">{friend.label}</p>
                    <p className="truncate text-xs text-muted-foreground">@{friend.username}</p>
                  </div>
                </Button>
              ))
            ) : (
              <p className="px-2 py-4 text-xs text-muted-foreground">No matching friends found.</p>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
