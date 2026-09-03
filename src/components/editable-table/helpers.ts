import type { EditableColumn, TableRowBase } from './types'

/** 当前行该列是否渲染为表单。new-only 只在新增行开放。 */
export function isFieldEditable<T extends TableRowBase>(
  config: EditableColumn<T>,
  record: T,
) {
  if (config.editable === true) return true
  if (config.editable === 'new-only') return Boolean(record.isNew)
  return false
}

/**
 * 只读单元格展示：有 options 时用 label，空值显示为 "-"。
 */
export function displayField<T extends TableRowBase>(
  config: EditableColumn<T>,
  record: T,
) {
  const value = record[config.dataIndex]
  if (config.options) {
    const match = config.options.find((item) => item.value === String(value ?? ''))
    if (match) return match.label
  }
  if (value === '' || value === undefined || value === null) return '-'
  return String(value)
}
