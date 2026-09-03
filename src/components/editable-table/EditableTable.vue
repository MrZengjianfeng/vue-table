<script setup lang="ts" generic="T extends TableRowBase">
/**
 * 通用可编辑表格（内联编辑 + 方向键换格）
 *
 * 外部只需传入：
 *   - data：行数据（v-model:data）
 *   - columns：列配置 / 表头（标题、字段、是否可编辑、控件类型、校验等）
 *
 * 结构：
 *   a-form（整表校验、捕获键盘）
 *     └── a-table（只负责画列和行）
 *           └── #bodyCell
 *                 ├── 操作列：删除
 *                 └── 其它列：FieldCell（Input / Select / DatePicker 或只读文本）
 *
 * 为什么 form 包 table：
 *   Ant Design Vue 的校验依赖 a-form-item 的 name 路径。
 *   每个可编辑格的 name 是 ['data', 行下标, 字段名]，
 *   对应 formModel = { data: 当前行数组 }，保存时一次校验全部可编辑格。
 *
 * 键盘换格（由本文件发起，细节在 useTableCellNav）：
 *   1. form 上 @keydown.capture 抢在 Select 之前接到方向键 / 回车
 *   2. resolveNavTarget 判断要不要换格、下一格是谁
 *   3. 先 blur 当前格（保留 Form.Item 失焦校验），nextTick 后再 focus 下一格
 *      不能只关弹窗或直接 focus 下一格：会截断原有 blur / focus
 *
 * 换格规则摘要：
 *   回车        → 下一个可编辑格；行末到下一行第一个可编辑格；表末不动；进入后全选
 *   Shift+方向  → 立刻换格（上/下同列、左/右同行），进入后全选
 *   普通方向键  → 不换格（Select 改选项，DatePicker 改日期，Input 只走光标）
 *   边界        → 第一行 Shift+上、最后一行 Shift+下、首列 Shift+左、末列 Shift+右、最后一行末列回车：焦点不动
 *
 * 子格通过 provide/inject 把自己注册进 cellNav（rowId + 字段名 → 聚焦方法）。
 */
import type { FormInstance, TableColumnsType } from 'ant-design-vue'
import { computed, nextTick, provide, ref } from 'vue'
import FieldCell from './FieldCell.vue'
import {
  TABLE_CELL_NAV_KEY,
  caretEdgeForArrival,
  resolveNavTarget,
  setTextCaret,
  useTableCellNav,
} from './composables/useTableCellNav'
import type { EditableColumn, TableRowBase } from './types'

/**
 * 行数据双向绑定。父页面持有 data，
 * 单元格里改值会直接改这条记录，保存时再整表校验。
 */
const data = defineModel<T[]>('data', { required: true })

const props = defineProps<{
  /** 列配置即表头：标题、字段、编辑控件、校验规则。 */
  columns: EditableColumn<T>[]
  /** 保存 / 删除请求进行中，表格显示 loading。 */
  loading?: boolean
}>()

const emit = defineEmits<{
  /** 操作列确认删除后，把当前行交给父页面从列表里摘掉。 */
  delete: [record: T]
}>()

const formRef = ref<FormInstance>()

/**
 * 整表校验用的 model。
 * FieldCell 里 a-form-item 的 name 是 ['data', index, 'phone'] 这种路径，
 * 必须能在这个对象上取到 formModel.data[index].phone。
 */
const formModel = computed(() => ({ data: data.value }))

const tableColumns = computed<TableColumnsType>(() => [
  ...props.columns.map((item) => ({
    title: item.title,
    dataIndex: item.dataIndex,
    width: item.width,
  })),
  { title: '操作', key: 'action', width: 90, fixed: 'right' as const },
])

const scrollX = computed(() =>
  props.columns.reduce((sum, col) => sum + (col.width ?? 120), 0) + 90,
)

/**
 * 单元格注册表：FieldCell 挂载时 register，卸载或变为只读时 unregister。
 * provide 下去，子组件 inject TABLE_CELL_NAV_KEY 即可调用 focus / blur。
 */
const cellNav = useTableCellNav()
provide(TABLE_CELL_NAV_KEY, cellNav)

