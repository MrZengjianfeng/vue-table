/**
 * 用户领域类型。
 * SysUser 是表格行完整数据；UserForm 是新增时可填的字段子集。
 */

/** 角色：管理员 / 运营 / 访客，对应表格「角色」下拉。 */
export type UserRole = 'admin' | 'editor' | 'viewer'
export type UserStatus = 'active' | 'disabled'
export type UserGender = 'male' | 'female'

export interface SysUser {
  id: number
  employeeNo: string
  username: string
  name: string
  gender: UserGender
  email: string
  phone: string
  department: string
  role: UserRole
  status: UserStatus
  remark: string
  /** 注册日期，表格中用 DatePicker，格式 YYYY-MM-DD */
  registeredAt: string
  /** 最后登录时间，表格中用 DatePicker，格式 YYYY-MM-DD HH:mm:ss */
  lastLoginAt: string
  loginCount: number
  createdAt: string
  /** 新增未保存的行。为 true 时「用户名」可编辑。 */
  isNew?: boolean
}

/** 新增用户表单：不含系统自动生成的 ID、工号、创建时间。 */
export type UserForm = Omit<SysUser, 'id' | 'employeeNo' | 'createdAt' | 'isNew'>
