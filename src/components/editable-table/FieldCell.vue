<script setup lang="ts" generic="T extends TableRowBase">
/**
 * 可编辑表格里的单个单元格。
 * 可编辑时渲染 Input / Select / DatePicker，并注册到键盘导航；
 * 不可编辑时只展示只读文本。
 *
 * 和表格的关系：
 *   - EditableTable provide 导航 API，本组件 inject 后把自己 register 进去
 *   - 换格时表格调本格的 focus / blur；本格不自己听方向键
 *   - a-form-item 的 name 来自父级，保存时由整表 form.validate 统一校验
 *
 * 获焦约定：
 *   - 键盘换格进来：走控件原有 focus，Select/日期再开弹窗，Input 按 edge 全选或放光标
 *   - 鼠标点进来：等 click 默认放光标之后再全选，避免和浏览器抢光标位置
 *   - 失焦：先关弹窗再原生 blur，Form.Item 的 onFieldBlur 才能跑
 */
import dayjs from 'dayjs' // 日期加减、格式化；空值从今天起算
import { computed, inject, nextTick, ref, watchEffect } from 'vue' // computed：控件类型/绑定值；inject：拿导航 API；nextTick：关弹窗后再 blur；ref：DOM/控件实例；watchEffect：可编辑时注册、只读时注销
import {
  TABLE_CELL_NAV_KEY, // 与 EditableTable provide 的是同一把 key
  type CaretEdge, // 'start' | 'end' | 'all'，进入本格时光标怎么放
} from './composables/useTableCellNav'
import { displayField, isFieldEditable } from './helpers' // 只读展示文案；按行判断本列是否可编辑
import type { EditableColumn, TableRowBase } from './types' // 列配置与行必须带 id

/** Ant Design Vue 控件通过 expose 提供的聚焦方法。 */
type FocusableComp = {
  focus: () => void // 控件组件实例上的 focus，表格导航换格时调用
  blur?: () => void // 可选：部分控件没有 blur，blurCell 会退回原生 activeElement.blur
  setSelectionRange?: (start: number, end: number) => void // Input 才有；用来全选或把光标放到一端
}

const DATETIME_FORMAT = 'YYYY-MM-DD HH:mm:ss' // datetime 列存库/展示都用这一套格式
const DATE_FORMAT = 'YYYY-MM-DD' // 纯日期列不含时分秒

const props = defineProps<{
  config: EditableColumn<T> // 本列完整配置：字段名、控件类型、校验、选项、placeholder、onBlur
  record: T // 当前行对象；可编辑格直接改这条记录上的字段
  /** a-form-item 的 name，形如 ['data', 行下标, 字段名]，用于整表校验。 */
  name: readonly (string | number)[]
}>()

const nav = inject(TABLE_CELL_NAV_KEY, null) // 拿表格导航 API；单测或脱离表格使用时为 null，不注册
const wrapRef = ref<HTMLElement>() // 单元格根节点：查原生 input、判断焦点是否还在本格、scrollIntoView
const inputRef = ref<FocusableComp | null>(null) // a-input / a-input-number 的组件实例
const selectRef = ref<FocusableComp | null>(null) // a-select 实例
const pickerRef = ref<FocusableComp | null>(null) // a-date-picker 实例
/** 受控弹窗开关：获焦打开；换格时随 blurCell 关掉，不单独截断失焦。 */
const popupOpen = ref(false)

const editable = computed(() => isFieldEditable(props.config, props.record)) // 例如已有用户的用户名保存后变只读
const isSelect = computed(() => props.config.control === 'select') // 下拉：方向键改选项，获焦开面板
const isDatetime = computed(() => props.config.control === 'datetime') // 带时分秒；方向键只改日期、保留时间
const isDatePicker = computed(() => isDatetime.value || props.config.control === 'date') // date 与 datetime 共用 DatePicker
const isNumber = computed(() => props.config.control === 'number') // 数字框；空值写成 0
const pickerFormat = computed(() => (isDatetime.value ? DATETIME_FORMAT : DATE_FORMAT)) // 传给 DatePicker 的 value-format / format

