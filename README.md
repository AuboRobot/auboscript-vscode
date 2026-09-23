# AUBOScript for VS Code

Public VS Code support for AUBO Script/Lua files.

## API catalog

The extension includes AUBO Lua API metadata for completion, hover
documentation, and signature help. Catalog modules describe Lua require paths,
objects, methods, parameters, and return types, so completion covers forms such
as `require('aubo')`, `aubo.sched.sync()`, and
`motionControl:moveJoint(...)`.
If the workspace contains `api/catalog.local.json` or `catalog.local.json`, the
extension discovers it automatically. Set `aubo.apiCatalogPath` when the
catalog is stored elsewhere.

When a workspace is open, activation writes API context to
`.aubo/aubo-api-context.md` and LuaLS stubs to `.aubo/lua`. This gives editor AI
agents and LuaLS the same names and signatures as the extension. Run
**AUBO: Refresh AI API Context** after changing the catalog.

## 使用

### 开发调试

```bash
npm install
npm test
```

在 VS Code 中按 `F5` 启动 Extension Development Host，然后新建或打开
`.lua` 文件。输入 `function` 等前缀即可使用 Lua 片段；内置 API catalog
会提供 API 补全，按 `Ctrl+Space` 可查看，鼠标悬停可查看说明。
插件也会检查字符串和括号等基础 Lua 语法错误；示教器脚本按
`require('aubo')`、`sched.select_robot(1)`、`moveJoint(...)` 的实际生成形式编写。

### 配置 API catalog

在 VS Code `settings.json` 中加入本地 catalog 路径：

```json
{
  "aubo.apiCatalogPath": "/path/to/catalog.json"
}
```

catalog 必须符合 [`api/catalog.schema.json`](api/catalog.schema.json)。插件启动时
会校验 catalog；更新后执行 **AUBO: Reload API Catalog** 即可重新注册补全、
悬停和签名帮助。右下角 `AUBO SDK ...` 状态栏显示当前 catalog 的 SDK 版本。

### 安装 VSIX

使用 Node.js 22 或更新版本执行（Node 14 无法运行当前打包工具依赖）：

```bash
npm ci
npm test
npm run package
```

然后在 VS Code 中选择 **Extensions: Install from VSIX...**，打开生成的
`auboscript-vscode-0.1.0.vsix`。

也可以使用 VS Code 命令行安装：

```bash
code --install-extension ./auboscript-vscode-0.1.0.vsix
```

Windows 用户不需要安装 Node.js 才能使用 VSIX。将 VSIX 文件复制到 Windows
电脑后，在 VS Code 中按 `Ctrl+Shift+P`，选择 **Extensions: Install from
VSIX...**，选中该文件；安装完成后执行 **Developer: Reload Window**。
也可以在 PowerShell 中运行：

```powershell
code --install-extension "$PWD\auboscript-vscode-0.1.0.vsix" --force
```

安装后执行 **Developer: Reload Window**，打开 `.lua` 文件。只有本地覆盖用的
`api/catalog.local.json` 保留在本机；需要覆盖版本时，将它放在工作区或在设置中
填写 `aubo.apiCatalogPath`，然后执行 **AUBO: Reload API Catalog**。
