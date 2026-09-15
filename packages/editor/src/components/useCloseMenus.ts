/**
 * Closes the `details.menu` elements under `root`: every open one on a click
 * outside it or on Escape, and the one a picked item belongs to after the
 * pick. Document listeners, attached once for the whole toolbar.
 */
import { type RefObject, useEffect } from 'react'

export function useCloseMenus(root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const closeAll = (except?: Node | null) => {
      const menus = root.current?.querySelectorAll<HTMLDetailsElement>('details.menu[open]')
      if (menus === undefined) return
      for (const menu of menus) {
        if (except === undefined || except === null || !menu.contains(except)) menu.open = false
      }
    }
    const onPointerDown = (event: PointerEvent) => {
      closeAll(event.target instanceof Node ? event.target : null)
    }
    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return
      const button = event.target.closest('.menu-body button')
      const menu = button?.closest<HTMLDetailsElement>('details.menu')
      if (menu !== null && menu !== undefined && root.current?.contains(menu)) menu.open = false
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAll()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('click', onClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [root])
}
