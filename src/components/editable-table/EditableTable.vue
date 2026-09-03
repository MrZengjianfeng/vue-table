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
import type { FormInstance, TableColumnsType } from "ant-design-vue"; // FormInstance：校验用；TableColumnsType：antd 表头类型
import { computed, nextTick, provide, ref } from "vue"; // computed：派生 formModel/列；nextTick：blur 后再 focus；provide：把导航 API 给子格；ref：表单实例
import FieldCell from "./FieldCell.vue"; // 单个单元格：只读文本或 Input/Select/DatePicker
import {
  TABLE_CELL_NAV_KEY, // provide/inject 的 key，子格用它拿到导航 API
  caretEdgeForArrival, // 进入目标格时光标放开头 / 末尾 / 全选
  resolveNavTarget, // 根据一次 keydown 算出要不要换格、下一格是谁
  setTextCaret, // 全选后按左：把光标挪到指定位置
  useTableCellNav, // 维护「行+字段 → 单元格句柄」注册表
} from "./composables/useTableCellNav";
import type { EditableColumn, TableRowBase } from "./types"; // 列配置与行必须带 id 的基础类型

/**
 * 行数据双向绑定。父页面持有 data，
 * 单元格里改值会直接改这条记录，保存时再整表校验。
 */
const data = defineModel<T[]>("data", { required: true }); // v-model:data；required 表示父组件必须传入

const props = defineProps<{
  /** 列配置即表头：标题、字段、编辑控件、校验规则。 */
  columns: EditableColumn<T>[];
  /** 保存 / 删除请求进行中，表格显示 loading。 */
  loading?: boolean;
}>();

const emit = defineEmits<{
  /** 操作列确认删除后，把当前行交给父页面从列表里摘掉。 */
  delete: [record: T];
}>();

const formRef = ref<FormInstance>(); // 挂到 a-form，expose.validate 时调用 antd 的校验

/**
 * 整表校验用的 model。
 * FieldCell 里 a-form-item 的 name 是 ['data', index, 'phone'] 这种路径，
 * 必须能在这个对象上取到 formModel.data[index].phone。
 */
const formModel = computed(() => ({ data: data.value })); // 包一层 { data }，与 name 路径第一段对齐；computed 保证数组引用更新后 form 仍能读到最新行

const tableColumns = computed<TableColumnsType>(() => [
  ...props.columns.map((item) => ({
    title: item.title, // 表头文案
    dataIndex: item.dataIndex, // 对应行对象上的字段名，bodyCell 用它找回完整列配置
    width: item.width, // 列宽；滚动条和换格后的 scrollIntoView 都依赖它
  })),
  { title: "操作", key: "action", width: 90, fixed: "right" as const }, // 固定右侧操作列；key=action 用来在 bodyCell 里识别，不走 FieldCell
]);

const scrollX = computed(
  () => props.columns.reduce((sum, col) => sum + (col.width ?? 120), 0) + 90, // 各列宽求和（缺省按 120）再加上操作列 90，作为横向滚动最小宽度
);

/**
 * 单元格注册表：FieldCell 挂载时 register，卸载或变为只读时 unregister。
 * provide 下去，子组件 inject TABLE_CELL_NAV_KEY 即可调用 focus / blur。
 */
const cellNav = useTableCellNav(); // 本表一份 Map，生命周期跟表格走
provide(TABLE_CELL_NAV_KEY, cellNav); // 所有 FieldCell 共享同一份注册表，才能跨格 focus

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
  const target = resolveNavTarget(event, data.value, props.columns); // 用当前页全部行和列配置算出导航结果
  if (!target) return; // null = 放行浏览器默认（输入法、普通左右走光标、非导航键）
  event.preventDefault(); // 挡住浏览器/antd 默认（Select 改选项、Input 全选后左键跳开头、回车提交）
  event.stopPropagation(); // 捕获阶段拦住，不让事件再落到 Select/DatePicker 自己的 keydown
  if (target.stepSelect) {
    cellNav.stepSelect(
      target.current.rowId, // 当前行
      target.current.field, // 当前 Select 字段
      target.stepSelect, // -1 上一项 / +1 下一项
    );
    return; // 只改选项，不换格
  }
  if (target.stepDate != null) {
    cellNav.stepDate(
      target.current.rowId, // 当前行
      target.current.field, // 当前日期字段
      target.stepDate, // 相对今天或当前值加减的天数
    );
    return; // 只改日期，不换格
  }
  if (target.caretPos != null) {
    setTextCaret(event.target, target.caretPos); // 全选后按左：光标放到返回的下标，不换格
    return;
  }
  if (!target.next) return; // 已到表边界：焦点留在当前格，前面已经 preventDefault，Select 也不会被方向键改值
  await cellNav.blurCell(target.current.rowId, target.current.field); // 先关弹窗并原生 blur，触发 Form.Item 失焦校验
  await nextTick(); // 等 Vue 把失焦副作用（校验红字、关下拉）刷完，再聚焦下一格，避免焦点抢跑
  cellNav.focusCell(
    target.next.rowId, // 目标行
    target.next.field, // 目标字段
    caretEdgeForArrival(target.direction, target.selectAll), // 按进入方向决定全选还是光标靠边
  );
}

