<script setup lang="ts">
/**
 * 用户表格里的单个单元格。
 * 可编辑时渲染 Input / Select / DatePicker，并注册到键盘导航；
 * 不可编辑时只展示只读文本。
 */
import dayjs from 'dayjs'
import { computed, inject, nextTick, ref, watchEffect } from 'vue'
import type { SysUser } from '@/type'
import {
  TABLE_CELL_NAV_KEY,
  type CaretEdge,
} from '../composables/useTableCellNav'
import {
  displayUserField,
  isFieldEditable,
  type UserColumnConfig,
} from '../constants'

/** Ant Design Vue 控件通过 expose 提供的聚焦方法。 */
type FocusableComp = {
  focus: () => void
  blur?: () => void
  setSelectionRange?: (start: number, end: number) => void
}

const DATETIME_FORMAT = 'YYYY-MM-DD HH:mm:ss'
const DATE_FORMAT = 'YYYY-MM-DD'

const props = defineProps<{
  config: UserColumnConfig
  record: SysUser
  /** a-form-item 的 name，形如 ['users', 行下标, 字段名]，用于整表校验。 */
  name: readonly (string | number)[]
}>()

const nav = inject(TABLE_CELL_NAV_KEY, null)
const wrapRef = ref<HTMLElement>()
const inputRef = ref<FocusableComp | null>(null)
const selectRef = ref<FocusableComp | null>(null)
const pickerRef = ref<FocusableComp | null>(null)
/** 受控弹窗开关：获焦打开；换格时随 blurCell 关掉，不单独截断失焦。 */
const popupOpen = ref(false)

const editable = computed(() => isFieldEditable(props.config, props.record))
const isSelect = computed(() => props.config.control === 'select')
const isDatetime = computed(() => props.config.control === 'datetime')
const isDatePicker = computed(() => isDatetime.value || props.config.control === 'date')
const isNumber = computed(() => props.config.control === 'number')
const pickerFormat = computed(() => (isDatetime.value ? DATETIME_FORMAT : DATE_FORMAT))

const fieldValue = computed({
  get: () => {
    const value = props.record[props.config.dataIndex]
    // DatePicker 不能吃 '-' 这种占位字符串，空值要用 undefined。
    if (isDatePicker.value) {
      if (value === '' || value === '-' || value == null) return undefined
      return String(value)
    }
    if (isNumber.value) {
      if (value === '' || value == null) return undefined
      const num = Number(value)
      return Number.isFinite(num) ? num : undefined
    }
    return String(value ?? '')
  },
  set: (value: string | number | undefined) => {
    const key = props.config.dataIndex
    if (key === 'id' || key === 'isNew') return
    if (isNumber.value) {
      const num = value == null || value === '' ? 0 : Number(value)
      ;(props.record as unknown as Record<string, number>)[key] = Number.isFinite(num) ? num : 0
      return
    }
    ;(props.record as unknown as Record<string, string>)[key] = value == null ? '' : String(value)
  },
})

function nativeInputEl() {
  const found = wrapRef.value?.querySelector('input, textarea')
  if (found instanceof HTMLInputElement || found instanceof HTMLTextAreaElement) return found
  return null
}

function openPopup() {
  popupOpen.value = true
}

/** Select 失焦后关掉下拉；焦点若落到下拉面板上则先不关，避免点选项时被提前收起。 */
function closePopupOnBlur() {
  nextTick(() => {
    const active = document.activeElement
    if (active instanceof HTMLElement) {
      if (wrapRef.value?.contains(active)) return
      if (active.closest('.ant-select-dropdown, .ant-picker-dropdown')) return
    }
    popupOpen.value = false
  })
}

/** Select 方向键改值：到头/到尾不再循环。当前值不在选项里时，下一项从第一个、上一项从最后一个。 */
function stepOption(delta: -1 | 1) {
  const options = props.config.options
  if (!options?.length) return
  const current = String(fieldValue.value ?? '')
  const index = options.findIndex((item) => item.value === current)
  const nextIndex = index < 0 ? (delta === 1 ? 0 : options.length - 1) : index + delta
  if (nextIndex < 0 || nextIndex >= options.length) return
  fieldValue.value = options[nextIndex].value
}

/** DatePicker 方向键改日期：空值从今天起算；datetime 只改日期、保留时分秒。 */
function stepDate(days: number) {
  if (!isDatePicker.value) return
  const format = pickerFormat.value
  const current = fieldValue.value
  const parsed = current ? dayjs(current, format) : dayjs()
  const base = parsed.isValid() ? parsed : dayjs()
  fieldValue.value = base.add(days, 'day').format(format)
}