/**
 * 表格键盘入口。必须用 capture：
 *   Select 获焦并张开下拉后，自己也会听 ArrowUp/ArrowDown 用来改选项。
 *   若只在冒泡阶段听，事件已经被 Select 吃掉，表格就换不了格。
 *
 * 处理顺序：
 *   1. resolveNavTarget
 *      - 不是方向键/回车、输入法合成中、Ctrl/Alt/Meta → 返回 null，放行默认行为
 *      - 全选后按左 → 光标从末尾往前一格，不跳到开头
 *      - Select 获焦且普通方向键 → 改当前选项（上/左上一项，下/右下一项）
 *      - DatePicker 获焦且普通方向键 → 改日期（上 -7 天、下 +7 天、左 -1 天、右 +1 天）
 *      - 普通方向键 → 返回 null，不换格（Input 只走光标）
 *      - Shift+方向键 / 回车 → 换格；进入后全选
 *   2. 只要认定这是一次「换格意图」，就 preventDefault + stopPropagation
 *      即便 next 为 null（已经到表边缘）也要拦，否则 Shift+上下仍可能改掉 Select 当前值
 *   3. 有 next：先 blur 当前控件，等 Vue 处理完失焦（校验、关弹窗），
 *      再 focus 目标格。keydown 的 stopPropagation 只拦住 Select 改选项，
 *      不代替、也不跳过表单项自己的 blur / focus。
 *      caretEdgeForArrival：从左边进 → 光标放开头；回车 / Shift+方向进 → 全选；从右边进 → 放末尾
 */
async function onNavKeydown(event: KeyboardEvent) {
  const target = resolveNavTarget(event, data.value, props.columns)
  if (!target) return
  event.preventDefault()
  event.stopPropagation()
  if (target.stepSelect) {
    cellNav.stepSelect(target.current.rowId, target.current.field, target.stepSelect)
    return
  }
  if (target.stepDate != null) {
    cellNav.stepDate(target.current.rowId, target.current.field, target.stepDate)
    return
  }
  if (target.caretPos != null) {
    setTextCaret(event.target, target.caretPos)
    return
  }
  if (!target.next) return
  await cellNav.blurCell(target.current.rowId, target.current.field)
  await nextTick()
  cellNav.focusCell(
    target.next.rowId,
    target.next.field,
    caretEdgeForArrival(target.direction, target.selectAll),
  )
}

/**
 * 当前行在 data 数组里的下标。
 * form name 必须用这个下标，不能用分页后的可视下标（本表虽已不分页，仍按全量数组对齐 model）。
 */
function rowIndex(record: T) {
  return data.value.findIndex((item) => String(item.id) === String(record.id))
}

/**
 * a-form-item 的 name 路径，例如 ['data', 2, 'phone']。
 * 保存时 form.validate() 按这条路径读值和报错。
 */
function fieldName(record: T, field: keyof T & string) {
  return ['data', rowIndex(record), field] as const
}

/**
 * 用列的 dataIndex 找回 columns 里的完整配置
 * （控件类型、是否可编辑、校验规则、下拉选项等）。
 * bodyCell 槽只给了 antd 的 column 对象，没有这些编辑信息。
 */
function columnConfig(dataIndex: unknown) {
  return props.columns.find((item) => item.dataIndex === dataIndex)
}

/** 父页面保存前调用，校验所有 a-form-item。 */
defineExpose({
  validate: () => formRef.value?.validate(),
})
</script>

<template>
  <!--
    colon=false：表单项不要标签后的冒号（单元格里本来也没 label）。
    keydown.capture：见 onNavKeydown 注释。
  -->
  <a-form
    ref="formRef"
    :model="formModel"
    :colon="false"
    @keydown.capture="onNavKeydown"
  >
    <!--
      pagination=false：一次渲染全部行，键盘上下的「第一行/最后一行」就是这张表的首尾。
      scroll.x：按列宽求和；换格后由 cellNav.focusCell 把目标格滚进可视区。
      row-key=id：行身份稳定，避免重绘后焦点注册表对不上。
    -->
    <a-table
      :columns="tableColumns"
      :data-source="data"
      :loading="loading"
      :pagination="false"
      row-key="id"
      :scroll="{ x: scrollX }"
    >
      <template #bodyCell="{ column, record }">
        <!-- 操作列不走表单，单独渲染删除。 -->
        <template v-if="column.key === 'action'">
          <a-popconfirm
            title="确认删除该行？"
            @confirm="emit('delete', record as T)"
          >
            <a class="danger">删除</a>
          </a-popconfirm>
        </template>
        <!--
          其余列交给 FieldCell：
          - config：可编辑性、控件、校验
          - record：当前行，单元格直接改这条对象上的字段
          - name：form 校验路径
          只读列在 FieldCell 内部会改成灰色文本，不会注册到键盘导航。
        -->
        <FieldCell
          v-else-if="columnConfig(column.dataIndex)"
          :config="columnConfig(column.dataIndex)!"
          :record="(record as T)"
          :name="fieldName(record as T, columnConfig(column.dataIndex)!.dataIndex)"
        />
      </template>
    </a-table>
  </a-form>
</template>

<style scoped>
.danger {
  color: #ff4d4f;
}
</style>
