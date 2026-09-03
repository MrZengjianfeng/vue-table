/**
 * 路由。入口直接进用户管理，不再经过登录页。
 */
import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/login',
      redirect: '/user',
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
      meta: { title: '页面不存在' },
    },
  ],
})

router.beforeEach((to) => {
  document.title = `${to.meta.title ?? '后台'} · vue Table`
  return true
})

export default router
