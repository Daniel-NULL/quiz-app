# Quiz Assistant · 通用交互式刷题器

一个**通用**的交互式刷题网页：任何学习资料只要转成题库 JSON，就能一键接入成为新题库。
支持电脑与手机访问，深色模式，进度本地保存 + 跨设备同步。

在线访问：https://daniel-null.github.io/quiz-app/

当前已接入题库：

| 题库 | 题数 |
|------|------|
| 安全测试-学习资料（大学物理实验课程） | 60 |

---

## 一、给使用者（人）

### 功能

- 判断题 / 单选题 / 多选题刷题，点击选项自动判分
- 进度保存在浏览器本地（localStorage），错题自动进入错题集
- 错题回顾模式、重置进度
- 进度导出 / 导入，实现电脑与手机跨设备同步
- 题目错误反馈（跳转 GitHub Issues）
- 响应式布局 + 深色模式，手机端友好

### 本地运行

```powershell
python -m http.server 8765 --directory quiz-web
# 浏览器打开 http://localhost:8765
```

---

## 二、给 Agent：如何把一份新学习资料接入成新题库（接入指南）

> 本节是**面向 Agent 的操作说明**（不是给最终用户看的）。
> 用户说"把这份资料做成刷题器"时，按下面的流程完整走一遍：
> **解析 → 生成 JSON → 注册 → 本地验证 → 推送部署**。每一步都有验收标准，不要跳步。

### 第 0 步：读原始材料，确定题型结构

先完整读取源文件（PDF / Word / TXT / 图片）。确认三件事：

1. 包含哪些题型（判断题 / 单选 / 多选 / 填空）
2. 题目排版格式（题号长什么样、选项长什么样、答案和题型是否标出）
3. 题量（用于后续校验）

### 第 1 步：把源文件提取为纯文本

PDF 用 pdfplumber 提取（Windows 本机已装 Python）：

```powershell
python -c "import pdfplumber; [print(f'===PAGE {i+1}===\n' + (p.extract_text() or '')) for i, p in enumerate(pdfplumber.open('源文件.pdf').pages)]" > pdf_text_raw.txt
```

- 提取后**必须 Read 一遍原始文本**，确认题号、选项、答案都在且没丢字。
- 如果 PDF 是扫描件（提取为空），先 OCR 再继续；不要跳过这一步直接造 JSON。

### 第 2 步：生成题库 JSON

参考实现脚本在 `tools/parse_quiz.py`，它针对"题号 + 题干 + 选项 + 答案 + 题型"格式：

```powershell
python tools/parse_quiz.py <题目txt> banks\<新题库id>\questions.json --source "题库显示名"
```

**注意**：不同资料的排版不同，必须按实际格式调整脚本里的正则（`NUM_RE` / `OPT_RE` / `ANS_RE` / `TYPE_RE` 以及切块逻辑），改完先跑通再入库。脚本输出校验报告：

- 题号连续、无缺题干 / 缺选项 / 缺答案
- 题型分布、选项数分布、答案分布（用于人工抽检合理性）

**验收标准**：校验报告"问题：无"，且解析题数与第 0 步确认的题量一致。有任何一个校验问题都不得强行入库。

### 第 3 步：注册题库

把新题库目录放进 `banks/`，并在 `banks/index.json` 的 `banks` 数组追加一条：

```json
{
  "id": "新题库id（小写英文+连字符，如 lab-safety）",
  "name": "主页卡片显示名（如 实验室安全-学习资料）",
  "count": 60,
  "questionsPath": "banks/<新题库id>/questions.json",
  "sourcePdfPath": "原PDF文件名.pdf"
}
```

- `sourcePdfPath` 存在原 PDF 时，把它拷到 `quiz-web/` 根目录，主页题库卡片会出现"下载原题库（PDF）"入口。
- 没有 PDF 就删掉这个字段。

### 第 4 步：本地验证（必须）

启动本地服务器，用真实浏览器过一遍全流程：

```powershell
python -m http.server 8765 --directory quiz-web
```

验证清单（每项都要过）：

1. 主页能看到新题库卡片，进度为 0%
2. 进入刷题：题干、选项完整无乱码
3. 答对一题：显示绿色正确反馈，进度 +1
4. 答错一题：显示红色错误反馈，错题徽标 +1
5. 错题回顾模式：能看到刚才的错题
6. 导出进度文本 → 重置 → 导入进度，进度恢复
7. 手机视口（390px 宽）下布局正常、按钮可点

### 第 5 步：部署（GitHub Pages 自动构建）

```powershell
cd quiz-web
git add -A
git commit -m "接入新题库：<题库名>（<题数>题）"
git push origin master
```

等待约 1-2 分钟 Pages 重建，然后访问线上地址验证新题库可正常刷题。

> 仓库：`Daniel-NULL/quiz-app`（master 分支，Pages 已配置为自动部署）。

---

## 三、题库数据格式（JSON Schema）

`banks/<bank-id>/questions.json`：

```json
{
  "meta": { "source": "题库来源说明", "total": 60 },
  "questions": [
    {
      "id": "q1",
      "type": "single",
      "stem": "题干内容",
      "options": { "A": "选项一", "B": "选项二", "C": "选项三", "D": "选项四" },
      "answer": "A"
    }
  ]
}
```

字段说明：

| 字段 | 必填 | 说明 |
|------|------|------|
| `meta.source` | 是 | 题库来源说明，显示在刷题页顶部 |
| `meta.total` | 是 | 题数，须与实际题目数一致 |
| `id` | 是 | 题号，建议 `q1`、`q2`… 全局唯一 |
| `type` | 是 | `judge` 判断题 / `single` 单选 / `multiple` 多选 / `blank` 填空 |
| `stem` | 是 | 题干，可含换行 |
| `options` | 是 | 选项字典；判断题 `{"A":"对","B":"错"}`；填空题可传 `{}` |
| `answer` | 是 | 正确答案；判断题/单选填字母（如 `"A"`），多选填多个字母（如 `"ACD"`） |

### 前端渲染逻辑（Agent 要知道的约定）

- 判断题 = 两个选项的 `judge` 题，前端按 `type` 渲染，选项键固定 `A`/`B`。
- 多选题点选后可"确认答案"，其余题型点选项即判分。
- `answer` 大小写不敏感；多选答案内部会排序比较。
- 题目支持 `explanation` 字段（可选），有则显示在判分结果下方。

---

## 四、项目结构

```
quiz-web/
├── index.html                 页面结构（标题 Quiz Assistant）
├── styles.css                 样式：深色主题，正文宋体，标题衬线
├── app.js                     交互逻辑（通用，不依赖具体题库）
├── README.md                  本文档
├── tools/
│   └── parse_quiz.py          题库生成参考脚本（面向 Agent）
├── 安全测试-学习资料.pdf         示例题库原 PDF（可下载）
└── banks/
    ├── index.json             题库索引（接入新题库要改这里）
    └── safety-test/
        └── questions.json     题库数据（60 题）
```

## 五、设计约定（改 UI 时遵守）

- 深色模式为主（用户 iPhone 常开深色），不提供浅色切换。
- **学习内容区域（题干、选项、进度、题库卡片内文字）一律使用正常宋体**（`Songti SC / STSong / SimSun`），不得使用花体、衬线装饰字体。
- 设计感字体（Georgia 衬线）只用于标题等题目之外的品牌元素。
- 界面克制，不做动画特效、装饰插画等娱乐元素。
