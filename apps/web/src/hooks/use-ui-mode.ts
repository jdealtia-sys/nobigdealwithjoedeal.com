'use client'

import { useCallback, useEffect, useState } from 'react'

type UiMode = 'field' | 'office'

const STORAGE_KEY = 'nbdpro-ui-mode'

function detectDefaultMode(): UiMode {
  // Auto-detect: prefer field mode on narrow/touch screens
  if (typeof window === 'undefined') return 'office'
  const isTouch = window.matchMedia('(pointer: coarse)').matches
  const isNarrow = window.innerWidth < 768
  return isTouch && isNarrow ? 'field' : 'office'
}

export function useUiMode() {
  const [mode, setModeState] = useState<UiMode>('office')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const stored = localStorage.getItem(STORAGE_KEY) as UiMode | null
    const resolved = stored ?? detectDefaultMode()
    setModeState(resolved)
    document.documentElement.setAttribute('data-mode', resolved)
  }, [])

  const setMode = useCallback((next: UiMode) => {
    setModeState(next)
    localStorage.setItem(STORAGE_KEY, next)
    document.documentElement.setAttribute('data-mode', next)
  }, [])

  const toggleMode = useCallback(() => {
    setMode(mode === 'field' ? 'office' : 'field')
  }, [mode, setMode])

  return { mode, setMode, toggleMode, mounted }
}
