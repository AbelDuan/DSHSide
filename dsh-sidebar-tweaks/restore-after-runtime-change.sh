#!/system/bin/sh
# folk 运行时更新 / 装插件之后的收尾修复。
#
# ══ 什么时候必须跑 ═══════════════════════════════════════════════════════
#
#   1) 运行时更新过、或 app 做过 seed/repair
#   2) 装过 / 卸过任何插件、跑过插件管理器
#   3) 发现自建插件突然失效（小鲸鱼回到顶部、输入法守卫失灵）
#   4) 发现会话报 working-directory: directory does not exist
#
# 跑完重启 folk app（force-stop 后重新打开）。
#
# 用法：su -c 'sh /root/.dsh/plugins/restore-after-runtime-change.sh'
#
# ══ 它修两件事 ═══════════════════════════════════════════════════════════
#
# 【一】自建插件的 node_modules 目录（会被 pnpm 重跑破坏）
#
#   folk 运行时不支持硬链接（启动日志：`硬链接: 不支持 ... · 启用 l2s 模拟`），
#   它用 `.l2s/` 影子目录把硬链接模拟成绝对路径符号链接。而 pnpm 正是用硬链接
#   铺包的，所以 pnpm 一重跑，插件目录里的文件就变成：
#
#     node_modules/dsh-sidebar-tweaks/package.json
#       -> /data/user/0/top.funcun.dshfolk/files/rootfs/.l2s/.l2s.package.json0002
#
#   ⚠ 那是**宿主机**路径。宿主机侧 wc -c 能读、字节数也对；但容器里 `/` 就是
#     rootfs，该路径不存在 → dsh 读不到插件的 package.json / cordis.patch.yml
#     → bundle 的 insert 不生效 → 插件被**静默忽略**（连 skipping 都不打印）。
#
#   所以判据不能是"可读"（宿主机侧一律可读），必须是"目录里有没有符号链接"。
#
# 【二】工作区目录（会被 rootfs 重写清掉）
#
#   rootfs 重写会清空 /root/* 下除点目录外的内容，而会话记录的工作目录
#   （/root/LSP&KSU 等）不在 rootfs 的重建范围内 → 会话报
#   working-directory: directory does not exist。
#   这里按 ~/.dsh/storages/workspace.json 的登记补齐（只创建缺失的，不动已有内容）。
#
# ⚠ 提醒：重要文件别放 /root/ 下 —— 放 /sdcard（绑定挂载，不受 rootfs 影响）
#   或 ~/.dsh（运行时更新会保留）。

R=/data/data/top.funcun.dshfolk/files/rootfs
NM=$R/root/.dsh/profiles/web/node_modules
WJ=$R/root/.dsh/storages/workspace.json
OWNER=10372:10372

echo "═══ 〇、容器运行时（最关键的一项）═══"
PF=/data/data/top.funcun.dshfolk/shared_prefs/dshfolk.xml
RT=$(grep -oE '<string name="container_runtime">[^<]+' "$PF" 2>/dev/null | sed 's/.*>//')
echo "  配置里的 container_runtime = ${RT:-未知}"
echo "  实际进程: $(ps -ef | grep -oE 'libproroot\.so|libproot\.so' | head -1)"
if [ "$RT" != "proroot" ]; then
  echo ""
  echo "  ⚠️⚠️ 警告：运行时不是 proroot！"
  echo "  proot 模式下 folk 的 l2s 影子目录会把「硬链接 / 原子写入」模拟成"
  echo "  指向 /data/.../rootfs/.l2s/ 的宿主绝对路径符号链接，而容器内解析不到，"
  echo "  于是插件被静默忽略、会话报 ENOENT —— 这正是 2026-10-18 那次"
  echo "  「小鲸鱼回到顶部 + 输入法守卫失灵 + 会话打不开」的统一根因。"
  echo "  请到 app 设置 → 功能 → 运行时 里把容器运行时切回 proroot，"
  echo "  或执行：sed -i 改 shared_prefs/dshfolk.xml 里的 container_runtime（需保留 inode 与 SELinux context）。"
  echo ""
fi
echo "═══ 一、自建插件的 node_modules 目录 ═══"
fixed=0
for n in dsh-ime-submit-guard dsh-sidebar-tweaks; do
  SRC=$R/root/.dsh/plugins/$n
  DST=$NM/$n

  if [ ! -d "$SRC" ]; then
    echo "  ! $n: 插件源不存在（$SRC），跳过"
    continue
  fi

  links=$(find "$DST" -type l 2>/dev/null | wc -l)
  if [ "$links" -eq 0 ] && [ -r "$DST/lib/client.js" ]; then
    echo "  ok $n: 无符号链接（$(wc -c < "$DST/lib/client.js") 字节），不动"
    continue
  fi

  echo "  >> $n: 发现 $links 个符号链接（容器内不可读），重建为真实文件"
  if [ -L "$DST" ]; then rm -f "$DST"; else rm -rf "$DST"; fi
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
echo "═══ 二、工作区目录 ═══"
if [ ! -f "$WJ" ]; then
  echo "  ! 找不到 $WJ，跳过"
else
  wfixed=0
  grep -oE '"path": "[^"]+"' "$WJ" | sed 's/"path": "//; s/"$//' | while read -r p; do
    case "$p" in
      /root/*)
        full="$R$p"
        if [ -d "$full" ]; then
          echo "  ok   $p（$(ls -A "$full" 2>/dev/null | wc -l) 项）"
        else
          mkdir -p "$full"
          chown "$OWNER" "$full"
          chmod 700 "$full"
          echo "  ✅   $p 已创建"
        fi
        ;;
      *) echo "  skip $p（不在 /root 下）" ;;
    esac
  done
fi

echo ""
if [ "$fixed" -gt 0 ]; then
  echo "已修复 $fixed 个插件 —— 请重启 folk app"
else
  echo "插件无需修复（若刚改过工作区目录，直接重试会话即可）"
fi
