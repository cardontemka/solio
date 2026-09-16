import type { KeyboardEvent } from 'react'

/**
 * Stops Enter in a single-line field from submitting the whole form.
 *
 * A browser submits on Enter from any text input, which is right for a login
 * box and wrong for a form with fifteen fields: people type a title, press
 * Enter to move on, and the listing is created with nothing else filled in. The
 * only way to submit is now the button that says so.
 *
 * Textareas keep Enter (it is a newline there), and so does anything that is
 * itself a button — including the submit button, so a keyboard user can still
 * finish without a mouse.
 */
export function blockImplicitSubmit(event: KeyboardEvent<HTMLFormElement>) {
  if (event.key !== 'Enter' || event.shiftKey) return
  const target = event.target as HTMLElement | null
  if (!target) return
  const tag = target.tagName
  if (tag === 'TEXTAREA' || tag === 'BUTTON') return
  if (tag === 'INPUT' && (target as HTMLInputElement).type === 'submit') return
  // A component may have already acted on this key — picking a suggestion, say.
  if (event.defaultPrevented) return
  event.preventDefault()
}
