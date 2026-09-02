import styles from './forms.module.css'

export function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null
  return <span className={styles.error}>{errors[0]}</span>
}

export function FormMessage({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p className={styles.formMessage} role="alert">
      {message}
    </p>
  )
}
