/**
 * dsh-mobile-tweaks，node（宿主）侧。
 *
 * 本插件是**纯客户端**插件：真正干活的代码在浏览器里（lib/client.js）。
 * 这个文件存在的唯一理由是让 profile 的 Loader 里有一个可解析的插件行 ——
 * cordis.patch.yml 里 insert 的那一行 name 指向本包，host 端需要一个 apply。
 *
 * 这里刻意**什么都不做**：不加路由、不碰 http、不改任何宿主服务。
 * 侧边栏重排与输入法保护全部在浏览器侧完成。
 *
 * 合并来源（2026-10-18）：
 *   · dsh-sidebar-tweaks   —— 侧边栏重排 / 状态栏避让 / 挖孔跳变修复
 *   · dsh-ime-submit-guard —— 输入法（听写）提交保护 / 焦点保护
 * 两者原本各自有宿主侧空实现，合并后只需这一个。
 */

/** 插件名（与 package.json / cordis.patch.yml 的 id 一致）。 */
export const name = 'dsh-mobile-tweaks';

/**
 * 宿主侧空实现。
 *
 * 参数按最小结构化面声明，不 import 任何宿主包 —— 目标机器的 node_modules 里
 * 不一定有宿主类型，写成结构化类型才能在任何宿主版本下都编译通过。
 */
export function apply(_ctx) {
    // 有意为空：见上方文件注释。
}
