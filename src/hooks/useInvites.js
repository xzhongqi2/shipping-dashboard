import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

async function fetchInvites() {
  const { data, error } = await supabase
    .from('invites')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) {
    console.warn('[useInvites] fetch failed:', error.message)
    return []
  }
  return data ?? []
}

export function useInvites() {
  const [invites, setInvites] = useState([])
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetchInvites().then(rows => {
      if (cancelled) return
      setInvites(rows)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [reloadKey])

  const create = useCallback(async (email) => {
    const { data, error } = await supabase.rpc('create_invite', { target_email: email, target_role: 'viewer' })
    if (error) throw error
    setReloadKey(k => k + 1)
    return data?.[0]
  }, [])

  const refresh = useCallback(() => setReloadKey(k => k + 1), [])

  return { invites, loading, refresh, create }
}
