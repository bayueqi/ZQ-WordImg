# 🧠 ZQ-AiTool

一个功能强大的All-in-One AI工具箱，集成了聊天、语音处理和图像生成功能，完全基于Cloudflare Workers实现。

## ✨ 功能特性

### 💬 AiChat - 智能对话
- 支持Cloudflare Workers AI和外部API双模式
- 流式响应，实时展示AI输出
- 支持多种模型配置
- 可自定义系统提示词
- 完整的聊天历史记录（自动保存近30天）
- 配置持久化到KV存储

### 🎤 VoiceCraft - 语音处理
**文本转语音 (TTS)**
- 支持20+种语音选择
- 可调节语速、音调、音量
- 多种语音风格（普通、温柔、活泼等）
- 支持文本输入和文件上传
- 智能文本分块，支持长文本处理

**语音转文本 (STT)**
- 支持多种音频格式（mp3, wav, m4a, flac, aac, ogg, webm, amr, 3gp）
- 拖拽上传，简单快捷
- 一键复制转录结果

### 🎨 WordImg - 图像生成
- 支持多种图像生成模型（Stable Diffusion、Flux等）
- 支持img2img图像生成
- 支持inpainting图像编辑
- 可调节图片尺寸、步数、提示词强度等参数
- 提供随机提示词功能
- 一键下载所有图片为压缩包

## 🚀 部署指南

### 前置准备
1. 创建Cloudflare KV命名空间
   - 登录[Cloudflare Dashboard](https://dash.cloudflare.com)
   - 进入"Workers & Pages" -> "KV"
   - 点击"Create a namespace"，命名为`AiTool`
   - 复制命名空间ID

### Cloudflare Workers 部署

1. 准备`_worker.js`文件
2. 登录[Cloudflare Dashboard](https://dash.cloudflare.com)
3. 进入"Workers & Pages" -> "Create application"
4. 选择"Create Worker"
5. 将`_worker.js`的内容复制到编辑器中
6. 点击"Save and Deploy"
7. 配置绑定：
   - **AI绑定**：在Worker设置中，找到"Variables" -> "AI"，点击"Add Binding"，命名为`AI`
   - **KV绑定**：在"Variables" -> "KV"，点击"Add Binding"，命名为`AiTool`，选择你创建的KV命名空间
   - **密码绑定**：在"Variables" -> "Environment Variables"，点击"Add variable"，命名为`PASSWORD`，设置您的访问密码

### 配置说明

#### Workers AI 配置
- 确保在Worker设置中绑定了AI模型
- 模型列表会根据您的Cloudflare AI服务可用模型自动加载

#### 外部 API 配置
- 在聊天设置中切换到"外部 API"模式
- 填写API地址（如：https://api.deepseek.com/v1/chat/completions）
- 填写API Key
- 填写模型名称（如：deepseek-chat）
- 点击"保存配置"按钮保存到KV存储

#### 配置持久化
- 点击"加载配置"从KV中恢复保存的配置
- 点击"保存配置"将当前配置保存到KV
- 配置包括：API模式、模型选择、API地址、API Key、系统提示词等

## 📖 使用说明

### 对话 使用
1. 在侧边栏选择"对话"工具
2. 首次使用建议点击"加载配置"恢复之前的设置
3. 根据需要切换API模式（Workers AI或外部API）
4. 配置模型和系统提示词（可选）
5. 在输入框中输入问题，按回车或点击发送
6. 等待AI响应，支持流式展示
7. 对话会自动保存到历史记录，可在侧边栏查看和管理

### 文图转换 使用
1. 在侧边栏选择"文图转换"工具
2. 选择图像生成模型
3. 输入提示词
4. 配置图片参数（尺寸、步数、提示词强度、生成数量、随机种子等）
5. 点击"生成图片"
6. 等待生成完成后，可查看、单独下载或点击"下载全部"打包下载所有图片

### 文字语音转换 使用

#### 文字转语音
1. 在侧边栏选择"文字语音转换"工具
2. 直接输入文本或切换到"文件"标签上传txt文件
3. 配置语音参数（语音、语速、音调、风格）
4. 点击"生成语音"
5. 等待生成完成后，可播放或下载音频

#### 语音转文字
1. 点击或拖拽上传音频文件
2. 点击"开始转录"
3. 等待转录完成后，可查看、复制结果


## 🛠️ 技术栈

- **后端**: Cloudflare Workers
- **AI模型**: Cloudflare Workers AI + 外部API
- **数据存储**: Cloudflare KV
- **语音合成**: Microsoft Edge TTS
- **语音识别**: 可配置外部API
- **前端**: 原生HTML/CSS/JavaScript
- **压缩库**: JSZip

## 📝 注意事项

1. **Workers AI 配额**: 注意Cloudflare Workers AI的使用配额限制
2. **外部API Key**: 妥善保管您的API Key，虽然配置保存在KV中，但不要分享您的Worker给他人
3. **KV存储**: KV存储有免费额度限制，对话历史会自动清理30天前的记录
4. **文件大小限制**: 
   - TTS支持最大500KB的txt文件
   - STT支持最大10MB的音频文件
5. **长文本处理**: TTS会自动将长文本分块处理


