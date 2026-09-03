/**
 * 登录会话。演示账号 admin / admin123，token 与用户信息存在 localStorage。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { AuthUser, LoginPayload, UserRole } from '@/type'

const TOKEN_KEY = 'vue-table-token'
const USER_KEY = 'vue-table-user'

function readStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as AuthUser
  } catch {
    localStorage.removeItem(USER_KEY)
    return null
  }
}

export const useUserStore = defineStore('user', () => {
  const stored = readStoredUser()
  const token = ref(localStorage.getItem(TOKEN_KEY) || '')
  const username = ref(stored?.username ?? '')
  const name = ref(stored?.name ?? '')
  const role = ref<UserRole | ''>(stored?.role ?? '')

  const isLoggedIn = computed(() => Boolean(token.value))

  function login(payload: LoginPayload) {
    if (payload.username !== 'admin' || payload.password !== 'admin123') {
      return false
    }

    token.value = 'mock-token'
    username.value = 'admin'
    name.value = '管理员'
    role.value = 'admin'
    localStorage.setItem(TOKEN_KEY, token.value)
    localStorage.setItem(
      USER_KEY,
      JSON.stringify({
        username: username.value,
        name: name.value,
        role: role.value,
      } satisfies AuthUser),
    )
    return true
  }

  function logout() {
    token.value = ''
    username.value = ''
    name.value = ''
    role.value = ''
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
  }

  return { token, username, name, role, isLoggedIn, login, logout }
})