/**
 * 当前行在 data 数组里的下标。
 * form name 必须用这个下标，不能用分页后的可视下标（本表虽已不分页，仍按全量数组对齐 model）。
 */
function rowIndex(record: T) {
  return data.value.findIndex((item) => String(item.id) === String(record.id)); // id 可能是 number/string，统一转字符串再比
}

/**
 * a-form-item 的 name 路径，例如 ['data', 2, 'phone']。
 * 保存时 form.validate() 按这条路径读值和报错。
 */
function fieldName(record: T, field: keyof T & string) {
  return ["data", rowIndex(record), field] as const; // as const 让元组字面量类型稳定，antd Form 认这条路径
}

/**
 * 用列的 dataIndex 找回 columns 里的完整配置
 * （控件类型、是否可编辑、校验规则、下拉选项等）。
 * bodyCell 槽只给了 antd 的 column 对象，没有这些编辑信息。
 */
function columnConfig(dataIndex: unknown) {
  return props.columns.find((item) => item.dataIndex === dataIndex); // 操作列没有 dataIndex，这里会得到 undefined
}

/** 父页面保存前调用，校验所有 a-form-item。 */
defineExpose({
  validate: () => formRef.value?.validate(), // 转调 antd Form；表单尚未挂载时返回 undefined
});
</script>

<template>
  <!--
    a-form 包住整张表：
    - ref=formRef：父页面 save 时通过 expose.validate 调这里
    - model=formModel：{ data: 行数组 }，和每个格子 name=['data', 下标, 字段] 对齐
    - colon=false：单元格没有 label，不要再画冒号
    - keydown.capture：捕获阶段先于 Select 接到方向键/回车，见 onNavKeydown
  -->
  <a-form
    ref="formRef"
    :model="formModel"
    :colon="false"
    @keydown.capture="onNavKeydown"
  >
    <!--
      a-table 只负责画格子，不负责校验和键盘：
      - columns：业务列 + 右侧操作列
      - data-source：与 v-model:data 同一份数组，单元格改值即改行对象
      - loading：保存/删除请求中显示遮罩
      - pagination=false：一次渲染全部行，键盘「第一行/最后一行」就是这张表的首尾
      - row-key=id：行身份稳定，避免重绘后 cellNav 注册表对不上
      - scroll.x：列宽求和；换格后由 cellNav.focusCell 把目标格滚进可视区
    -->
    <a-table
      :columns="tableColumns"
      :data-source="data"
      :loading="loading"
      :pagination="false"
      row-key="id"
      :scroll="{ x: scrollX }"
    >
      <!-- column：当前列（antd 精简后的表头）；record：当前行数据 -->
      <template #bodyCell="{ column, record }">
        <!-- key=action 是脚本里手动拼的操作列，不走表单校验，只渲染删除 -->
        <template v-if="column.key === 'action'">
          <a-popconfirm
            title="确认删除该行？"
            @confirm="emit('delete', record as T)"
          >
            <!-- 点「删除」先弹确认；确认后把整行交给父页面从 data 里摘掉 -->
            <a class="danger">删除</a>
          </a-popconfirm>
        </template>
        <!--
          其余列交给 FieldCell（v-else-if 保证操作列不会误渲染）：
          - v-else-if columnConfig(...)：操作列没有 dataIndex，找不到配置则不渲染
          - config：完整列配置（控件、可编辑、校验、选项）；! 断言是因为上面已经判过存在
          - record：当前行，单元格直接改这条对象上的字段
          - name：['data', 行下标, 字段名]，供 a-form-item 校验
          只读列在 FieldCell 内部会改成灰色文本，不会注册到键盘导航。
        -->
        <FieldCell
          v-else-if="columnConfig(column.dataIndex)"
          :config="columnConfig(column.dataIndex)!"
          :record="record as T"
          :name="
            fieldName(record as T, columnConfig(column.dataIndex)!.dataIndex)
          "
        />
      </template>
    </a-table>
  </a-form>
</template>

<style scoped>
.danger {
  color: #ff4d4f; /* 删除链接用 antd 危险色，和确认框语义一致 */
}
</style>
