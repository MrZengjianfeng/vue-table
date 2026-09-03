<script setup lang="ts">
/**
 * 用户管理页：维护一份本地 mock 用户列表，支持新增、保存校验、删除。
 * 表格内联编辑与方向键换格由 UserTable 负责。
 */
import { PlusOutlined } from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { ref } from 'vue'
import type { SysUser } from '@/type'
import { wait } from '@/utils'
import UserTable from './components/UserTable.vue'
import { emptyUserForm, formatDateTime, readonlyFieldLabels } from './constants'
import { mockUsers } from './mock'

const loading = ref(false)
const users = ref<SysUser[]>([...mockUsers])
const tableRef = ref<{
  validate: () => Promise<unknown> | undefined
}>()

function addUser() {
  const nextId = Math.max(...users.value.map((item) => item.id), 0) + 1
  // 插到第一行，isNew 为 true 时「用户名」才可编辑。
  users.value = [
    {
      id: nextId,
      employeeNo: `EMP${String(10000 + nextId)}`,
      ...emptyUserForm(),
      createdAt: formatDateTime(),
      isNew: true,
    },
    ...users.value,
  ]
}

async function handleSave() {
  await tableRef.value?.validate()
  loading.value = true
  await wait()
  // 保存后清掉 isNew，用户名重新变为只读。
  users.value = users.value.map((item) => ({ ...item, isNew: false }))
  loading.value = false
  message.success('已保存')
}

async function handleDelete(record: SysUser) {
  loading.value = true
  await wait()
  users.value = users.value.filter((item) => item.id !== record.id)
  loading.value = false
  message.success('已删除')
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h2>用户管理</h2>
        <p class="hint">不可编辑：{{ readonlyFieldLabels.join('、') }}；已有用户的用户名也不可改。</p>
      </div>
      <a-space>
        <a-button @click="addUser">
          <template #icon><PlusOutlined /></template>
          新增用户
        </a-button>
        <a-button type="primary" :loading="loading" @click="handleSave">保存</a-button>
      </a-space>
    </div>

    <UserTable ref="tableRef" v-model:users="users" :loading="loading" @delete="handleDelete" />
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
  gap: 16px;
}

.page-head h2 {
  margin: 0;
  font-size: 20px;
}

.hint {
  margin: 6px 0 0;
  color: #8c8c8c;
  font-size: 13px;
}
</style>
