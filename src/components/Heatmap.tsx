import { useMemo } from 'react'
import { format, startOfWeek, addDays, addWeeks, differenceInCalendarWeeks, isAfter } from 'date-fns'
import { sv } from 'date-fns/locale'

interface HeatmapProps {
  /** datum (yyyy-MM-dd) -> värde. 0/saknas = tom cell */
  values: Map<string, number>
  /** värdet som motsvarar full färgstyrka */
  max?: number
  color: string
  /** etikett i tooltip, t.ex. "pass" eller vanans namn */
  unit?: string
}

/** GitHub-stil årsheatmap: 52 veckor som kolumner, mån–sön som rader. */
export default function Heatmap({ values, max = 1, color, unit = '' }: HeatmapProps) {
  const today = new Date()
  const gridStart = startOfWeek(addWeeks(today, -51), { weekStartsOn: 1 })
  const weekCount = differenceInCalendarWeeks(today, gridStart, { weekStartsOn: 1 }) + 1

  const monthLabels = useMemo(() => {
    const labels: { week: number; label: string }[] = []
    let last = ''
    for (let w = 0; w < weekCount; w++) {
      const d = addWeeks(gridStart, w)
      const m = format(d, 'MMM', { locale: sv })
      if (m !== last) {
        labels.push({ week: w, label: m })
        last = m
      }
    }
    // hoppa över första etiketten om nästa kommer direkt (trångt)
    return labels.filter((l, i) => i === 0 || l.week - labels[i - 1].week >= 3 || i === labels.length - 1)
  }, [gridStart, weekCount])

  const CELL = 11
  const GAP = 2
  const LABEL_H = 14
  const width = weekCount * (CELL + GAP)
  const height = 7 * (CELL + GAP) + LABEL_H

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} role="img" aria-label="Årsöversikt">
        {monthLabels.map((m) => (
          <text key={m.week} x={m.week * (CELL + GAP)} y={10} fontSize="9" fill="#8b95ad" className="capitalize">
            {m.label}
          </text>
        ))}
        {Array.from({ length: weekCount }, (_, w) =>
          Array.from({ length: 7 }, (_, d) => {
            const day = addDays(addWeeks(gridStart, w), d)
            if (isAfter(day, today)) return null
            const key = format(day, 'yyyy-MM-dd')
            const v = values.get(key) ?? 0
            const opacity = v <= 0 ? 0 : Math.min(1, 0.3 + 0.7 * (v / max))
            return (
              <rect
                key={key}
                x={w * (CELL + GAP)}
                y={LABEL_H + d * (CELL + GAP)}
                width={CELL}
                height={CELL}
                rx={2.5}
                fill={v > 0 ? color : '#1c2438'}
                opacity={v > 0 ? opacity : 1}
              >
                <title>{`${format(day, 'EEE d MMM yyyy', { locale: sv })}${v > 0 ? ` · ${v} ${unit}`.trimEnd() : ''}`}</title>
              </rect>
            )
          })
        )}
      </svg>
    </div>
  )
}
