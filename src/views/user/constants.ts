/**
 * 用户管理表格的列配置、校验规则和下拉选项。
 * 作为「表头」传给通用 EditableTable；是否可编辑、用哪种控件都以这里为准。
 */
import type { EditableColumn } from '@/components/editable-table'
import type { SysUser, UserForm } from '@/type'

/** 新增用户时的可编辑字段默认值（系统字段如 ID、工号由页面另行生成）。 */
export const emptyUserForm = (): UserForm => ({
  username: '',
  name: '',
  gender: 'male',
  email: '',
  phone: '',
  telephone: '',
  department: '研发',
  role: 'viewer',
  status: 'active',
  remark: '',
  registeredAt: '',
  lastLoginAt: '',
  loginCount: 0,
})

export const roleOptions = [
  { label: '管理员', value: 'admin' },
  { label: '运营', value: 'editor' },
  { label: '访客', value: 'viewer' },
]

export const statusOptions = [
  { label: '启用', value: 'active' },
  { label: '禁用', value: 'disabled' },
]

export const genderOptions = [
  { label: '男', value: 'male' },
  { label: '女', value: 'female' },
]

export const departmentOptions = [
  { label: '研发', value: '研发' },
  { label: '产品', value: '产品' },
  { label: '运营', value: '运营' },
  { label: '设计', value: '设计' },
  { label: '人事', value: '人事' },
]

export const userFormRules = {
  username: [{ required: true, message: '请输入用户名' }],
  name: [{ required: true, message: '请输入姓名' }],
  gender: [{ required: true, message: '请选择性别' }],
  email: [{ required: true, type: 'email' as const, message: '请输入正确邮箱' }],
  phone: [{ required: true, message: '请输入手机号' }],
  department: [{ required: true, message: '请选择部门' }],
  role: [{ required: true, message: '请选择角色' }],
  status: [{ required: true, message: '请选择状态' }],
}

/** 表格列顺序与编辑策略；键盘左右移动也按这个顺序找下一个表单。 */
export const userColumnConfigs: EditableColumn<SysUser>[] = [
  { title: 'ID', dataIndex: 'id', width: 80, editable: false },
  { title: '工号', dataIndex: 'employeeNo', width: 110, editable: false },
  {
    title: '用户名',
    dataIndex: 'username',
    width: 150,
    editable: 'new-only',
    control: 'input',
    placeholder: '用户名',
    rules: userFormRules.username,
  },
  {
    title: '姓名',
    dataIndex: 'name',
    width: 130,
    editable: true,
    control: 'input',
    placeholder: '姓名',
    rules: userFormRules.name,
  },
  {
    title: '性别',
    dataIndex: 'gender',
    width: 110,
    editable: true,
    control: 'select',
    options: genderOptions,
    rules: userFormRules.gender,
  },
  {
    title: '邮箱',
    dataIndex: 'email',
    width: 210,
    editable: true,
    control: 'input',
    placeholder: '邮箱',
    rules: userFormRules.email,
  },
  {
    title: '手机号',
    dataIndex: 'phone',
    width: 150,
    editable: true,
    control: 'input',
    placeholder: '手机号',
    rules: userFormRules.phone,
  },
  {
    title: '电话',
    dataIndex: 'telephone',
    width: 150,
    editable: true,
    control: 'input',
    placeholder: '电话',
  },
  {
    title: '部门',
    dataIndex: 'department',
    width: 130,
    editable: true,
    control: 'select',
    options: departmentOptions,
    rules: userFormRules.department,
  },
  {
    title: '角色',
    dataIndex: 'role',
    width: 130,
    editable: true,
    control: 'select',
    options: roleOptions,
    rules: userFormRules.role,
  },
  {
    title: '状态',
    dataIndex: 'status',
    width: 120,
    editable: true,
    control: 'select',
    options: statusOptions,
    rules: userFormRules.status,
  },
  {
    title: '备注',
    dataIndex: 'remark',
    width: 180,
    editable: true,
    control: 'input',
    placeholder: '备注',
  },
  {
    title: '注册日期',
    dataIndex: 'registeredAt',
    width: 160,
    editable: true,
    control: 'date',
    placeholder: '注册日期',
  },
  {
    title: '最后登录',
    dataIndex: 'lastLoginAt',
    width: 220,
    editable: true,
    control: 'datetime',
    placeholder: '最后登录',
  },
  {
    title: '登录次数',
    dataIndex: 'loginCount',
    width: 120,
    editable: true,
    control: 'number',
    placeholder: '登录次数',
  },
  { title: '创建时间', dataIndex: 'createdAt', width: 180, editable: false },
]

/** 页面提示用：始终不可编辑的列标题。 */
export const readonlyFieldLabels = userColumnConfigs
  .filter((item) => item.editable === false)
  .map((item) => item.title)

/** 把数字补成两位，如 1 → "01"，用于生成 username。 */
export function padNo(n: number) {
  return String(n).padStart(2, '0')
}

/** 格式化为 YYYY-MM-DD，与日期 DatePicker 的 value-format 一致。 */
export function formatDate(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 格式化为 YYYY-MM-DD HH:mm:ss，与 DatePicker 的 value-format 一致。 */
export function formatDateTime(date = new Date()) {
  return `${formatDate(date)} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
}
