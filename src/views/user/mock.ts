/**
 * 用户管理演示数据。固定 6 条，表格不分页，方便验证方向键换格边界。
 */
import type { SysUser, UserGender, UserRole, UserStatus } from '@/type'
import { formatDate, formatDateTime, padNo } from './constants'

const roles: UserRole[] = ['admin', 'editor', 'viewer']
const userStatuses: UserStatus[] = ['active', 'disabled']
const genders: UserGender[] = ['male', 'female']
const departments = ['研发', '产品', '运营', '设计', '人事']
const names = ['陈晨', '林悦', '王凯', '赵敏', '周宁', '吴倩', '郑浩', '孙悦', '钱进', '冯岚']

function dateAt(offsetDays: number) {
  const date = new Date()
  date.setDate(date.getDate() - offsetDays)
  return formatDateTime(date)
}

function dateOnlyAt(offsetDays: number) {
  const date = new Date()
  date.setDate(date.getDate() - offsetDays)
  return formatDate(date)
}

export const mockUsers: SysUser[] = Array.from({ length: 6 }, (_, index) => {
  const id = index + 1
  const name = names[index % names.length]
  return {
    id,
    employeeNo: `EMP${String(10000 + id)}`,
    username: `user${padNo(id)}`,
    name: `${name}${id}`,
    gender: genders[index % genders.length],
    email: `user${id}@example.com`,
    phone: `138${String(10000000 + id).slice(-8)}`,
    telephone: `010-${String(80000000 + id).slice(-8)}`,
    department: departments[index % departments.length],
    role: roles[index % roles.length],
    status: userStatuses[index % 5 === 0 ? 1 : 0],
    remark: index % 4 === 0 ? '重点关注' : '',
    registeredAt: dateOnlyAt(id * 3),
    lastLoginAt: dateAt(index),
    loginCount: 3 + (index % 40),
    createdAt: dateAt(id * 2),
  }
})
