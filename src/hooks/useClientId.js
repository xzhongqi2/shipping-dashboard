import { useState } from 'react'

const STORAGE_KEY = 'shipping_client_id'

export function useClientId() {
  const [clientId] = useState(() => {
    let id = localStorage.getItem(STORAGE_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(STORAGE_KEY, id)
    }
    return id
  })
  return clientId
}
