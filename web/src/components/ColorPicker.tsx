import { palette } from '../lib/palette'

export function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-bold text-ink-2">Cor</span>
      <div role="radiogroup" aria-label="Cor" className="flex flex-wrap gap-2.5">
        {palette.map((w) => {
          const on = w.color.toLowerCase() === value.toLowerCase()
          return (
            <button
              key={w.color}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={w.name}
              onClick={() => onChange(w.color)}
              className="size-9 rounded-full outline-offset-[3px]"
              style={{ background: w.color, outline: on ? `2.5px solid ${w.color}` : 'none' }}
            />
          )
        })}
      </div>
    </div>
  )
}
