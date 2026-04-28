# 热更新与 GitHub 发布说明

## 能达到什么效果

本项目现在支持“检测到 GitHub Release 后，在侧边栏点击一键更新”。

点击“一键更新”时，侧边栏会通过后台调用 `chrome.runtime.requestUpdateCheck()`：

1. 浏览器更新通道检测到可安装的新版本；
2. 后台收到 `update_available`；
3. 扩展自动执行 `chrome.runtime.reload()`；
4. 新版本生效，用户不需要先移除扩展、再重新加载扩展目录。

配置保存在 `chrome.storage` / `localStorage` 中，不会因为扩展自动重载而主动清空。

## 必须知道的限制

Chrome 扩展不能像网页一样从 GitHub 拉取远程 JS 后直接替换执行。真正的扩展代码更新必须走浏览器扩展更新通道。

因此：

- 如果用户当前是 `chrome://extensions` 里“加载已解压的扩展程序”，浏览器不会自动替换本地目录；一键更新会退回到打开 GitHub Release，让用户手动下载新版。
- 如果用户安装的是带 `update_url` 的 CRX，且 GitHub Release 里有可访问的 `updates.xml` 与同签名 `.crx`，一键更新可以自动应用。
- 更新会触发扩展内部重载；这不是让用户手动移除 / 重载，而是浏览器自动完成。正在跑的自动流程会中断，所以更新前建议先停止流程并导出配置。

## 当前代码链路

- `manifest.json`
  - 新增 `update_url`：`https://github.com/santoslgl01-web/codex-oauth-reload/releases/latest/download/updates.xml`
- `sidepanel/update-service.js`
  - 负责读取 GitHub Releases
  - 新增 `requestExtensionUpdate()`，向后台发送 `REQUEST_EXTENSION_UPDATE`
- `sidepanel/sidepanel.js`
  - 更新卡片按钮改为“一键更新”
  - 如果浏览器更新通道不可用，会自动打开 GitHub Release
- `background/runtime-update.js`
  - 封装 `chrome.runtime.requestUpdateCheck()`
  - 检测到 `update_available` 后自动 `chrome.runtime.reload()`
- `background/message-router.js`
  - 新增 `REQUEST_EXTENSION_UPDATE` 消息入口
  - Ultra1.5.2 额外新增 `REQUEST_EXTENSION_RELOAD`，用于侧边栏“重启插件”按钮主动调用 `chrome.runtime.reload()`，解决热更新后新后台功能还未加载的问题

## GitHub Release 需要上传什么

每次发布新版时，Release 至少需要：

1. 同签名的 CRX 文件，例如：
   `codex-oauth-reload-Ultra1.5.crx`
2. 更新清单：
   `updates.xml`

`updates.xml` 里的 `appid` 必须等于 CRX 的扩展 ID，`codebase` 必须指向当前版本 CRX 的 GitHub Release 下载地址，`version` 必须等于 `manifest.json` 里的数字版本。

## 生成 updates.xml

示例：

```bash
npm run generate:update-manifest -- \
  --extension-id <你的32位扩展ID> \
  --crx-url https://github.com/santoslgl01-web/codex-oauth-reload/releases/download/Ultra1.5/codex-oauth-reload-Ultra1.5.crx \
  --version 1.5
```

默认输出：

```text
dist/updates.xml
```

也可以通过 `UPDATE_XML_PATH` 或 `--output` 指定输出路径。

## CRX 签名注意事项

- 首次打包 CRX 时会产生私钥 `.pem`。
- 后续每个版本必须使用同一个 `.pem` 打包，否则扩展 ID 会改变，旧版本无法升级到新版本。
- 不要把 `.pem` 私钥提交到 GitHub；建议保存在本机安全位置或 GitHub Actions Secret。

## 推荐发布顺序

1. 修改代码与 `manifest.json` 版本号。
2. 使用同一个私钥打包 CRX。
3. 用 `scripts/generate-update-manifest.js` 生成 `updates.xml`。
4. 创建 GitHub Release，并上传 `.crx` 与 `updates.xml`。
5. 已安装 CRX 的用户在侧边栏看到更新后点击“一键更新”。

## Ultra1.5 发布资产记录

Ultra1.5 已发布到：

- Release: `https://github.com/santoslgl01-web/codex-oauth-reload/releases/tag/Ultra1.5`
- CRX: `https://github.com/santoslgl01-web/codex-oauth-reload/releases/download/Ultra1.5/codex-oauth-reload-Ultra1.5.crx`
- updates.xml: `https://github.com/santoslgl01-web/codex-oauth-reload/releases/download/Ultra1.5/updates.xml`
- Extension ID: `gbjfndnlhnfnioenpkhfjakefkajclog`

本机首次生成的 CRX 签名私钥保存为：

```text
/Users/lgl/Downloads/codex-oauth-reload-release-key.pem
```

后续 Ultra1.6、Ultra1.7 等版本必须继续使用这把 `.pem` 打包，否则扩展 ID 会变化，已经安装 Ultra1.5 CRX 的用户无法通过“一键更新”升级。

## Ultra1.5.1 热修复资产记录

Ultra1.5.1 修复了侧边栏 `Clash 桥接` 开关和控制器输入框在部分状态下不可点击 / 不可编辑的问题。

- Release: `https://github.com/santoslgl01-web/codex-oauth-reload/releases/tag/Ultra1.5.1`
- CRX: `https://github.com/santoslgl01-web/codex-oauth-reload/releases/download/Ultra1.5.1/codex-oauth-reload-Ultra1.5.1.crx`
- updates.xml: `https://github.com/santoslgl01-web/codex-oauth-reload/releases/download/Ultra1.5.1/updates.xml`
- Extension ID: `gbjfndnlhnfnioenpkhfjakefkajclog`

## Ultra1.5.2 发布资产记录

Ultra1.5.2 增加了代理节点同步与侧边栏一键重启：

- `background/proxy-node-manager.js` 参考 Pro3.3 的独立代理节点管理能力，支持从 `free-nodes/clashfree` 拉取最新 Clash 节点文件、解析节点、写入本地 Clash / Mihomo 控制器并保存节点状态。
- `sidepanel/sidepanel.html` / `sidepanel/sidepanel.js` 在 `Clash 桥接` 区域增加 `节点源`、`更新节点`、`代理节点` 和 `节点状态`。
- 配置下拉菜单新增 `重启插件`，用于热更新完成后主动重启扩展服务工作线程；若旧后台还不支持 `REQUEST_EXTENSION_RELOAD`，侧边栏会直接调用 `chrome.runtime.reload()` 兜底，让新功能无需手动移除 / 重新加载即可生效。

发布后资产应为：

- Release: `https://github.com/santoslgl01-web/codex-oauth-reload/releases/tag/Ultra1.5.2`
- CRX: `https://github.com/santoslgl01-web/codex-oauth-reload/releases/download/Ultra1.5.2/codex-oauth-reload-Ultra1.5.2.crx`
- updates.xml: `https://github.com/santoslgl01-web/codex-oauth-reload/releases/download/Ultra1.5.2/updates.xml`
- Extension ID: `gbjfndnlhnfnioenpkhfjakefkajclog`
