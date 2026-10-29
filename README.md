# chaldea2bb

> **非官方工具**，与 Chaldea、BBchannel 的作者无关，也未获其背书。
> 只读本地文件，不注入进程、不读内存、不模拟点击、不联网，也不上传任何数据。

把 **Chaldea**（战斗模拟）里保存的队伍，转换成 **BBchannel** 的战斗脚本 JSON。

本项目只包含自己的代码；它读取的两个软件需要你自己安装，仓库里不含它们的任何程序或数据。

## 环境要求

- Windows 10/11（窗口版依赖系统自带的 WebView2 运行时，一般已装）
- Node.js 18+（仅构建和开发模式需要，日常使用不需要）
- [Chaldea](https://chaldea.center)（读它的 `userdata.json`）
- BBchannel（读它的 `servant_info_CH.json` 等表；`BB_ROOT` 指到 BBchannel 目录）

两个数据目录在界面「脚本设置 → 路径」里填，或者走环境变量（见下表）。程序不内置默认路径，没填会直接提示，不会去猜。

## 启动

**双击 `start.cmd`**：打包界面 → 生成资源包 → 同步到桌面 `chaldea2bb\` → 打开窗口。

之后**直接双击桌面的 `chaldea2bb-win_x64.exe`** 即可，不用再走 `start.cmd`。桌面那个文件夹里是这几个文件：

```
chaldea2bb-win_x64.exe   运行时（用系统自带 WebView2）
resources.neu            界面资源包（构建产物）
neutralino.config.json   窗口配置
LICENSE  NOTICE.md       许可与第三方声明
```

转换结果写在程序文件夹的 `output\`，从分享链接存下的原始数据在 `raw\`（都在 exe 旁边）。

> 别直接双击工作区 `app\bin` 里的 exe：那是开发态二进制，需要命令行参数指向资源目录，单点只会闪退。日常用桌面那份即可。

开发调试用 **`dev-browser.cmd`**：起本地服务 + 浏览器打开（`http://127.0.0.1:5180`），改完刷新即可，不用重新打包。
界面右上角的 **「使用指引」** 里写了两种拿队伍的方式（共享队伍里分享 / 战斗模拟里保存），各配两张操作截图，并写明数据文件在哪（`Chaldea 主文件夹\userdata\user\userdata.json`）。

Chaldea 面板上方的 **「打开输出」** 直接打开结果文件夹。

页面流程：

1. **本地文件**：点「选择」挑 Chaldea 目录 → 自动列出里面的队伍 → 点某条队伍的「转换」；
2. **分享链接**：粘贴链接，弹窗勾选要注入出卡策略的回合 → 转换。
   - `data=` 开头的链接自带数据（base64url + gzip），**离线可解析**；
   - `id=` 开头的短链**不支持**：那条链接要在对方的服务器上取数据，本工具不代理，也不绕。

浏览器调试模式起的服务只监听 `127.0.0.1`，不对外暴露。程序只读取你选的文件夹，不修改 Chaldea 的数据。

## 页面

左右两块同规格面板：

- **Chaldea**：选/填目录，自动列出 `userdata.json` 里的队伍，点「转换」；
- **raw**：列出 `raw/` 里的原始 JSON，同样点「转换」——raw 文件本身就是队伍 JSON，可以直接二次转换。

顶部一行用于粘贴分享链接：解析后弹命名框，保存时同时写 `raw/` 与 `output/`。

## 命令行

```bash
# 两个目录必须设，不设会直接报错（没有内置默认值）
set BB_ROOT=D:\BBchannel
set CHALDEA_HOME=D:\Chaldea

# 省略第一个参数 = 读 %CHALDEA_HOME%\userdata\user\userdata.json 的最后一支队伍
node src/chaldea2bb.mjs

# 指定存档、队伍（序号或队伍名）与输出文件
node src/chaldea2bb.mjs "%CHALDEA_HOME%\userdata\user\userdata.json" 0 out.json
```

| 变量 | 说明 |
|---|---|
| `CHALDEA_HOME` | 必填：Chaldea 安装目录（读 `userdata/game` 的表与 `userdata/temp/atlas_api` 的关卡缓存） |
| `BB_ROOT` | 必填：BBchannel 目录（取从者名字表、御主礼装表） |

## 构建

```bash
npm install
npm run bundle      # 把界面脚本打成单文件 app/resources/js/bundle.js
cd app && npx neu build   # 生成 app/dist/chaldea2bb/resources.neu
```

`start.cmd` 会自动跑上面两步，然后把 exe / `resources.neu` / config / `LICENSE` / `NOTICE.md` 同步到桌面 `chaldea2bb\` 并启动。

运行时二进制 `app/bin/chaldea2bb-win_x64.exe` 来自 Neutralino 官方发行包（v6.10.0 的 `neutralino-win_x64.exe` 改名），仓库里不带二进制。

## 数据来源

- **输入**：Chaldea 里「保存为本地队伍」写下的 `userdata.json → users[0].battleSim.teams[n]`
  - 含 `quest{id,phase,enemyHash}`、`team{从者/礼装/御主礼装}`、`options`、`actions`（逐条动作）
- **技能名/目标类型**：`userdata/game/baseSkills.json`、`baseFunctions.json`、`baseTds.json`、`mysticCodes.json`
- **敌方站位**：`userdata/temp/atlas_api/*` 里该关卡的缓存（`stages[].enemies[].deckId` 就是站位 1/2/3）
- **从者名字**：BBchannel 的 `servant_info_CH.json`（`BB_ROOT` 指到含它的目录）
- **御主礼装编号**：BBchannel 的 `master_info.json`（在 `BB_ROOT` 或其上一级都认）+ Chaldea `mappingData.*.json` 里的 `mc_names` 中日文名对照，按名字查 `SN`，不写死；对不上就留空并提示

## 转换规则

| 项目 | 规则 |
|---|---|
| 技能编号 | 我方 1/2/3 位从者的技能 1–3 → **1–9**；御主礼装技能 → **10–12** |
| 我方单体目标 | 标签里带对象：`[技能号, 我方位次]` |
| 敌方单体目标 | **不挂在技能上**。先确保当前选中敌人正确，必要时插入 `[13, 敌方位次]`，再写技能号 |
| 无目标技能 | 只写技能号 |
| 敌方位次 | 关卡数据里的 `deckId`（1/2/3），允许跳号（例如某波只有 2、3 号位） |
| 未写目标时 | 落到该波**第一个非空站位** |
| 存档版本 | 每份队伍自带 `minBuild`/`appBuild`，超出验证过的范围（目前 992）只标「未验证」，不拦 |
| 宝具 | `roundN_turn0_np` 数组，按释放顺序写位次 |
| 波次 | 关卡数据的 stage；当前假设一波一回合 |
| 技能选项 | `-技能号` 表示该技能选**第 2 个选项**（相当于 `-5`） |
| skillsLevel | 按模板填 `[10,10,10,0,0,0,0,0]`，不参与转换 |

## 已知限制

1. **一面多回合**：按「一回合 = 一面」处理（`round{N}_turns = 1`）。多出来的回合由 BB 自己兜底，本工具不生成那部分。
2. **敌人退场后的目标**：靠每回合重发 `[13, 站位]` 兜底；记录里没有血量，判断不出谁先死。
3. **少数从者的选项**：这类从者的技能要额外带一个选项值，而队伍存档里没有记录这个选择，转换时按占位写并给出警告，需要人工确认。
4. **洗牌类从者**（岸波白野）：洗牌结果随机，按用户设定的次数生成「没洗到就再洗」的条件块，不保证一定洗到。
5. **分享短链（`?id=`）**：不支持。那要访问 Chaldea 自己的服务器，本工具不代理解析。

## 目录

```
app/                    独立窗口（Neutralino 工程）
  neutralino.config.json
  bin/                  运行时（不带进仓库）
  resources/            界面与转换核心
    index.html app.js
    js/convert.js       转换规则（纯函数，不碰文件系统）
    js/link.js          分享链接解析
    js/bridge.js        两套后端：浏览器走 fetch，窗口走 Neutralino 文件 API
    js/bundle.js        esbuild 产物（不带进仓库）
    img/                使用指引截图
src/chaldea2bb.mjs      命令行入口
src/node-data.mjs       Node 侧数据加载
server.mjs              本地服务（浏览器调试模式）
examples/               参考用的 BB 脚本
LICENSE                  MIT
NOTICE.md                第三方组件与来源声明
start.cmd               构建 + 同步到桌面 + 启动
dev-browser.cmd         浏览器调试模式
```

## 说明与边界

- 只做**格式转换**：读 Chaldea 的存档和 BBchannel 的资源表，产出 BBchannel 的脚本 JSON；不注入进程、不读内存、不模拟点击。
- 只读本地文件，**不联网**（`?id=` 短链需要访问 Chaldea 服务器，本工具明确不代理解析）。
- 与 Chaldea、BBchannel、Atlas Academy 的作者**均无隶属关系，也未获其背书或授权**。
- 本仓库**不包含**这三者的任何程序或资源：Chaldea 与 BBchannel 只在你自己机器上被读取，运行时二进制来自 Neutralinojs 官方发行包。
- 说明文档里的游戏画面与从者立绘，版权归 FGO／TYPE-MOON 等权利人所有，这里只作操作说明使用；如需移除请告知。
- 本项目自身代码以 **MIT** 发布（见 [LICENSE](LICENSE)）；第三方组件的许可与「不包含什么」写在 [NOTICE.md](NOTICE.md)。
