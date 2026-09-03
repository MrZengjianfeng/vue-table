<script setup lang="ts">
/**
 * 根组件：中文语言包 + 主题。
 * DatePicker 用了 value-format 字符串，必须启用 dayjs 的 customParseFormat。
 */
import { theme } from 'ant-design-vue'
import zhCN from 'ant-design-vue/es/locale/zh_CN'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import 'dayjs/locale/zh-cn'

dayjs.extend(customParseFormat)
dayjs.locale('zh-cn')
</script>

<template>
  <a-config-provider
    :locale="zhCN"
    :theme="{
      algorithm: theme.defaultAlgorithm,
      token: { colorPrimary: '#1677ff', borderRadius: 6 },
    }"
  >
    <router-view />
  </a-config-provider>
</template>
