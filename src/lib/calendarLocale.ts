import { format, parse, startOfWeek, getDay } from 'date-fns'
import { sv } from 'date-fns/locale'
import { dateFnsLocalizer } from 'react-big-calendar'
import type { Formats, Messages } from 'react-big-calendar'

/** Svensk lokalisering: veckan börjar på måndag, 24-timmarsklocka. */
export const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (date: Date) => startOfWeek(date, { weekStartsOn: 1 }),
  getDay,
  locales: { sv },
})

export const messages: Messages = {
  allDay: 'Heldag',
  previous: '←',
  next: '→',
  today: 'Idag',
  month: 'Månad',
  week: 'Vecka',
  day: 'Dag',
  agenda: 'Agenda',
  date: 'Datum',
  time: 'Tid',
  event: 'Händelse',
  noEventsInRange: 'Inga händelser i den här perioden.',
  showMore: (count: number) => `+${count} till`,
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export const formats: Formats = {
  timeGutterFormat: 'HH:mm',
  weekdayFormat: (date, culture, l) => cap(l!.format(date, 'EEE', culture)),
  dayFormat: (date, culture, l) => cap(l!.format(date, 'EEE d/M', culture)),
  monthHeaderFormat: (date, culture, l) => cap(l!.format(date, 'MMMM yyyy', culture)),
  dayHeaderFormat: (date, culture, l) => cap(l!.format(date, 'EEEE d MMMM', culture)),
  dayRangeHeaderFormat: ({ start, end }, culture, l) =>
    `${l!.format(start, 'd MMM', culture)} – ${l!.format(end, 'd MMM yyyy', culture)}`,
  agendaHeaderFormat: ({ start, end }, culture, l) =>
    `${l!.format(start, 'd MMM', culture)} – ${l!.format(end, 'd MMM yyyy', culture)}`,
  agendaDateFormat: (date, culture, l) => cap(l!.format(date, 'EEE d MMM', culture)),
  agendaTimeFormat: 'HH:mm',
  eventTimeRangeFormat: ({ start, end }, culture, l) =>
    `${l!.format(start, 'HH:mm', culture)}–${l!.format(end, 'HH:mm', culture)}`,
  agendaTimeRangeFormat: ({ start, end }, culture, l) =>
    `${l!.format(start, 'HH:mm', culture)}–${l!.format(end, 'HH:mm', culture)}`,
  selectRangeFormat: ({ start, end }, culture, l) =>
    `${l!.format(start, 'HH:mm', culture)}–${l!.format(end, 'HH:mm', culture)}`,
}