const fieldValue = computed({
  get: () => {
    const value = props.record[props.config.dataIndex] // 从当前行读本列原始值
    // DatePicker 不能吃 '-' 这种占位字符串，空值要用 undefined。
    if (isDatePicker.value) {
      if (value === '' || value === '-' || value == null) return undefined // undefined 让选择器显示 placeholder，而不是非法日期
      return String(value) // 已有值转成 DatePicker 认的格式化字符串
    }
    if (isNumber.value) {
      if (value === '' || value == null) return undefined // 空数字框不显示 0，避免误当成已填
      const num = Number(value) // 行上可能是 string，先转数字
      return Number.isFinite(num) ? num : undefined // NaN / Infinity 当空，避免 InputNumber 报错
    }
    return String(value ?? '') // Input / Select：统一成字符串，null 当空串
  },
  set: (value: string | number | undefined) => {
    const key = String(props.config.dataIndex) // 字段名；下面用它写回行对象
    if (key === 'id' || key === 'isNew') return // 身份字段不允许单元格改掉，避免导航注册表和保存逻辑乱掉
    const row = props.record as Record<string, unknown> // 泛型行没有索引签名，写回时收窄成可变字典
    if (isNumber.value) {
      const num = value == null || value === '' ? 0 : Number(value) // 清空数字框时落到 0，和业务「数量默认 0」对齐
      row[key] = Number.isFinite(num) ? num : 0 // 非法输入也写成 0，不把 NaN 存进行数据
      return
    }
    row[key] = value == null ? '' : String(value) // 日期/文本/下拉：undefined 写成空串，方便提交和只读展示
  },
})

/** 找到单元格里真正能设选区的原生 input/textarea（Select 隐藏 search 框也会被 querySelector 找到，调用方需自己判断场景）。 */
function nativeInputEl() {
  const found = wrapRef.value?.querySelector('input, textarea') // antd 控件内部才是真正的原生节点
  if (found instanceof HTMLInputElement || found instanceof HTMLTextAreaElement) return found // 类型收窄后才能 select / setSelectionRange
  return null // 尚未挂载或控件结构异常
}

/** Select 失焦后关掉下拉；焦点若落到下拉面板上则先不关，避免点选项时被提前收起。 */
function closePopupOnBlur() {
  nextTick(() => {
    const active = document.activeElement // blur 后焦点可能已经跑到下拉面板或下一个格子
    if (active instanceof HTMLElement) {
      if (wrapRef.value?.contains(active)) return // 焦点还在本格内部（例如点了清空按钮），保持弹窗
      if (active.closest('.ant-select-dropdown, .ant-picker-dropdown')) return // 点在门户挂载的下拉/日期面板上，不能关
    }
    popupOpen.value = false // 焦点彻底离开本格和面板，收起弹窗
  })
}

/**
 * 控件原有 blur 已经触发后再跑这里：不 stop、不 preventDefault。
 * 列配置的 onBlur 只是额外业务，不能代替 Form.Item 失焦校验。
 */
function onNativeBlur() {
  closePopupOnBlur() // 先按焦点落点决定要不要关弹窗
  props.config.onBlur?.(props.record) // 列上可选的业务回调（例如失焦后请求联想），没有则跳过
}

/** Select 方向键改值：到头/到尾不再循环。当前值不在选项里时，下一项从第一个、上一项从最后一个。 */
function stepOption(delta: -1 | 1) {
  const options = props.config.options // 下拉选项列表，来自列配置
  if (!options?.length) return // 没有选项就无法步进
  const current = String(fieldValue.value ?? '') // 当前选中值；空则当成找不到
  const index = options.findIndex((item) => item.value === current) // 当前值在列表中的位置；-1 表示不在选项里
  const nextIndex = index < 0 ? (delta === 1 ? 0 : options.length - 1) : index + delta // 无当前值：下从 0、上从末尾；有则按 delta 挪一格
  if (nextIndex < 0 || nextIndex >= options.length) return // 已经是第一项/最后一项，不循环
  fieldValue.value = options[nextIndex].value // 写回行数据，Select 跟着 v-model 更新
}

/** DatePicker 方向键改日期：空值从今天起算；datetime 只改日期、保留时分秒。 */
function stepDate(days: number) {
  if (!isDatePicker.value) return // 非日期格即使被误调也不改值
  const format = pickerFormat.value // 与控件 value-format 一致，加减完再 format 回去
  const current = fieldValue.value // 当前格式化字符串或 undefined
  const parsed = current ? dayjs(current, format) : dayjs() // 有值按格式解析；空值从今天起算
  const base = parsed.isValid() ? parsed : dayjs() // 解析失败（脏数据）同样退回今天
  fieldValue.value = base.add(days, 'day').format(format) // add 天会保留时分秒，所以 datetime 只动日期
}

/** 当前正在渲染的那种控件实例，blur 时优先调它。 */
function currentControl() {
  if (isSelect.value) return selectRef.value // 下拉
  if (isDatePicker.value) return pickerRef.value // 日期
  return inputRef.value // 文本或数字
}

/**
 * 先把弹窗关掉并等 DOM 更新，再 blur 当前控件。
 * 这样 Select 不会把「仍获焦时关面板」当成失焦，Form.Item 能收到真正的 blur。
 */
