/**
 * 登录相关类型。演示环境账号写死在 store 里，这里只描述请求体和会话用户。
 */
import type { UserRole } from './user'

export interface LoginPayload {
  username: string
  password: string
}

/** 登录成功后写入 localStorage 的会话信息。 */
export interface AuthUser {
  username: string
  name: string
  role: UserRole
}
