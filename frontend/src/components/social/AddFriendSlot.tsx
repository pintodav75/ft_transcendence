import { useState, type FormEvent } from 'react'
import { Search, UserPlus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function AddFriendSlot() {
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState<string>()

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!query.trim()) return

    setNotice('Friend requests are not available yet.')
  }

  return (
    <div className="space-y-4 p-4">
      <p className="text-sm font-semibold text-text-primary">Add friend</p>
      <p className="text-sm text-text-secondary">Search for players to send a friend request.</p>

      <form className="flex gap-2" onSubmit={handleSubmit}>
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search player</span>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setNotice(undefined)
            }}
            placeholder="Search"
            className="h-11 pl-10"
          />
        </label>
        <Button type="submit" disabled={!query.trim()} className="h-11 px-3">
          <UserPlus className="size-4" aria-hidden="true" />
          <span className="sr-only">Add friend</span>
        </Button>
      </form>

      {notice && (
        <p className="text-xs text-text-muted">{notice}</p>
      )}
    </div>
  )
}
