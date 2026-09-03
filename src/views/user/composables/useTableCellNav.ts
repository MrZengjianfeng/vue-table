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
import { nextTick, type InjectionKey } from 'vue'
import type { SysUser } from '@/type'
import { isFieldEditable, userColumnConfigs } from '../constants'

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

/** 由 UserTable provide、UserFieldCell inject 的导航注册表。 */
export interface TableCellNavApi {
  registerCell: (rowId: number, field: string, handle: CellNavHandle) => void
  unregisterCell: (rowId: number, field: string) => void
  blurCell: (rowId: number, field: string) => void | Promise<void>
  focusCell: (rowId: number, field: string, edge: CaretEdge) => void
  stepSelect: (rowId: number, field: string, delta: -1 | 1) => void
  stepDate: (rowId: number, field: string, days: number) => void
}

export const TABLE_CELL_NAV_KEY: InjectionKey<TableCellNavApi> = Symbol('tableCellNav')

const arrowKeyMap: Record<string, NavDirection> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Enter: 'enter',
}

export function arrowDirection(key: string): NavDirection | null {
  return arrowKeyMap[key] ?? null
}

const arrowKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

/** 输入法合成中、Ctrl/Alt/Meta，或 Shift 配非方向键时不导航。Shift+方向键用于换格。 */
export function shouldIgnoreNavKey(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return true
  if (event.ctrlKey || event.altKey || event.metaKey) return true
  if (event.shiftKey && !arrowKeys.has(event.key)) return true
  return false
}

/** Shift+方向键：立刻换格，进入后全选。 */
export function isShiftArrowNav(event: KeyboardEvent) {
  return event.shiftKey && arrowKeys.has(event.key)
}

/**
 * 当前焦点是否落在已展开的下拉 / 日期面板上。
 * 弹窗打开时左右键不再走 Input 光标，而是直接换格。
 */
export function isPopupOpen(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.closest('[data-nav-popup-open="true"]')) return true
  return Boolean(target.closest('.ant-select-open, .ant-select-dropdown, .ant-picker-dropdown'))
}

/** 从事件目标向上找到带 data-nav-row / data-nav-field 的单元格。 */
function closestNavCell(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return null
  const cell = target.closest('[data-nav-row][data-nav-field]')
  if (!(cell instanceof HTMLElement)) return null
  const rowId = Number(cell.dataset.navRow)
  const field = cell.dataset.navField
  if (!Number.isFinite(rowId) || !field) return null
  return { rowId, field: field as keyof SysUser }
}

/**
 * 取出真正可以移动光标的原生 input。
 * Select 内部也有隐藏 search input，不能按文本光标处理。
 */
function nativeTextInput(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return null
  if (target.closest('.ant-select')) return null
  if (target instanceof HTMLTextAreaElement) return target
  if (target instanceof HTMLInputElement) {
    const type = target.type
    if (type === 'checkbox' || type === 'radio' || type === 'button' || type === 'submit' || type === 'file') {
      return null
    }
    return target
  }
  return null
}

/**
 * 整段全选时按左：光标从末尾往前一格，而不是浏览器默认跳到开头。
 * 需要调用方 preventDefault。返回落点；不用接管则返回 null。
 */
export function caretAfterSelectionArrow(
  target: EventTarget | null,
  direction: 'left' | 'right',
): number | null {
  const input = nativeTextInput(target)
  if (!input) return null
  const { selectionStart, selectionEnd, value } = input
  if (selectionStart == null || selectionEnd == null) return null
  if (selectionStart === selectionEnd) return null
  if (selectionStart !== 0 || selectionEnd !== value.length) return null
  if (direction !== 'left') return null
  return Math.max(0, value.length - 1)
}

export function setTextCaret(target: EventTarget | null, pos: number) {
  const input = nativeTextInput(target)
  if (!input) return
  try {
    input.setSelectionRange(pos, pos)
  } catch {
    /* some browsers reject setSelectionRange on type=number */
  }
}

/** 从左侧进入放光标开头，回车 / Shift+方向键进入全选，从右侧进入放末尾。 */
export function caretEdgeForArrival(direction: NavDirection, selectAll = false): CaretEdge {
  if (selectAll || direction === 'enter') return 'all'
  if (direction === 'right') return 'start'
  return 'end'
}

function columnOf(field: keyof SysUser) {
  return userColumnConfigs.find((item) => item.dataIndex === field)
}

function isDateControl(field: keyof SysUser) {
  const control = columnOf(field)?.control
  return control === 'date' || control === 'datetime'
}

/** DatePicker 方向键对应的天数：上/下按周，左/右按天。 */
const dateStepDays: Record<'up' | 'down' | 'left' | 'right', number> = {
  up: -7,
  down: 7,
  left: -1,
  right: 1,
}

/** 当前行实际可编辑的字段，按列配置顺序（已有用户没有「用户名」）。 */
function editableFields(record: SysUser) {
  return userColumnConfigs.filter((item) => isFieldEditable(item, record)).map((item) => item.dataIndex)
}

/**
 * 按方向查找下一个表单单元格。
 * 找不到（已到当前表边界）返回 null，调用方应保持焦点不动。
 */
