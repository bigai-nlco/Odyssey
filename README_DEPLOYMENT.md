# GitHub Pages 部署说明

## 问题：404 Not Found

当前 GitHub Actions 部署失败，因为 GitHub Pages 还未启用。

## 解决方案

### 方法 1：手动启用 GitHub Pages（推荐）

1. 访问仓库设置页面：
   https://github.com/bigai-nlco/Odyssey/settings/pages

2. 在 "Build and deployment" 部分：
   - **Source**: 选择 `GitHub Actions`
   - 保存

3. 重新运行失败的工作流：
   - 访问 https://github.com/bigai-nlco/Odyssey/actions
   - 点击失败的工作流
   - 点击右上角的 "Re-run all jobs"

### 方法 2：使用 gh-pages 分支（备选）

如果上面的方法不行，可以改用传统的 gh-pages 分支部署：

```bash
cd ~/Desktop/Odyssey

# 安装 gh-pages 工具
npm install --save-dev gh-pages

# 部署到 gh-pages 分支
npx gh-pages -d dist
```

然后在仓库设置中选择 `Deploy from a branch`，分支选择 `gh-pages`，目录选择 `/ (root)`。

## 预期结果

完成后，博客将在以下地址访问：
https://bigai-nlco.github.io/Odyssey
