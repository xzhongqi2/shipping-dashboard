import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export function useAdmin() {
  const [isAdmin, setIsAdmin] = useState(false)
  const [costs, setCosts] = useState({})
  const [password, setPassword] = useState('')

  const login = useCallback(async (pw) => {
    const { data, error } = await supabase.rpc('get_costs', { password: pw })
    if (error) throw error
    const map = {}
    for (const row of data) map[row.container] = Number(row.cost)
    setCosts(map)
    setPassword(pw)
    setIsAdmin(true)
  }, [])

  const logout = useCallback(() => {
    setIsAdmin(false)
    setCosts({})
    setPassword('')
  }, [])

  const updateCost = useCallback(async (container, cost) => {
    const { error } = await supabase.rpc('update_cost', {
      password,
      p_container: container,
      p_cost: cost,
    })
    if (error) throw error
    setCosts(prev => ({ ...prev, [container]: Number(cost) }))
  }, [password])

  return { isAdmin, costs, login, logout, updateCost }
}
