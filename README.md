# DSH 移动端插件

给 **DSH Folk**（安卓端 WebView 容器）用的两个客户端插件。都跑在 DSH 的 Web 前端里，
不需要改宿主、不需要 root。

| 插件 | 作用 |
|---|---|
| [dsh-ime-submit-guard](dsh-ime-submit-guard/) | **阻止语音输入自动发送 + 控制键盘唤起**：输入法在合成收尾时会自己把消息发出去，还会丢掉大部分文字；同时键盘应该只在手动点击输入框时弹出，新建会话 / 点发送都不该唤醒它 |
| [dsh-sidebar-tweaks](dsh-sidebar-tweaks/) | **侧边栏重排**：插件 / 工作区 / 鲸鱼 / 新建会话 / 设置 的层级与沉底布局，并让状态栏安全区自适应（顶部不再被状态栏压住） |

**要接手继续做，请先读 [HANDOFF.md](HANDOFF.md)** —— 里面有已证实的结论、踩过的坑、
设备约束和下一步 TODO，能省掉大量重复排查。

## 插件怎么工作

DSH 的客户端插件通过 `window.__ModuleLoader__` 注册，两条硬约束：

1. `load()` 必须在**顶层**调用，且脚本执行期间**不能抛异常** —— 宿主是队列加载器，
   抛异常会导致队列永远不排空、WebUI 白屏。
2. **不能用 `MutationObserver`** —— 回调里写 DOM 会重新触发自己的 childList 观察，
   形成无限微任务循环，界面卡在 `Loading plugins...`。用 `setInterval` 轮询是安全的。

## 安装

插件放在 DSH 的 profile 里，以**真实文件**形式存在（**不要用符号链接**，原因见 HANDOFF）：

```
~/.dsh/plugins/<name>/                 # 权威源
~/.dsh/profiles/web/node_modules/<name>/   # 生效路径（必须是真实文件）
```

装完重启 DSH app。若运行时更新过、或插件突然失效，先跑：

```sh
sh ~/.dsh/plugins/restore-after-runtime-change.sh
```

## 自检

两个插件都带本地校验脚本，不依赖设备：

```sh
node dsh-sidebar-tweaks/verify.mjs dsh-sidebar-tweaks/lib/client.js
node dsh-ime-submit-guard/verify.mjs dsh-ime-submit-guard/lib/client.js
```

## 许可证

MIT
