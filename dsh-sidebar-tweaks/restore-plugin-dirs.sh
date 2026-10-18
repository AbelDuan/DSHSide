#!/system/bin/sh
# 修复 profile 里两个自建插件的 node_modules 目录。
#
# ══ 根因（2026-10-18 实测确认，这是最要紧的一条）══════════════════════════
#
# folk 运行时不支持硬链接（启动日志：`硬链接: 不支持 ... · 启用 l2s 模拟`），
# 于是它用 `.l2s/` 影子目录把硬链接**模拟成绝对路径符号链接**。
#
# pnpm 正是用硬链接把包铺进 node_modules 的。所以任何一次 pnpm 重跑之后，
# 插件目录里的文件会变成：
#
#   node_modules/dsh-sidebar-tweaks/package.json
#     -> /data/user/0/top.funcun.dshfolk/files/rootfs/.l2s/.l2s.package.json0002
#   node_modules/dsh-ime-submit-guard/lib/client.js
#     -> /data/user/0/top.funcun.dshfolk/files/rootfs/.l2s/.l2s.client.js0001
#
# ⚠ 那个目标路径是**宿主机**路径。宿主机侧 `wc -c` 能读，看起来一切正常；
#   但容器里 `/` 就是 rootfs，这个路径**不存在** —— 容器内的 dsh 读不到插件的
#   package.json / cordis.patch.yml，于是 bundle 的 insert 不生效，
#   插件被**静默忽略**（连 "skipping profile bundle" 都不会打印）。
#
# 表现：侧边栏排序失效、输入法守卫失效、小鲸鱼回到顶部 —— 而文件"看起来"是对的。
#
# 对照：正常工作的第三方插件（dsh-opencode-session、dshmarket）都是**真实文件**。
#
# ══ 所以判据不能是"可读"，必须是"目录里有没有符号链接" ═══════════════════
#
# 用法：su -c 'sh /root/.dsh/plugins/restore-plugin-dirs.sh'
# 跑完重启 folk app（force-stop 后重新打开）。
#
# 什么时候要跑：装了/卸了任何插件、跑过插件管理器、或发现自建插件突然失效。

set -e

R=/data/data/top.funcun.dshfolk/files/rootfs/root/.dsh
NM=$R/profiles/web/node_modules
OWNER=10372:10372

fixed=0
for n in dsh-ime-submit-guard dsh-sidebar-tweaks; do
  SRC=$R/plugins/$n
  DST=$NM/$n

  if [ ! -d "$SRC" ]; then
    echo "  ! $n: 插件源不存在（$SRC），跳过"
    continue
  fi

  # 判据：目录里只要有任何符号链接（含 .l2s 那种），就必须重建。
  links=$(find "$DST" -type l 2>/dev/null | wc -l)

  if [ "$links" -eq 0 ] && [ -r "$DST/lib/client.js" ]; then
    echo "  ok $n: 无符号链接（$(wc -c < "$DST/lib/client.js") 字节），不动"
    continue
  fi

  echo "  >> $n: 发现 $links 个符号链接（容器内不可读），从插件源重建为真实文件"
  if [ -L "$DST" ]; then
    rm -f "$DST"
  else
    rm -rf "$DST"
  fi
  mkdir -p "$DST"
  cp -r "$SRC/." "$DST/"
  chown -R "$OWNER" "$DST"

  left=$(find "$DST" -type l 2>/dev/null | wc -l)
  if [ "$left" -eq 0 ] && [ -r "$DST/lib/client.js" ]; then
    echo "  ✅ $n: 修复完成（$(wc -c < "$DST/lib/client.js") 字节，符号链接 0 个）"
    fixed=$((fixed + 1))
  else
    echo "  ❌ $n: 修复后仍有 $left 个符号链接"
  fi
done

echo ""
if [ "$fixed" -gt 0 ]; then
  echo "已修复 $fixed 个插件 —— 请重启 folk app（force-stop 后重新打开）"
else
  echo "无需修复"
fi
