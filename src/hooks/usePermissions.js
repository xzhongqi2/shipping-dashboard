import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export const ROLE_OPTIONS = [
  { value: 'owner', label: '一级 owner', hint: '可分配权限、读写全数据、查看敏感数据' },
  { value: 'staff', label: '二级 staff', hint: '读写全数据、查看敏感数据' },
  { value: 'operator', label: '三级 operator', hint: '读写一般数据，敏感数据受限' },
  { value: 'viewer', label: '四级 viewer', hint: '只读' },
]

export function usePermissions(enabled) {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setError('')
      const { data, error: rpcError } = await supabase.rpc('list_user_roles')
      if (cancelled) return
      if (rpcError) {
        setError(rpcError.message)
        setUsers([])
      } else {
        setUsers(data ?? [])
      }
      setLoading(false)
    }

    load()

    return () => { cancelled = true }
  }, [enabled, reloadKey])

  const refresh = useCallback(() => setReloadKey(k => k + 1), [])

  const setRole = useCallback(async (email, role) => {
    const { error: rpcError } = await supabase.rpc('set_user_role', {
      target_email: email,
      target_role: role,
    })
    if (rpcError) throw rpcError
    refresh()
  }, [refresh])

  return { users, loading, error, refresh, setRole }
}
