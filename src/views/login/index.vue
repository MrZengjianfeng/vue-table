<script setup lang="ts">
/**
 * 登录页。成功后跳到 redirect 查询参数，没有则进用户管理。
 */
import { LockOutlined, UserOutlined } from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import type { LoginPayload } from '@/type'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()
const loading = ref(false)

const form = reactive<LoginPayload>({
  username: 'admin',
  password: 'admin123',
})

const rules = {
  username: [{ required: true, message: '请输入用户名' }],
  password: [{ required: true, message: '请输入密码' }],
}

async function onFinish() {
  loading.value = true
  try {
    const ok = userStore.login(form)
    if (!ok) {
      message.error('账号或密码错误')
      return
    }
    message.success('登录成功')
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/user'
    await router.replace(redirect)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="brand">
        <div class="brand-mark">VT</div>
        <h1>vue Table</h1>
        <p>Vue 3 + Ant Design Vue 后台管理</p>
      </div>
      <a-form :model="form" :rules="rules" layout="vertical" @finish="onFinish">
        <a-form-item name="username" label="用户名">
          <a-input v-model:value="form.username" size="large" placeholder="admin" allow-clear>
            <template #prefix><UserOutlined /></template>
          </a-input>
        </a-form-item>
        <a-form-item name="password" label="密码">
          <a-input-password v-model:value="form.password" size="large" placeholder="admin123">
            <template #prefix><LockOutlined /></template>
          </a-input-password>
        </a-form-item>
        <a-form-item>
          <a-button type="primary" html-type="submit" size="large" block :loading="loading">
            登录
          </a-button>
        </a-form-item>
      </a-form>
      <p class="hint">演示账号：admin / admin123</p>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(circle at top left, rgba(22, 119, 255, 0.18), transparent 32%),
    linear-gradient(180deg, #f4f7fb 0%, #e8eef6 100%);
}

.login-card {
  width: 400px;
  padding: 36px 32px 28px;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 18px 50px rgba(15, 23, 42, 0.08);
}

.brand {
  text-align: center;
  margin-bottom: 28px;
}

.brand-mark {
  width: 48px;
  height: 48px;
  margin: 0 auto 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: #1677ff;
  color: #fff;
  font-weight: 700;
  font-size: 18px;
}

.brand h1 {
  margin: 0;
  font-size: 24px;
  color: #1f1f1f;
}

.brand p,
.hint {
  margin: 8px 0 0;
  color: #8c8c8c;
}

.hint {
  text-align: center;
  font-size: 13px;
}
</style>
