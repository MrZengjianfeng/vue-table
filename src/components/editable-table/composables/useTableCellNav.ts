/**
 * 表格单元格键盘导航。
 *
 * 行为约定：
 * - 换格只用 Shift+方向键 / 回车。单独按方向键不换格。
 * - 回车：换到下一个可编辑格（同行向右）；行末则到下一行第一个可编辑格；最后一行最后一列不移动。
 *   回车进入目标格时，Input 内容全选。
 * - Shift+方向键：立刻换格，进入后内容全选。
 *   上/下同一字段换行，左/右同一行换列，只读列自动跳过。
 * - Select 获焦时，普通方向键改当前选项（上/左 = 上一项，下/右 = 下一项），不换格。
 *   到第一个/最后一个选项后不再循环。Shift+方向键仍换格。
 * - Input 左右只在框内走光标；全选后按左从末尾往前，不跳到开头。
 * - DatePicker 获焦时，普通方向键改日期：上 -7 天、下 +7 天、左 -1 天、右 +1 天。
 *   空值从今天起算；带时分秒的字段只改日期、保留时间。Shift+方向键仍换格。
 * - 第一行 Shift+上、最后一行 Shift+下、该行首个表单 Shift+左、末个表单 Shift+右、表末按回车：不移动、不循环。
 */
import { nextTick, type InjectionKey } from 'vue' // nextTick：聚焦后再滚动，避免 DOM 尚未更新；InjectionKey：给 provide/inject 做类型约束
import { isFieldEditable } from '../helpers' // 判断某行某列当前是否可编辑（例如已有用户的用户名只读）
import type { EditableColumn, TableRowBase } from '../types' // 列配置与行数据的基础类型

/** 方向键与回车对应的移动方向。回车是「下一格」，不是「下一行」。 */
export type NavDirection = 'up' | 'down' | 'left' | 'right' | 'enter'

/** 进入目标 Input 后：光标放开头 / 末尾，或全选内容。 */
export type CaretEdge = 'start' | 'end' | 'all'

/** 单个可编辑单元格对外暴露的操作，供父级按 rowId+field 查找并调用。 */
export interface CellNavHandle {
  /** 聚焦本格；Select/DatePicker 会同时打开弹窗，并走控件原有的 focus。 */
  focus: (edge: CaretEdge) => void
  /**
   * 先关弹窗，再让当前控件真正失焦。
   * 必须发出原生 blur，Form.Item 的 onFieldBlur（失焦校验）才能跑。
   */
  blur: () => void | Promise<void>
  /** 单元格根节点，用于 scrollIntoView。 */
  el: () => HTMLElement | undefined
  /** Select 用方向键切换选项：-1 上一项，+1 下一项。非 Select 可省略。 */
  stepOption?: (delta: -1 | 1) => void
  /** DatePicker 用方向键加减天数。非日期格可省略。 */
  stepDate?: (days: number) => void
}

/** 由 EditableTable provide、FieldCell inject 的导航注册表。 */
export interface TableCellNavApi {
  registerCell: (rowId: string, field: string, handle: CellNavHandle) => void // 单元格挂载时登记句柄
  unregisterCell: (rowId: string, field: string) => void // 单元格卸载时从注册表删除
  blurCell: (rowId: string, field: string) => void | Promise<void> // 按坐标让指定格失焦
  focusCell: (rowId: string, field: string, edge: CaretEdge) => void // 按坐标聚焦指定格，并滚动进可视区
  stepSelect: (rowId: string, field: string, delta: -1 | 1) => void // 让指定 Select 切到上/下一项
  stepDate: (rowId: string, field: string, days: number) => void // 让指定 DatePicker 加减天数
}

/** 父子组件共享导航 API 的 inject key，避免字符串 key 冲突。 */
export const TABLE_CELL_NAV_KEY: InjectionKey<TableCellNavApi> = Symbol('tableCellNav')

