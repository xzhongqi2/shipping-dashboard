import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const POLL_INTERVAL_MS = 30_000

export function useWeek() {
  const [currentWeek, setCurrentWeek] = useState(null)
  const [selectedWeek, setSelectedWeek] = useState(null)

  useEffect(() => {
    let cancelled = false

    const tick = () => {
      supabase
        .from('app_state')
        .select('current_week')
        .eq('id', 1)
        .single()
        .then(({ data, error }) => {
          if (cancelled) return
          if (error) {
            console.warn('[useWeek] fetch failed:', error.message)
            return
          }
          setCurrentWeek(data.current_week)
          setSelectedWeek(prev => prev ?? data.current_week)
        })
    }

    tick()
    const id = setInterval(tick, POLL_INTERVAL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  const advance = useCallback(async (password) => {
    const { data, error } = await supabase.rpc('advance_week', { password })
    if (error) throw error
    setCurrentWeek(data)
    setSelectedWeek(data)
    return data
  }, [])

  const setWeek = useCallback(async (password, week) => {
    const { data, error } = await supabase.rpc('set_current_week', {
      password,
      p_week: week,
    })
    if (error) throw error
    setCurrentWeek(data)
    setSelectedWeek(data)
    return data
  }, [])

  return { currentWeek, selectedWeek, setSelectedWeek, advance, setWeek }
}
