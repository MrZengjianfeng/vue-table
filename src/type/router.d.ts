export {}

/**
 * 扩展 vue-router 的 RouteMeta：
 * - title：文档标题
 * - breadcrumb：后台顶栏面包屑
 */
declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    breadcrumb?: { title: string }[]
  }
}
