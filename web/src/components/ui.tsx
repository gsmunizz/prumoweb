import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { useId } from 'react'

// Componentes base do design system (DS 1.0): campo 48px com raio 14, botão primário 56px.

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
  hint?: string
}

export function Field({ label, error, hint, className = '', ...props }: FieldProps) {
  const id = useId()
  const note = error ?? hint
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-bold text-ink-2">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={note ? `${id}-note` : undefined}
        className={`h-12 rounded-field border bg-surface px-3.5 text-[15px] text-ink outline-none placeholder:text-ink-3 focus-visible:border-cobalt focus-visible:ring-2 focus-visible:ring-cobalt/30 ${error ? 'border-error' : 'border-line'} ${className}`}
        {...props}
      />
      {note && (
        <p id={`${id}-note`} className={`text-xs ${error ? 'font-semibold text-error' : 'text-ink-3'}`}>
          {note}
        </p>
      )}
    </div>
  )
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost'
  busy?: boolean
}

export function Button({ variant = 'primary', busy, children, disabled, className = '', ...props }: ButtonProps) {
  const base =
    'flex h-14 items-center justify-center gap-2 rounded-2xl text-base font-extrabold disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt'
  const look =
    variant === 'primary'
      ? 'bg-cobalt text-white'
      : 'border border-line bg-surface text-ink'
  return (
    <button className={`${base} ${look} ${className}`} disabled={disabled || busy} {...props}>
      {busy ? 'Aguarde…' : children}
    </button>
  )
}

export function FormError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-field bg-error-soft px-3.5 py-3 text-sm font-semibold text-error">
      {children}
    </p>
  )
}
