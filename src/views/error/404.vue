<script setup lang="ts">
/** 未匹配路由时的 404 页。 */
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<template>
  <div class="not-found">
    <a-result status="404" title="404" sub-title="页面不存在，或你访问的地址已失效。">
      <template #extra>
        <a-button type="primary" @click="router.push('/user')">返回用户管理</a-button>
      </template>
    </a-result>
  </div>
</template>

<style scoped>
.not-found {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f7fa;
}
</style>
