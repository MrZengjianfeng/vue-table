/**
 * 路由。/login、404 为 public；其余走后台布局，未登录会跳到登录页。
 */
import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '@/stores/user'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/login/index.vue'),
      meta: { title: '登录', public: true },
    },
    {
      path: '/',
      component: () => import('@/layouts/AdminLayout.vue'),
      redirect: '/user',
      children: [
        {
          path: 'user',
          name: 'user',
          component: () => import('@/views/user/index.vue'),
          meta: {
            title: '用户管理',
            breadcrumb: [{ title: '用户管理' }],
          },
        },
      ],
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('@/views/error/404.vue'),
      meta: { title: '页面不存在', public: true },
    },
  ],
})

router.beforeEach((to) => {
  const userStore = useUserStore()
  document.title = `${to.meta.title ?? '后台'} · vue Table`

  // 已登录再进登录页，直接去用户管理。
  if (to.path === '/login' && userStore.isLoggedIn) {
    return '/user'
  }

  // 非 public 页必须有 token，否则带上原地址去登录。
  if (!to.meta.public && !userStore.isLoggedIn) {
    return {
      path: '/login',
      query: { redirect: to.fullPath },
    }
  }

  return true
})

export default router