async function blurCell() {
  popupOpen.value = false // 受控关掉下拉/日期面板
  await nextTick() // 等 open=false 反映到 DOM，避免关面板和失焦抢在同一拍
  const active = document.activeElement // 此时焦点通常还在本格内部的 input 上
  if (active instanceof HTMLElement && wrapRef.value?.contains(active)) {
    active.blur() // 原生失焦，Form.Item 的 onFieldBlur 才能跑
  } else {
    currentControl()?.blur?.() // 焦点已经不在本格（极少见），退回调组件 blur
  }
}

/**
 * 键盘导航正在调用控件 focus。
 * 只用来区分「导航换格」和「鼠标/Tab 获焦」，不拦截 focus / blur 事件本身。
 */
let navFocusing = false

/** 被键盘导航聚焦时：走控件原有 focus（Form.Item 能收到获焦）；Select/时间框再张开弹窗。 */
function focusCell(edge: CaretEdge) {
  navFocusing = true // 标记这次 focus 来自换格，onNativeFocus 里就不要再全选一次（下面自己 placeCaret）
  if (isSelect.value) {
    selectRef.value?.focus() // 先让 Select 获焦
    popupOpen.value = true // 再打开下拉，方便立刻看选项
  } else if (isDatePicker.value) {
    pickerRef.value?.focus() // 日期框获焦
    popupOpen.value = true // 打开日历面板
    if (edge === 'all') placeCaret(edge) // 回车/Shift 进入时，输入框里的日期文字也全选，方便直接覆盖
  } else {
    inputRef.value?.focus() // 文本/数字框获焦
    placeCaret(edge) // 按进入方向全选或把光标放到开头/末尾
  }
  nextTick(() => {
    navFocusing = false // 本轮 focus 事件处理完后清标记，之后的鼠标/Tab 获焦恢复正常
  })
}

/** 回车 / Shift+方向键进入时全选；左右进入时把光标放到对应一端。 */
function placeCaret(edge: CaretEdge) {
  nextTick(() => {
    const native = nativeInputEl() // 等控件把内部 input 渲染出来再设选区
    const len = native?.value.length ?? 0 // 全选终点 / 放末尾时用的长度；没有节点则当 0
    try {
      if (edge === 'all') {
        native?.select() // 浏览器原生全选
        native?.setSelectionRange?.(0, len) // 部分环境 select() 无效，再用选区兜底
        inputRef.value?.setSelectionRange?.(0, len) // antd Input 组件自己的方法，双保险
        return
      }
      const pos = edge === 'start' ? 0 : len // 从左边进来放开头，其余放末尾
      native?.setSelectionRange?.(pos, pos) // start===end 表示折叠光标、不选中
      inputRef.value?.setSelectionRange?.(pos, pos) // 同样走组件 API 兜底
    } catch {
      /* some browsers reject setSelectionRange on type=number */ // number 输入框在部分浏览器会抛错，忽略即可
    }
  })
}

/** 鼠标点进未获焦输入框时为 true；只做标记，不 preventDefault。 */
let pointerFocusing = false

function onPointerDown() {
  pointerFocusing = true // 标记接下来的 focus 来自鼠标，而不是 Tab/键盘导航
  window.addEventListener(
    'mouseup',
    () => {
      window.setTimeout(() => {
        pointerFocusing = false // 放到 mouseup 之后清掉，确保 click 里还能读到这次是指针获焦
      }, 0)
    },
    { once: true }, // 只听这一次按下对应的抬起，避免泄漏监听
  )
}

/**
 * 控件原有 focus 已经触发后再跑这里：只开弹窗 / 补全选，不 stop、不 preventDefault。
 * 鼠标获焦后浏览器还会在 click 里按点击位置放光标，所以全选放到 click 默认行为之后。
 */
function onNativeFocus() {
  if (isSelect.value || isDatePicker.value) popupOpen.value = true // 鼠标/Tab 点进下拉或日期时也要打开面板
  const fromPointer = pointerFocusing // 记下这次是不是鼠标点进来的
  pointerFocusing = false // 立刻清掉，避免后续无关 focus 误判
  if (navFocusing || isSelect.value) return // 导航换格已自己 placeCaret；Select 没有文本光标，不用全选

  const selectAll = () => {
    if (wrapRef.value?.contains(document.activeElement)) placeCaret('all') // 焦点还在本格才全选，避免异步时人已经点走
  }

  if (!fromPointer) {
    selectAll() // Tab 进来：立刻全选，方便直接覆盖
    return
  }

  const input = nativeInputEl() // 鼠标点进来：要等 click 把光标放到点击处之后再全选
  if (!input) return // 控件内部还没有 input（极少见）
  const onClick = () => {
    input.removeEventListener('click', onClick) // 只处理紧跟着这次 focus 的那一次 click
    window.setTimeout(selectAll, 0) // 排到 click 默认行为之后，全选才会盖住浏览器按点击位置放下的光标
  }
  input.addEventListener('click', onClick)
}