/** 把 KeyboardEvent.key 映射成内部方向枚举；未列出的按键不参与导航。 */
const arrowKeyMap: Record<string, NavDirection> = {
  ArrowUp: 'up', // 上方向键 → 向上换行（需配合 Shift）或 Select/日期步进
  ArrowDown: 'down', // 下方向键 → 向下换行（需配合 Shift）或 Select/日期步进
  ArrowLeft: 'left', // 左方向键 → 同行向左换列（需配合 Shift）或光标/选项/日期
  ArrowRight: 'right', // 右方向键 → 同行向右换列（需配合 Shift）或光标/选项/日期
  Enter: 'enter', // 回车 → 下一个可编辑格，与方向键换格分开处理
}

/** 把原生 key 转成 NavDirection；不是方向键/回车则返回 null，调用方应忽略这次按键。 */
export function arrowDirection(key: string): NavDirection | null {
  return arrowKeyMap[key] ?? null // 查表；没有对应项说明不是导航键
}

/** 四个方向键的集合，用来判断「是否按了方向键」（不含回车）。 */
const arrowKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

/** 输入法合成中、Ctrl/Alt/Meta，或 Shift 配非方向键时不导航。Shift+方向键用于换格。 */
export function shouldIgnoreNavKey(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return true // 中文输入法组字过程中不要抢按键；229 是部分浏览器的合成键码
  if (event.ctrlKey || event.altKey || event.metaKey) return true // 保留浏览器/系统快捷键（复制、刷新等）
  if (event.shiftKey && !arrowKeys.has(event.key)) return true // Shift+字母等不是换格，交给浏览器；只有 Shift+方向键才导航
  return false // 其余按键交给后续逻辑判断是否换格
}

/** Shift+方向键：立刻换格，进入后全选。 */
export function isShiftArrowNav(event: KeyboardEvent) {
  return event.shiftKey && arrowKeys.has(event.key) // 必须同时按住 Shift 且当前键是四个方向之一
}

/**
 * 当前焦点是否落在已展开的下拉 / 日期面板上。
 * 弹窗打开时左右键不再走 Input 光标，而是直接换格。
 */
export function isPopupOpen(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false // 事件目标不是 DOM 元素（例如 window）则无法判断
  if (target.closest('[data-nav-popup-open="true"]')) return true // 业务自定义标记：单元格自己声明弹窗已开
  return Boolean(target.closest('.ant-select-open, .ant-select-dropdown, .ant-picker-dropdown')) // Ant Design 下拉/日期面板打开时的 class
}

/** 从事件目标向上找到带 data-nav-row / data-nav-field 的单元格。 */
function closestNavCell(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return null // 非元素无法用 closest 向上找
  const cell = target.closest('[data-nav-row][data-nav-field]') // 同时带行 id 和字段名的单元格根节点
  if (!(cell instanceof HTMLElement)) return null // closest 可能命中 SVG 等非 HTMLElement
  const rowId = cell.dataset.navRow // data-nav-row → 当前行 id
  const field = cell.dataset.navField // data-nav-field → 当前列字段名
  if (!rowId || !field) return null // 属性缺失则无法定位单元格
  return { rowId, field } // 返回当前格坐标，供后续查「下一格」
}

/**
 * 取出真正可以移动光标的原生 input。
 * Select 内部也有隐藏 search input，不能按文本光标处理。
 */
function nativeTextInput(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return null // 非元素没有输入框语义
  if (target.closest('.ant-select')) return null // Select 里的 search input 不是用户编辑的文本，排除
  if (target instanceof HTMLTextAreaElement) return target // textarea 也要走光标逻辑
  if (target instanceof HTMLInputElement) {
    const type = target.type // 读原生 type，过滤不能设选区的控件
    if (type === 'checkbox' || type === 'radio' || type === 'button' || type === 'submit' || type === 'file') {
      return null // 这些类型没有文本光标，不能 setSelectionRange
    }
    return target // 文本类 input（text、number 等）可以处理光标
  }
  return null // 点在 div 等包装节点上时，不接管光标
}

/**
 * 整段全选时按左：光标从末尾往前一格，而不是浏览器默认跳到开头。
 * 需要调用方 preventDefault。返回落点；不用接管则返回 null。
 */
