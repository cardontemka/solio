'use client'

import { useId, useState, type InputHTMLAttributes } from 'react'
import { EyeIcon, EyeOffIcon } from './Icons'
import styles from './forms.module.css'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /** Rendered above the box. */
  label: string
  /** Shown under it, unless there is an error to show instead. */
  hint?: string
}

/**
 * A password box with a reveal button.
 *
 * Typing a password you cannot see is where signups are abandoned, and on a
 * phone keyboard it is a coin toss. The button flips the input's type, which is
 * the whole mechanism — no second hidden field, so a password manager still
 * sees one control and autofill keeps working.
 *
 * Revealed state is deliberately not remembered between fields or renders: it
 * resets to hidden every time the form mounts, so nothing is left on screen for
 * the next person to read.
 */
export function PasswordField({ label, hint, id, children, ...input }: Props) {
  const fallbackId = useId()
  const fieldId = id ?? fallbackId
  const [shown, setShown] = useState(false)

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={fieldId}>
        {label}
      </label>

      <div className={styles.passwordWrap}>
        <input
          {...input}
          className={`${styles.input} ${styles.passwordInput}`}
          id={fieldId}
          type={shown ? 'text' : 'password'}
        />
        <button
          type="button"
          className={styles.reveal}
          onClick={() => setShown((v) => !v)}
          aria-pressed={shown}
          aria-label={shown ? 'Нууц үгийг далдлах' : 'Нууц үгийг харах'}
          title={shown ? 'Далдлах' : 'Харах'}
          // Tapping this must not blur the box on a phone, or the keyboard
          // closes and the caret is lost mid-word.
          onMouseDown={(e) => e.preventDefault()}
        >
          {shown ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
        </button>
      </div>

      {hint && <span className={styles.hint}>{hint}</span>}
      {children}
    </div>
  )
}
