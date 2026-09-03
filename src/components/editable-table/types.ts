/**
 * 可编辑表格的对外类型。
 * 业务页只需要准备行数据 + 列配置（表头），其余编辑/校验/换格都由组件内部处理。
 *
 * 文件分工：
 *   TableRowBase   → 每一行必须满足的最小形状
 *   FieldControl   → FieldCell 按这个枚举决定渲染哪种 antd 控件
 *   ColumnOption   → Select 的选项；只读展示时用 label
 *   ColumnRule     → 交给 a-form-item 的校验规则
 *   EditableColumn → 一列表头 + 编辑行为，父页面传入 columns
 */

/** 行至少要有稳定 id；isNew 给「仅新增行可编辑」的列用。 */
export interface TableRowBase {
  id: number | string // 行主键：表格 row-key、导航注册表、form name 找行下标都靠它；number/string 都能用
  isNew?: boolean // 可选：本地新增、尚未保存的行标成 true；editable='new-only' 的列只对这些行开放编辑
}

/** FieldCell 按此渲染控件；不传时默认当文本 Input。 */
export type FieldControl =
  | 'input' // 普通文本框；左右键走光标，Shift+方向 / 回车换格
  | 'select' // 下拉；普通方向键改选项（不循环），Shift+方向仍换格
  | 'datetime' // 日期+时分秒；方向键只改日期、保留时间
  | 'date' // 纯日期；方向键上-7 / 下+7 / 左-1 / 右+1 天
  | 'number' // 数字框；空值写回 0，隐藏步进箭头

/** Select 的一条选项；存库用 value，界面用 label。 */
export interface ColumnOption {
  label: string // 下拉展示文案，只读格 displayField 也显示这个
  value: string // 写入行数据的值；和 record[dataIndex] 比较时会先转成字符串
}

/** 单条校验规则，形状对齐 antd Form.Item rules 的常用字段。 */
export interface ColumnRule {
  required?: boolean // true：空值不通过；保存和失焦都会跑
  type?: 'email' // 可选：按邮箱格式校验（如账号列）
  message: string // 校验失败时显示在单元格下方的文案
}

/**
 * 一列的展示与编辑描述，作为表格的「表头」传入。
 * editable 为 new-only 时，仅新增行（record.isNew）可改。
 *
 * EditableTable 用 title/dataIndex/width 画 antd 列，
 * 其余字段留给 FieldCell（控件、校验、导航是否注册）。
 */
export interface EditableColumn<T extends TableRowBase = TableRowBase> {
  title: string // 表头文字
  dataIndex: keyof T & string // 对应行对象上的字段名；& string 排除 symbol，才能当 form name / data-nav-field
  width?: number // 列宽，缺省按 120 计入横向滚动；操作列另加 90
  editable?: boolean | 'new-only' // true 整列可改；new-only 仅新增行；false/不传则只读且不注册键盘导航
  control?: FieldControl // 可编辑时用哪种控件；只读列可省略
  options?: ColumnOption[] // control='select' 时必填；只读时 displayField 用它把 value 换成 label
  placeholder?: string // 空值时输入框/下拉/日期的占位文案
  rules?: ColumnRule[] // 挂到 a-form-item；父页面 save 时整表 validate
  /**
   * 单元格失焦后回调。在控件原有 blur 之后触发，不拦截获焦/失焦。
   * 键盘换格时也会走到这里（因为会调用控件自己的 blur）。
   */
  onBlur?: (record: T) => void // 额外业务（例如失焦联想）；不能代替 Form.Item 失焦校验
}