export function caretAfterSelectionArrow(
  target: EventTarget | null, // 当前焦点所在节点
  direction: 'left' | 'right', // 只关心左右；上下不改光标
): number | null {
  const input = nativeTextInput(target) // 先确认是可编辑文本框
  if (!input) return null // 不是文本框则不处理
  const { selectionStart, selectionEnd, value } = input // 当前选区起点、终点和完整文本
  if (selectionStart == null || selectionEnd == null) return null // 部分类型读不到选区（如 type=number 在旧浏览器）
  if (selectionStart === selectionEnd) return null // 没有选中范围，只是光标，交给浏览器默认左右移动
  if (selectionStart !== 0 || selectionEnd !== value.length) return null // 不是「整段全选」，不特殊处理
  if (direction !== 'left') return null // 全选后按右仍走浏览器默认（通常取消选区并到末尾）
  return Math.max(0, value.length - 1) // 全选后按左：光标落到倒数第二个字符后（从末尾往前一格）；空串则为 0
}

/** 把文本框光标移到指定下标（折叠选区，不选中文字）。 */
export function setTextCaret(target: EventTarget | null, pos: number) {
  const input = nativeTextInput(target) // 同样只对真实文本框操作
  if (!input) return // 找不到输入框则静默返回
  try {
    input.setSelectionRange(pos, pos) // start === end 表示只移动光标、不选中
  } catch {
    /* some browsers reject setSelectionRange on type=number */ // number 输入框在部分浏览器会抛错，忽略即可
  }
}

/** 从左侧进入放光标开头，回车 / Shift+方向键进入全选，从右侧进入放末尾。 */
export function caretEdgeForArrival(direction: NavDirection, selectAll = false): CaretEdge {
  if (selectAll || direction === 'enter') return 'all' // 换格意图明确（Shift 或回车）时全选，方便直接覆盖输入
  if (direction === 'right') return 'start' // 从左边那一格进来，光标放开头，方便继续往右打字
  return 'end' // 从右边/上下进来，光标放末尾
}

/** 按 dataIndex 找到列配置；找不到说明字段不在当前表头里。 */
function columnOf<T extends TableRowBase>(columns: EditableColumn<T>[], field: string) {
  return columns.find((item) => item.dataIndex === field) // 列配置里 dataIndex 即字段名
}

/** 当前字段是否是日期/日期时间控件（需要方向键改日期，而不是换格）。 */
function isDateControl<T extends TableRowBase>(columns: EditableColumn<T>[], field: string) {
  const control = columnOf(columns, field)?.control // 读列上的控件类型
  return control === 'date' || control === 'datetime' // 两种日期控件都走 stepDate
}

/** DatePicker 方向键对应的天数：上/下按周，左/右按天。 */
const dateStepDays: Record<'up' | 'down' | 'left' | 'right', number> = {
  up: -7, // 上：减一周
  down: 7, // 下：加一周
  left: -1, // 左：减一天
  right: 1, // 右：加一天
}

/** 当前行实际可编辑的字段，按列配置顺序。 */
function editableFields<T extends TableRowBase>(columns: EditableColumn<T>[], record: T) {
  return columns.filter((item) => isFieldEditable(item, record)).map((item) => String(item.dataIndex)) // 先过滤只读列，再取出字段名列表
}

/**
 * 按方向查找下一个表单单元格。
 * 找不到（已到当前表边界）返回 null，调用方应保持焦点不动。
 */
