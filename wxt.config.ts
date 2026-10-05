import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "一键分发 - Markdown 多平台草稿",
    description: "编辑或导入 Markdown，一键填入微信公众号、知乎、掘金和知识星球草稿。",
    minimum_chrome_version: "114",
    action: {
      default_title: "打开一键分发工作台",
    },
    permissions: ["tabs", "tabGroups", "storage", "scripting"],
    host_permissions: [
      "https://mp.weixin.qq.com/*",
      "https://www.zhihu.com/*",
      "https://zhuanlan.zhihu.com/*",
      "https://juejin.cn/*",
      "https://wx.zsxq.com/*",
    ],
  },
  vite: () => ({ plugins: [tailwindcss()] }),
});
