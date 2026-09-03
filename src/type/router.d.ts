export {}

/**
 * 扩展 vue-router 的 RouteMeta：
 * - title：文档标题
 * - public：无需登录
 * - breadcrumb：后台顶栏面包屑
 */
declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    public?: boolean
    breadcrumb?: { title: string }[]
  }
}