function currentControl() {
  if (isSelect.value) return selectRef.value
  if (isDatePicker.value) return pickerRef.value
  return inputRef.value
}

/**
 * 先把弹窗关掉并等 DOM 更新，再 blur 当前控件。
 * 这样 Select 不会把「仍获焦时关面板」当成失焦，Form.Item 能收到真正的 blur。
 */
async function blurCell() {
  popupOpen.value = false
  await nextTick()
  const active = document.activeElement
  if (active instanceof HTMLElement && wrapRef.value?.contains(active)) {
    active.blur()
  } else {
    currentControl()?.blur?.()
  }
}

/** 被键盘导航聚焦时：走控件 focus（Form.Item 能收到获焦）；Select/时间框再张开弹窗。 */
function focusCell(edge: CaretEdge) {
  if (isSelect.value) {
    selectRef.value?.focus()
    popupOpen.value = true
    return
  }
  if (isDatePicker.value) {
    pickerRef.value?.focus()
    popupOpen.value = true
    if (edge === 'all') placeCaret(edge)
    return
  }
  const input = inputRef.value
  input?.focus()
  placeCaret(edge)
}

/** 回车 / Shift+方向键进入时全选；左右进入时把光标放到对应一端。 */
function placeCaret(edge: CaretEdge) {
  nextTick(() => {
    const native = nativeInputEl()
    const len = native?.value.length ?? 0
    try {
      if (edge === 'all') {
        native?.select()
        native?.setSelectionRange?.(0, len)
        inputRef.value?.setSelectionRange?.(0, len)
        return
      }
      const pos = edge === 'start' ? 0 : len
      native?.setSelectionRange?.(pos, pos)
      inputRef.value?.setSelectionRange?.(pos, pos)
    } catch {
      /* some browsers reject setSelectionRange on type=number */
    }
  })
}

// 可编辑时注册，变为只读（例如保存后用户名）或卸载时注销。
watchEffect((onCleanup) => {
  if (!nav || !editable.value) return
  const rowId = props.record.id
  const field = String(props.config.dataIndex)
  nav.registerCell(rowId, field, {
    focus: focusCell,
    blur: blurCell,
    el: () => wrapRef.value,
    stepOption,
    stepDate,
  })
  onCleanup(() => nav.unregisterCell(rowId, field))
})
</script>

<template>
  <!-- data-nav-* 供 keydown 时定位当前格；data-nav-popup-open 标记弹窗已开 -->
  <div
    v-if="editable"
    ref="wrapRef"
    class="table-field-nav"
    :data-nav-row="record.id"
    :data-nav-field="config.dataIndex"
    :data-nav-popup-open="popupOpen ? 'true' : undefined"
  >
    <a-form-item class="table-form-item" :name="name" :rules="config.rules">
      <a-select
        v-if="isSelect"
        ref="selectRef"
        v-model:value="fieldValue"
        v-model:open="popupOpen"
        :options="config.options"
        :placeholder="config.placeholder"
        @focus="openPopup"
        @blur="closePopupOnBlur"
      />
      <a-date-picker
        v-else-if="isDatePicker"
        ref="pickerRef"
        v-model:value="fieldValue"
        v-model:open="popupOpen"
        :show-time="isDatetime"
        :value-format="pickerFormat"
        :format="pickerFormat"
        :placeholder="config.placeholder"
        class="table-date-picker"
        @focus="openPopup"
      />
      <a-input-number
        v-else-if="isNumber"
        ref="inputRef"
        v-model:value="fieldValue"
        :controls="false"
        :min="0"
        :precision="0"
        :placeholder="config.placeholder"
        class="table-number-input"
      />
      <a-input
        v-else
        ref="inputRef"
        v-model:value="fieldValue"
        :placeholder="config.placeholder"
      />
    </a-form-item>
  </div>
  <span v-else class="readonly-cell">{{ displayUserField(config.dataIndex, record) }}</span>
</template>

<style scoped>
.table-field-nav {
  min-width: 0;
}

.table-form-item {
  margin: 0;
}

.table-date-picker,
.table-number-input {
  width: 100%;
}

/* 隐藏原生 number 输入的上下箭头，只保留可输入的数字框。 */
.table-number-input :deep(input[type='number']::-webkit-inner-spin-button),
.table-number-input :deep(input[type='number']::-webkit-outer-spin-button) {
  margin: 0;
  appearance: none;
}

.table-number-input :deep(input[type='number']) {
  appearance: textfield;
}

.readonly-cell {
  color: #8c8c8c;
}
</style>