export function findNextCell<T extends TableRowBase>(
  pageRows: T[], // 当前页全部行（导航只在本页内，不翻页）
  columns: EditableColumn<T>[], // 列配置，决定哪些字段可编辑、顺序如何
  rowId: string, // 当前行 id
  field: string, // 当前字段名
  direction: NavDirection, // 要走的方向 / 回车
): { rowId: string; field: string } | null {
  const rowIndex = pageRows.findIndex((item) => String(item.id) === rowId) // 把行 id 转成数组下标；id 统一转字符串避免 number/string 对不上
  if (rowIndex < 0) return null // 当前行不在本页数据里，无法导航

  if (direction === 'left' || direction === 'right') {
    const record = pageRows[rowIndex] // 取当前行数据，用来判断本行哪些列可编辑
    const fields = editableFields(columns, record) // 本行可编辑字段，从左到右
    const current = fields.indexOf(field) // 当前字段在可编辑列表中的位置
    if (current < 0) return null // 当前格其实不可编辑（或字段名对不上），放弃
    const next = direction === 'left' ? current - 1 : current + 1 // 左减 1、右加 1
    if (next < 0 || next >= fields.length) return null // 已经是本行第一个/最后一个可编辑格，不循环
    return { rowId: String(record.id), field: fields[next] } // 仍在同一行，只换字段
  }

  // 回车：同行下一个可编辑格；行末换到下一行第一个可编辑格；表末不动。
  if (direction === 'enter') {
    const record = pageRows[rowIndex] // 当前行
    const fields = editableFields(columns, record) // 本行可编辑字段
    const current = fields.indexOf(field) // 当前字段下标
    if (current < 0) return null // 当前格不在可编辑列表中
    if (current + 1 < fields.length) {
      return { rowId: String(record.id), field: fields[current + 1] } // 同行还有下一格，直接右移
    }
    for (let index = rowIndex + 1; index < pageRows.length; index += 1) {
      const nextRecord = pageRows[index] // 从下一行开始往下找
      const nextFields = editableFields(columns, nextRecord) // 该行可编辑字段
      if (nextFields.length > 0) {
        return { rowId: String(nextRecord.id), field: nextFields[0] } // 落到该行第一个可编辑格
      }
    }
    return null // 下面没有任何可编辑格（含最后一行最后一列），停在原地
  }

  const step = direction === 'up' ? -1 : 1 // 上走负下标，下走正下标；能走到这里只剩 up/down
  const config = columnOf(columns, field) // 垂直移动要沿同一列，先拿到该列配置
  if (!config) return null // 列配置丢失则无法判断目标行该列是否可编辑

  // 垂直移动保持同一字段，跳过该列不可编辑的行（例如已有用户的用户名）。
  for (let index = rowIndex + step; index >= 0 && index < pageRows.length; index += step) {
    const record = pageRows[index] // 相邻行（或再往上/往下的行）
    if (isFieldEditable(config, record)) {
      return { rowId: String(record.id), field } // 该行同一字段可编辑，作为落点
    }
  }

  return null // 已经到第一行/最后一行，或沿途全是只读，不循环
}

/** 注册表内部 key：行 id 与字段名用冒号拼接，保证一格一个句柄。 */
function cellKey(rowId: string, field: string) {
  return `${rowId}:${field}`
}

/** 维护「行 + 字段 → 单元格句柄」的注册表，供表格聚焦指定格。 */
export function useTableCellNav(): TableCellNavApi {
  const cells = new Map<string, CellNavHandle>() // 运行时注册表；单元格 mount 写入、unmount 删除

  function registerCell(rowId: string, field: string, handle: CellNavHandle) {
    cells.set(cellKey(rowId, field), handle) // 覆盖同坐标旧句柄（例如同一格重渲染）
  }

  function unregisterCell(rowId: string, field: string) {
    cells.delete(cellKey(rowId, field)) // 避免卸载后仍持有 DOM 引用
  }

  function blurCell(rowId: string, field: string) {
    return cells.get(cellKey(rowId, field))?.blur() // 格不存在时短路；存在则关弹窗并原生 blur
  }

  function focusCell(rowId: string, field: string, edge: CaretEdge) {
    const handle = cells.get(cellKey(rowId, field)) // 按坐标取句柄
    if (!handle) return // 目标格尚未注册（虚拟滚动未渲染等），不能聚焦
    handle.focus(edge) // 先聚焦并按 edge 设置光标/全选
    nextTick(() => {
      handle.el()?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) // 等焦点和弹窗更新后再滚，只滚到刚好可见，避免猛跳
    })
  }

  function stepSelect(rowId: string, field: string, delta: -1 | 1) {
    cells.get(cellKey(rowId, field))?.stepOption?.(delta) // 非 Select 没有 stepOption，可选链直接跳过
  }

  function stepDate(rowId: string, field: string, days: number) {
    cells.get(cellKey(rowId, field))?.stepDate?.(days) // 非日期格没有 stepDate，可选链直接跳过
  }

  return { registerCell, unregisterCell, blurCell, focusCell, stepSelect, stepDate } // 交给表格 provide 给每个 FieldCell
}

