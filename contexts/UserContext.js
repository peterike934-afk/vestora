"use client";

import { createContext, useContext, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const UserContext = createContext({ user: null, userName: '', role: null, isAdmin: false, loading: true })

export function UserProvider({ children }) {
  const [user, setUser] = useState(null)
  const [role, setRole] = useState(null)
  const [loading, setLoading] = useState(true)

 useEffect(() => {
  const supabase = createClient()
  let cancelled = false

  async function applySession(sessionUser) {
    setUser(sessionUser)
    if (sessionUser) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', sessionUser.id)
        .single()
      if (!cancelled) setRole(profile?.role ?? null)
    } else {
      if (!cancelled) setRole(null)
    }
    if (!cancelled) setLoading(false)
  }

  const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
    applySession(session?.user ?? null)
  })

  return () => {
    cancelled = true
    listener?.subscription?.unsubscribe()
  }
}, [])
  const userName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email?.split('@')[0] ||
    ''

  return (
    <UserContext.Provider value={{ user, userName, role, isAdmin: role === 'admin', loading }}>
      {children}
    </UserContext.Provider>
  )
}

export function useUser() {
  return useContext(UserContext)
}