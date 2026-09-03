/**
 * 可编辑表格的对外类型。
 * 业务页只需要准备行数据 + 列配置（表头），其余编辑/校验/换格都由组件内部处理。
 */

/** 行至少要有稳定 id；isNew 给「仅新增行可编辑」的列用。 */
export interface TableRowBase {
  id: number | string
  isNew?: boolean
}

export type FieldControl = 'input' | 'select' | 'datetime' | 'date' | 'number'

export interface ColumnOption {
  label: string
  value: string
}

export interface ColumnRule {
  required?: boolean
  type?: 'email'
  message: string
}

/**
 * 一列的展示与编辑描述，作为表格的「表头」传入。
 * editable 为 new-only 时，仅新增行（record.isNew）可改。
 */
export interface EditableColumn<T extends TableRowBase = TableRowBase> {
  title: string
  dataIndex: keyof T & string
  width?: number
  editable?: boolean | 'new-only'
  control?: FieldControl
  options?: ColumnOption[]
  placeholder?: string
  rules?: ColumnRule[]
  /**
   * 单元格失焦后回调。在控件原有 blur 之后触发，不拦截获焦/失焦。
   * 键盘换格时也会走到这里（因为会调用控件自己的 blur）。
   */
  onBlur?: (record: T) => void
}
