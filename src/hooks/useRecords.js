import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const POLL_INTERVAL_MS = 30_000

export function useRecords() {
  const [records, setRecords] = useState([])

  useEffect(() => {
    let cancelled = false

    const tick = () => {
      supabase
        .from('records')
        .select('*, creator:created_by(email), updater:updated_by(email)')
        .order('created_at', { ascending: false })
        .then(({ data, error }) => {
          if (cancelled) return
          if (error) {
            console.warn('[useRecords] fetch failed:', error.message)
            return
          }
          setRecords(data ?? [])
        })
    }

    tick()
    const id = setInterval(tick, POLL_INTERVAL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  const add = useCallback(async (newRecord) => {
    const { data, error } = await supabase
      .from('records')
      .insert(newRecord)
      .select('*, creator:created_by(email), updater:updated_by(email)')
      .single()
    if (error) throw error
    setRecords(prev => [data, ...prev])
    return data
  }, [])

  const update = useCallback(async (id, patch) => {
    const { data, error } = await supabase
      .from('records')
      .update(patch)
      .eq('id', id)
      .select('*, creator:created_by(email), updater:updated_by(email)')
      .single()
    if (error) throw error
    setRecords(prev => prev.map(r => r.id === id ? data : r))
    return data
  }, [])

  const remove = useCallback(async (id) => {
    const { error } = await supabase.from('records').delete().eq('id', id)
    if (error) throw error
    setRecords(prev => prev.filter(r => r.id !== id))
  }, [])

  return { records, add, update, remove }
}
