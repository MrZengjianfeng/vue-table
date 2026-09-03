/** 模拟接口耗时，保存 / 删除时让按钮进入 loading。 */
export function wait(ms = 280) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}
