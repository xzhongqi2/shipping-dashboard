import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const POLL_INTERVAL_MS = 30_000

export function useRecords() {
  const [records, setRecords] = useState([])

  const fetchAll = useCallback(async () => {
    const { data, error } = await supabase
      .from('records')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) {
      console.warn('[useRecords] fetch failed:', error.message)
      return
    }
    setRecords(data ?? [])
  }, [])

  useEffect(() => {
    fetchAll()
    const id = setInterval(fetchAll, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [fetchAll])

  const add = useCallback(async (newRecord) => {
    const { data, error } = await supabase
      .from('records')
      .insert(newRecord)
      .select()
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
      .select()
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

  return { records, add, update, remove, refetch: fetchAll }
}
