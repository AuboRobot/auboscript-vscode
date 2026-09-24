# AUBO 多语言 API 编辑支持

## 目标

让同一份 SDK API 元数据同时服务 Lua、Python 和 C++ 编辑体验。SDK 构建侧负责验证和导出元数据，VS Code 扩展只消费导出的 catalog，不依赖 SDK 源码、头文件或二进制。

## 边界

- Lua 继续使用现有补全、悬停、签名、诊断和 AI 上下文。
- Python 使用公开 API catalog 生成本地 `.pyi` 类型桩，并交给 Pylance/Pyright 提供类型分析。
- C++ 使用本机 SDK 头文件和 `compile_commands.json`，交给 clangd 或 C/C++ 扩展提供语义分析；插件负责生成配置和 API 上下文。
- VSIX 和公开仓库只包含 catalog、生成器和插件运行时代码，不包含 SDK 源码、头文件、动态库或私有构建产物。

## API 中间产物

SDK 构建流程输出版本化 catalog，至少包含：

- `schemaVersion`、`interfaceVersion`、`sdkVersion`
- `macroValidation.status` 和校验对应的接口版本
- 按语言区分的 binding：`lua`、`python`、`cpp`
- 模块、命名空间、类/对象、属性、方法、参数、参数类型、返回类型和说明
- Python 的 import 路径与类继承关系
- C++ 的命名空间、头文件 include 名称、类继承关系和方法签名

导出器只复制上述字段并拒绝路径、仓库地址、提交哈希和源码内容。现有 Lua catalog 保持兼容。

## 插件行为

插件根据当前语言选择对应 binding：

- `.lua` / AUBO Script：保留现有 provider 和 LuaLS stubs。
- `.py`：在工作区 `.aubo/python` 生成 `.pyi`，加入 Pylance/Pyright 的分析路径；插件补充 AUBO 方法签名和 API context。
- `.cpp` / `.h`：检测 clangd/C/C++ 配置和本机 SDK include 根；生成最小 workspace 配置与 API context，不复制头文件。

没有本机 Python SDK 或 C++ SDK 时，插件仍可提供 catalog 级补全，但不伪造运行时类型检查和编译诊断。

## 验证

- 每种语言至少覆盖 import/namespace、对象链、方法参数、返回类型和未知 API 诊断。
- 遍历 catalog 的全部方法，检查生成的 Python stubs、C++ 声明和 AI context 均存在对应签名。
- CI 在 Linux 和 Windows 执行 clean install、测试和 VSIX 打包。
- 打包检查继续拒绝本地 catalog、源码映射、SDK 源码和二进制。
