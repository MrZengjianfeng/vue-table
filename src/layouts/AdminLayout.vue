<script setup lang="ts">
/**
 * 后台布局：侧栏菜单、顶栏面包屑。
 */
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  UserOutlined,
} from '@ant-design/icons-vue'
import type { MenuProps } from 'ant-design-vue'
import { computed, h, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const collapsed = ref(false)
const route = useRoute()
const router = useRouter()

const selectedKeys = computed(() => [route.path])

const menuItems: MenuProps['items'] = [
  {
    key: '/user',
    icon: () => h(UserOutlined),
    label: '用户管理',
  },
]

const breadcrumbItems = computed(() =>
  (route.meta.breadcrumb ?? [{ title: route.meta.title ?? '' }]).map((item) => ({
    title: item.title,
  })),
)

const onMenuClick: MenuProps['onClick'] = ({ key }) => {
  const path = String(key)
  if (path === route.path) return
  router.push(path)
}
</script>

<template>
  <a-layout class="admin-layout">
    <a-layout-sider v-model:collapsed="collapsed" :trigger="null" collapsible theme="dark" width="220">
      <div class="logo">
        <span class="logo-mark">VT</span>
        <span v-show="!collapsed" class="logo-text">vue Table</span>
      </div>
      <a-menu
        theme="dark"
        mode="inline"
        :selected-keys="selectedKeys"
        :items="menuItems"
        @click="onMenuClick"
      />
    </a-layout-sider>
    <a-layout>
      <a-layout-header class="admin-header">
        <div class="header-left">
          <component
            :is="collapsed ? MenuUnfoldOutlined : MenuFoldOutlined"
            class="trigger"
            @click="collapsed = !collapsed"
          />
          <a-breadcrumb :items="breadcrumbItems" />
        </div>
        <div class="user-entry">
          <a-avatar size="small" style="background: #1677ff">
            <template #icon><UserOutlined /></template>
          </a-avatar>
          <span>管理员</span>
        </div>
      </a-layout-header>
      <a-layout-content class="admin-content">
        <router-view />
      </a-layout-content>
    </a-layout>
  </a-layout>
</template>

<style scoped>
.admin-layout {
  min-height: 100vh;
}

.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 64px;
  padding: 0 20px;
  color: #fff;
  overflow: hidden;
}

.logo-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: #1677ff;
  font-weight: 700;
  flex-shrink: 0;
}

.logo-text {
  font-size: 16px;
  font-weight: 600;
  white-space: nowrap;
}

.admin-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 21, 41, 0.08);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.trigger {
  font-size: 18px;
  cursor: pointer;
}

.user-entry {
  display: flex;
  align-items: center;
  gap: 8px;
}

.admin-content {
  margin: 16px;
  padding: 20px;
  background: #fff;
  border-radius: 8px;
  min-height: calc(100vh - 96px);
}
</style>
