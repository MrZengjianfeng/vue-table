import type { EditableColumn, TableRowBase } from './types' // 列配置（可编辑策略、选项）与行必须带 id / isNew

/**
 * 当前行该列是否渲染为表单。new-only 只在新增行开放。
 *
 * 给 FieldCell 决定画输入框还是只读文本，也给键盘导航跳过不可编辑格。
 * 未写 editable、或写成 false：一律只读。
 */
export function isFieldEditable<T extends TableRowBase>(
  config: EditableColumn<T>, // 本列配置，读 editable
  record: T, // 当前行，new-only 时看 isNew
) {
  if (config.editable === true) return true // 显式可编辑：新旧行都是表单
  if (config.editable === 'new-only') return Boolean(record.isNew) // 只新增行可改（例如用户名保存后锁死）；isNew 缺省当 false
  return false // editable 为 false 或未配置：只读，不注册导航
}

/**
 * 只读单元格展示：有 options 时用 label，空值显示为 "-"。
 *
 * FieldCell 在 !editable 时调用。下拉列存的是 value，界面要显示中文 label。
 */
export function displayField<T extends TableRowBase>(
  config: EditableColumn<T>, // 本列配置，读 dataIndex / options
  record: T, // 当前行，按字段取出原始值
) {
  const value = record[config.dataIndex] // 行对象上该字段的原始值（可能是 string / number / 空）
  if (config.options) {
    const match = config.options.find((item) => item.value === String(value ?? '')) // 按 value 找选项；null/undefined 当成空串，避免和选项对不上
    if (match) return match.label // 找到则显示文案（如 1 →「启用」），而不是原始 value
  }
  if (value === '' || value === undefined || value === null) return '-' // 文本/数字空值占位，避免单元格空白看不清
  return String(value) // 没有选项或对不上选项：原样转成字符串展示
}
