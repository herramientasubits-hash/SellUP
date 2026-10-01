/**
 * What a floating rail can do with the current selection of a table it does
 * not own.
 *
 * The two are deliberately separate: `clear` is always a way back out of a
 * selection, while `remove` acts on the rows themselves and only exists where
 * that is a distinct operation. In the "por colaborador" table, deselecting a
 * person *is* removing them from the audience, so it reports no `remove` — one
 * button for one outcome instead of two that do the same thing.
 */
export interface TableSelectionActions {
  /** Drops the tick marks, leaving every row in place. */
  clear: () => void;
  /** Acts destructively on the ticked rows, when that differs from clearing. */
  remove?: () => void;
}
