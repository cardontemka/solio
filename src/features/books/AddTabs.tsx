'use client'

import { useState } from 'react'
import { AddBookForm } from './AddBookForm'
import { AddRequestForm } from '@/features/requests/AddRequestForm'
import styles from './AddTabs.module.css'

/**
 * Two things a person adds, on one page.
 *
 * "I have this" and "I am looking for this" are the same sentence with the verb
 * changed, and they were on opposite sides of the site: one behind a nav item,
 * the other behind a button. Putting them together means the answer to "it is
 * not here" is one tab away from the search that failed, instead of a
 * destination somebody has to already know about.
 */
export function AddTabs() {
  const [mode, setMode] = useState<'have' | 'want'>('have')

  return (
    <>
      <div className={styles.tabs} role="group" aria-label="Юу нэмэх вэ">
        <button
          type="button"
          className={styles.tab}
          aria-pressed={mode === 'have'}
          onClick={() => setMode('have')}
        >
          Гартаа байгаа
          <span className={styles.tabNote}>Ном, пянзаа бүртгэх</span>
        </button>
        <button
          type="button"
          className={styles.tab}
          aria-pressed={mode === 'want'}
          onClick={() => setMode('want')}
        >
          Хайж байгаа
          <span className={styles.tabNote}>Сураглал нийтлэх</span>
        </button>
      </div>

      <p className={styles.lead}>
        {mode === 'have'
          ? 'Гартаа байгаа зүйлээ бүртгэнэ. Бусад хүн үүнийг хараад солилцоо санал болгож, эсвэл та өөрөө хадгалах цэгт хандивлаж оноо цуглуулж болно.'
          : 'Хайж байгаа зүйлээ бичихэд бусад хүн хараад, байвал доор нь хариу бичнэ. Гартаа байхыг шаардахгүй.'}
      </p>

      {mode === 'have' ? <AddBookForm /> : <AddRequestForm />}
    </>
  )
}
