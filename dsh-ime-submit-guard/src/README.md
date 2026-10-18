# src/ 是历史版本，不要用它构建

这里的 TypeScript 是插件**早期**的版本，其编译产物存在已被证实的严重缺陷：

- 生成的 `client.js` 里含 `MutationObserver`，回调写 DOM 会重新触发自身的
  `childList` 观察 → 无限微任务循环 → 卡在宿主的 `Loading plugins...`，**WebUI 打不开**；
- 登录注册方式也曾经把宿主队列加载器卡死（详见上级 `README.md` 的"三条硬约束"）。

**本仓库的唯一权威是上级目录的 `lib/client.js`**（手工维护，无构建步骤）。
这些 `.ts` 仅作历史留档，请勿据其构建，也勿以为改这里会生效。

如确实要恢复 TypeScript 构建链，需先自行完成以下工作：

1. 移除全部 `MutationObserver` 用法，改为 `setInterval` 轮询；
2. 保证顶层直接调用 `window.__ModuleLoader__.load(...)`，不要包在 IIFE 里；
3. 保证 `apply()` 在任何恶劣 `ctx`（`null` / 无 `effect` / 非 DOM 环境）下都不抛异常；
4. 补齐焦点守卫：`inputmode="none"` 常驻 + 仅在触摸起点落在输入框内时解除
   （仅靠 `focus` 里 `blur()` 实测无效）；
5. 用 `node verify.mjs lib/client.js` 验证后**再**替换 `lib/client.js`。
