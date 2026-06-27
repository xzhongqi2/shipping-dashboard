import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const BUCKET = 'shipping_content'
const POLL_INTERVAL_MS = 30_000

export function useContentItems(type) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    const { data, error: fetchError } = await supabase
      .from('shipping_content_items')
      .select('*')
      .eq('type', type)
      .order('created_at', { ascending: false })

    if (fetchError) {
      setError(fetchError.message)
      setLoading(false)
      return
    }

    const rows = data ?? []
    const rowsWithUrls = await Promise.all(rows.map(async (item) => {
      if (!item.storage_path) return item
      const { data: signed, error: signedError } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(item.storage_path, 60 * 60)
      return { ...item, signed_url: signedError ? '' : signed?.signedUrl }
    }))

    setItems(rowsWithUrls)
    setLoading(false)
  }, [type])

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      if (cancelled) return
      await load()
    }

    tick()
    const id = setInterval(tick, POLL_INTERVAL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [load])

  const upload = useCallback(async ({ title, file, fileType, preview }) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || 'file'
    const safeName = file.name
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9._-]/g, '')
      .slice(-80) || `upload.${ext}`
    const path = `${type}/${Date.now()}-${crypto.randomUUID()}-${safeName}`

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, {
        cacheControl: '3600',
        contentType: file.type || undefined,
        upsert: false,
      })
    if (uploadError) throw uploadError

    const { data, error: insertError } = await supabase
      .from('shipping_content_items')
      .insert({
        type,
        title,
        file_name: file.name,
        file_type: fileType,
        content_type: file.type || '',
        storage_path: path,
        preview,
      })
      .select('*')
      .single()

    if (insertError) throw insertError

    let signedUrl = ''
    const { data: signed } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, 60 * 60)
    signedUrl = signed?.signedUrl || ''

    setItems(prev => [{ ...data, signed_url: signedUrl }, ...prev])
    return data
  }, [type])

  const remove = useCallback(async (item) => {
    const { error: deleteError } = await supabase
      .from('shipping_content_items')
      .delete()
      .eq('id', item.id)
    if (deleteError) throw deleteError

    if (item.storage_path) {
      await supabase.storage.from(BUCKET).remove([item.storage_path])
    }
    setItems(prev => prev.filter(row => row.id !== item.id))
  }, [])

  return { items, loading, error, upload, remove, reload: load }
}