// 可编辑时注册，变为只读（例如保存后用户名）或卸载时注销。
watchEffect((onCleanup) => {
  if (!nav || !editable.value) return // 没有导航上下文，或本格已只读：不注册
  const rowId = String(props.record.id) // 注册表按行 id 查找；统一转字符串
  const field = String(props.config.dataIndex) // 注册表按字段名查找
  nav.registerCell(rowId, field, {
    focus: focusCell, // 表格 resolve 出下一格后调用
    blur: blurCell, // 离开本格前调用，保证失焦校验
    el: () => wrapRef.value, // 供 scrollIntoView
    stepOption, // Select 普通方向键改选项
    stepDate, // DatePicker 普通方向键加减天数
  })
  onCleanup(() => nav.unregisterCell(rowId, field)) // 依赖变化或卸载时删掉旧句柄，避免指向已销毁的 DOM
})
</script>

<template>
  <!--
    可编辑格根节点：
    - data-nav-row / data-nav-field：keydown 时 closest 定位当前格
    - data-nav-popup-open：弹窗已开时告诉导航「左右不要当 Input 光标」
    - mousedown.capture：比 focus 更早记下「这是鼠标点进来的」
  -->
  <div
    v-if="editable"
    ref="wrapRef"
    class="table-field-nav"
    :data-nav-row="record.id"
    :data-nav-field="config.dataIndex"
    :data-nav-popup-open="popupOpen ? 'true' : undefined"
    @mousedown.capture="onPointerDown"
  >
    <!-- name 对齐整表 formModel；rules 来自列配置，失焦和保存时都会跑 -->
    <a-form-item class="table-form-item" :name="name" :rules="config.rules">
      <!-- 下拉：open 受控，和 popupOpen / blurCell 同步；options 来自列配置 -->
      <a-select
        v-if="isSelect"
        ref="selectRef"
        v-model:value="fieldValue"
        v-model:open="popupOpen"
        :options="config.options"
        :placeholder="config.placeholder"
        @focus="onNativeFocus"
        @blur="onNativeBlur"
      />
      <!--
        日期：value 是格式化字符串（value-format），不是 dayjs 对象。
        show-time 仅 datetime；format 控制输入框展示，与存库格式一致。
      -->
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
        @focus="onNativeFocus"
        @blur="onNativeBlur"
      />
      <!-- 数字：关掉步进箭头；min/precision=0 表示非负整数 -->
      <a-input-number
        v-else-if="isNumber"
        ref="inputRef"
        v-model:value="fieldValue"
        :controls="false"
        :min="0"
        :precision="0"
        :placeholder="config.placeholder"
        class="table-number-input"
        @focus="onNativeFocus"
        @blur="onNativeBlur"
      />
      <!-- 默认文本输入；v-else 接住 control 未配或为 input 的列 -->
      <a-input
        v-else
        ref="inputRef"
        v-model:value="fieldValue"
        :placeholder="config.placeholder"
        @focus="onNativeFocus"
        @blur="onNativeBlur"
      />
    </a-form-item>
  </div>
  <!-- 只读：不注册导航、不包 form-item；displayField 把空值显示成 '-' 等 -->
  <span v-else class="readonly-cell">{{ displayField(config, record) }}</span>
</template>

<style scoped>
.table-field-nav {
  min-width: 0; /* 允许单元格在表格布局里被压缩，避免把整列撑破 */
}

.table-form-item {
  margin: 0; /* 去掉 Form.Item 默认下边距，否则行高会被校验提示以外的空白撑高 */
}

.table-date-picker,
.table-number-input {
  width: 100%; /* 日期/数字控件默认不定宽，铺满单元格才能和文本框对齐 */
}

/* 隐藏原生 number 输入的上下箭头，只保留可输入的数字框。 */
.table-number-input :deep(input[type='number']::-webkit-inner-spin-button),
.table-number-input :deep(input[type='number']::-webkit-outer-spin-button) {
  margin: 0;
  appearance: none;
}

.table-number-input :deep(input[type='number']) {
  appearance: textfield; /* Firefox：同样去掉数字框步进外观 */
}

.readonly-cell {
  color: #8c8c8c; /* 只读文字用次要色，和可编辑输入框区分 */
}
</style>