/**
 * 根据一次 keydown 决定要不要换格。
 * 返回 null 表示放行浏览器默认行为（例如 Input 内移动光标）。
 * next 为 null 表示已到边界，调用方仍应 preventDefault，避免 Select 被方向键改值。
 */
export function resolveNavTarget<T extends TableRowBase>(
  event: KeyboardEvent, // 原始键盘事件
  pageRows: T[], // 当前页行数据
  columns: EditableColumn<T>[], // 列配置
): {
  direction: NavDirection // 这次按键对应的方向
  current: { rowId: string; field: string } // 按键发生时所在的格
  next: { rowId: string; field: string } | null // 要去的下一格；边界则为 null
  selectAll: boolean // 进入 next 时是否全选
  /** Select 获焦时用方向键改选项；有值则不要换格。 */
  stepSelect?: -1 | 1
  /** DatePicker 获焦时用方向键加减天数；有值则不要换格。 */
  stepDate?: number
  /** 全选后按左：把光标放到这个位置，不换格。 */
  caretPos?: number
} | null {
  const direction = arrowDirection(event.key) // 先把 key 转成内部方向
  if (!direction) return null // 不是方向键/回车，完全不管
  if (shouldIgnoreNavKey(event)) return null // 输入法、修饰键等场景放行

  const cell = closestNavCell(event.target) // 从事件目标找到当前单元格坐标
  if (!cell) return null // 焦点不在带 data-nav-* 的格子里（例如工具栏）

  const shiftNav = isShiftArrowNav(event) // 是否「Shift+方向键立刻换格」
  // Select：普通方向键改选项（左=上，右=下）；Shift 仍换格；回车仍去下一格。
  if (!shiftNav && direction !== 'enter' && columnOf(columns, cell.field)?.control === 'select') {
    return {
      direction, // 保留方向，方便调用方日志或二次判断
      current: cell, // 仍停在当前格
      next: null, // 明确不换格
      selectAll: false, // 不进入新格，无需全选
      stepSelect: direction === 'up' || direction === 'left' ? -1 : 1, // 上/左选上一项，下/右选下一项
    }
  }

  // DatePicker：上 -7 天、下 +7 天、左 -1 天、右 +1 天。
  if (!shiftNav && direction !== 'enter' && isDateControl(columns, cell.field)) {
    return {
      direction,
      current: cell,
      next: null, // 改日期，不换格
      selectAll: false,
      stepDate: dateStepDays[direction], // 这里 direction 只可能是 up/down/left/right
    }
  }

  // 普通上/下不再换格（非 Select / DatePicker）。
  if ((direction === 'up' || direction === 'down') && !shiftNav) return null // Input 里单独按上下交给浏览器（或控件自己）

  const popupOpen = isPopupOpen(event.target) // 下拉/日期面板是否已展开
  // 全选后按左：从末尾往前移，不要跳到开头。
  if (!shiftNav && !popupOpen && (direction === 'left' || direction === 'right')) {
    const caretPos = caretAfterSelectionArrow(event.target, direction) // 仅整段全选 + 按左会得到落点
    if (caretPos != null) {
      return {
        direction,
        current: cell,
        next: null, // 不换格，只改光标
        selectAll: false,
        caretPos, // 调用方据此 setTextCaret 并 preventDefault
      }
    }
  }
  // 普通方向键不换格：左右只在当前格走光标。换格用 Shift+方向键 / 回车。
  if (!shiftNav && direction !== 'enter') return null // 单独按左/右：交给浏览器在 Input 内移动光标

  return {
    direction,
    current: cell,
    next: findNextCell(pageRows, columns, cell.rowId, cell.field, direction), // 真正算下一格；边界时 next 为 null
    selectAll: shiftNav || direction === 'enter', // Shift 换格和回车进入时都全选
  }
}
