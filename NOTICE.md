# 第三方组件与来源声明

本项目**自身的源代码与文档**以 MIT 许可发布，全文见 [LICENSE](LICENSE)。

## 一、随同分发的第三方代码

| 组件 | 位置 | 许可 |
|---|---|---|
| Neutralinojs 客户端库 v6.10.0 | `app/resources/js/neutralino.js` | MIT，Copyright (c) 2021-2025 Neutralinojs and contributors |
| esbuild（仅开发依赖，用于生成 bundle） | 不随仓库分发 | MIT，Copyright (c) 2020 Evan Wallace |

- `app/resources/js/neutralino.js` 原样保留，未改动其逻辑；本项目只调用它的公开 API，文件头保留了版权与许可标识。
- `app/resources/js/bundle.js`（不入库）由 esbuild 生成，其中只包含本项目自己的代码。
- Neutralinojs 运行时二进制（`chaldea2bb-win_x64.exe`）**不随本仓库分发**，请从 Neutralinojs 官方发行包获取，同样遵循其 MIT 许可。

## 二、不包含、也不授权的内容

本仓库与发行物中**不包含**下列任何程序或资源，也不对其授予任何许可：

- **Chaldea**（含其代码、界面素材、图标）。本项目只读取用户本机由 Chaldea 写出的存档文件。
- **BBchannel**（含其程序与资源表）。本项目只在用户本机读取其资源表，生成其可识别的脚本文件。
- **FGO 游戏素材**（从者名、立绘、界面截图）与 **Atlas Academy** 的接口数据。

文档截图中的游戏画面与从者立绘，版权归 FATE/Grand Order Project、TYPE-MOON 等权利人所有，此处仅作操作说明使用；如权利人要求，会立即移除。

## 三、关系说明

本项目与 Chaldea、BBchannel、Atlas Academy 的作者**均无隶属关系，也未获得其背书或授权**。使用者需自行安装上述软件，并自行遵守其各自的许可与使用条款。

## 四、格式适配

为了让生成的脚本能被 BBchannel 正确识别，本项目内置了少量针对特定从者、御主礼装的调用写法。这些写法描述的是脚本格式的用法，**不包含 BBchannel 的代码或数据**；其语义以 BBchannel 的实际行为为准。如权利人认为有不妥之处，告知即移除。