export function findNextCell(
  pageRows: SysUser[],
  rowId: number,
  field: keyof SysUser,
  direction: NavDirection,
): { rowId: number; field: keyof SysUser } | null {
  const rowIndex = pageRows.findIndex((item) => item.id === rowId)
  if (rowIndex < 0) return null

  if (direction === 'left' || direction === 'right') {
    const record = pageRows[rowIndex]
    const fields = editableFields(record)
    const current = fields.indexOf(field)
    if (current < 0) return null
    const next = direction === 'left' ? current - 1 : current + 1
    if (next < 0 || next >= fields.length) return null
    return { rowId: record.id, field: fields[next] }
  }

  // 回车：同行下一个可编辑格；行末换到下一行第一个可编辑格；表末不动。
  if (direction === 'enter') {
    const record = pageRows[rowIndex]
    const fields = editableFields(record)
    const current = fields.indexOf(field)
    if (current < 0) return null
    if (current + 1 < fields.length) {
      return { rowId: record.id, field: fields[current + 1] }
    }
    for (let index = rowIndex + 1; index < pageRows.length; index += 1) {
      const nextRecord = pageRows[index]
      const nextFields = editableFields(nextRecord)
      if (nextFields.length > 0) {
        return { rowId: nextRecord.id, field: nextFields[0] }
      }
    }
    return null
  }

  const step = direction === 'up' ? -1 : 1
  const config = columnOf(field)
  if (!config) return null

  // 垂直移动保持同一字段，跳过该列不可编辑的行（例如已有用户的用户名）。
  for (let index = rowIndex + step; index >= 0 && index < pageRows.length; index += step) {
    const record = pageRows[index]
    if (isFieldEditable(config, record)) {
      return { rowId: record.id, field }
    }
  }

  return null
}

function cellKey(rowId: number, field: string) {
  return `${rowId}:${field}`
}

/** 维护「行 + 字段 → 单元格句柄」的注册表，供 UserTable 聚焦指定格。 */
export function useTableCellNav(): TableCellNavApi {
  const cells = new Map<string, CellNavHandle>()

  function registerCell(rowId: number, field: string, handle: CellNavHandle) {
    cells.set(cellKey(rowId, field), handle)
  }

  function unregisterCell(rowId: number, field: string) {
    cells.delete(cellKey(rowId, field))
  }

  function blurCell(rowId: number, field: string) {
    return cells.get(cellKey(rowId, field))?.blur()
  }

  function focusCell(rowId: number, field: string, edge: CaretEdge) {
    const handle = cells.get(cellKey(rowId, field))
    if (!handle) return
    handle.focus(edge)
    nextTick(() => {
      handle.el()?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
  }

  function stepSelect(rowId: number, field: string, delta: -1 | 1) {
    cells.get(cellKey(rowId, field))?.stepOption?.(delta)
  }

  function stepDate(rowId: number, field: string, days: number) {
    cells.get(cellKey(rowId, field))?.stepDate?.(days)
  }

  return { registerCell, unregisterCell, blurCell, focusCell, stepSelect, stepDate }
}

/**
 * 根据一次 keydown 决定要不要换格。
 * 返回 null 表示放行浏览器默认行为（例如 Input 内移动光标）。
 * next 为 null 表示已到边界，调用方仍应 preventDefault，避免 Select 被方向键改值。
 */
export function resolveNavTarget(
  event: KeyboardEvent,
  pageRows: SysUser[],
): {
  direction: NavDirection
  current: { rowId: number; field: keyof SysUser }
  next: { rowId: number; field: keyof SysUser } | null
  selectAll: boolean
  /** Select 获焦时用方向键改选项；有值则不要换格。 */
  stepSelect?: -1 | 1
  /** DatePicker 获焦时用方向键加减天数；有值则不要换格。 */
  stepDate?: number
  /** 全选后按左：把光标放到这个位置，不换格。 */
  caretPos?: number
} | null {
  const direction = arrowDirection(event.key)
  if (!direction) return null
  if (shouldIgnoreNavKey(event)) return null

  const cell = closestNavCell(event.target)
  if (!cell) return null

  const shiftNav = isShiftArrowNav(event)
  // Select：普通方向键改选项（左=上，右=下）；Shift 仍换格；回车仍去下一格。
  if (
    !shiftNav &&
    direction !== 'enter' &&
    columnOf(cell.field)?.control === 'select'
  ) {
    return {
      direction,
      current: cell,
      next: null,
      selectAll: false,
      stepSelect: direction === 'up' || direction === 'left' ? -1 : 1,
    }
  }

  // DatePicker：上 -7 天、下 +7 天、左 -1 天、右 +1 天。
  if (!shiftNav && direction !== 'enter' && isDateControl(cell.field)) {
    return {
      direction,
      current: cell,
      next: null,
      selectAll: false,
      stepDate: dateStepDays[direction],
    }
  }

  // 普通上/下不再换格（非 Select / DatePicker）。
  if ((direction === 'up' || direction === 'down') && !shiftNav) return null

  const popupOpen = isPopupOpen(event.target)
  // 全选后按左：从末尾往前移，不要跳到开头。
  if (!shiftNav && !popupOpen && (direction === 'left' || direction === 'right')) {
    const caretPos = caretAfterSelectionArrow(event.target, direction)
    if (caretPos != null) {
      return {
        direction,
        current: cell,
        next: null,
        selectAll: false,
        caretPos,
      }
    }
  }
  // 普通方向键不换格：左右只在当前格走光标。换格用 Shift+方向键 / 回车。
  if (!shiftNav && direction !== 'enter') return null

  return {
    direction,
    current: cell,
    next: findNextCell(pageRows, cell.rowId, cell.field, direction),
    selectAll: shiftNav || direction === 'enter',
  }
}
