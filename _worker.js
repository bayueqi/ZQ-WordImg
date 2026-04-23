// --- Constants ---
const DEFAULT_CHAT_MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8';
const DEFAULT_SYSTEM_PROMPT = '你是一个乐于助人、友好的助手。请提供简洁准确的回应。';
const TOKEN_REFRESH_BEFORE_EXPIRY = 3 * 60;
let tokenInfo = {
    endpoint: null,
    token: null,
    expiredAt: null
};

// Image Generation Models
const AVAILABLE_MODELS = [
  { id: 'stable-diffusion-xl-base-1.0', name: 'Stable Diffusion XL Base 1.0', description: 'Stability AI SDXL 文生图模型', key: '@cf/stabilityai/stable-diffusion-xl-base-1.0', requiresImage: false },
  { id: 'flux-1-schnell', name: 'FLUX.1 [schnell]', description: '精确细节表现的高性能文生图模型', key: '@cf/black-forest-labs/flux-1-schnell', requiresImage: false },
  { id: 'dreamshaper-8-lcm', name: 'DreamShaper 8 LCM', description: '增强图像真实感的 SD 微调模型', key: '@cf/lykon/dreamshaper-8-lcm', requiresImage: false },
  { id: 'stable-diffusion-xl-lightning', name: 'Stable Diffusion XL Lightning', description: '更加高效的文生图模型', key: '@cf/bytedance/stable-diffusion-xl-lightning', requiresImage: false },
  { id: 'stable-diffusion-v1-5-img2img', name: 'Stable Diffusion v1.5 图生图', description: '将输入图像风格化或变换（需要提供图像URL）', key: '@cf/runwayml/stable-diffusion-v1-5-img2img', requiresImage: true },
  { id: 'stable-diffusion-v1-5-inpainting', name: 'Stable Diffusion v1.5 局部重绘', description: '根据遮罩对局部区域进行重绘（需要图像URL，可选遮罩URL）', key: '@cf/runwayml/stable-diffusion-v1-5-inpainting', requiresImage: true, requiresMask: true }
];

// Random Prompts for Image Generation
const RANDOM_PROMPTS = [
  '赛博朋克风城市夜景，霓虹灯雨夜街道，反光地面，强烈对比度，广角镜头，电影感',
  '清晨森林小径，阳光穿过树叶薄雾弥漫，柔和光线，高饱和度，超清细节',
  '水墨山水，远山近水小桥人家，留白构图，国画风格，淡雅色调',
  '可爱橘猫坐在窗台，落日与晚霞，暖色调，浅景深，柔焦',
  '科幻机甲战士，蓝色能量核心，强烈光影，硬边金属质感，战损细节',
  '复古胶片风人像，暖色调，轻微颗粒，高光溢出，自然肤色，50mm',
  '海边灯塔与星空，银河拱桥，长曝光，拍岸浪花，清冷色调',
  '蒸汽朋克飞船穿越云层，黄铜齿轮与管道，体积光，戏剧化天空',
  '古风少女立于竹林，微风拂过衣袂，侧光，国风写意，细腻材质',
  '极光下雪原与麋鹿，宁静辽阔，低饱和度，广角远景，细腻噪点控制',
];

// --- Helper Functions ---
const looksEnglish = (text) => {
  if (!text) return true;
  if (/[^\x00-\x7F]/.test(text)) return false;
  return true;
};

async function translateToEnglishIfNeeded(text, env) {
  try {
    if (!text || looksEnglish(text)) return text;
    const model = (env && env.AI_TRANSLATE_MODEL) || '@cf/meta/llama-3.1-8b-instruct';
    if (!env || !env.AI || typeof env.AI.run !== 'function') return text;
    const system = 'You are a professional translator. Translate the user text into natural, concise English. Output English translation only, no quotes, no explanations.';
    const user = `Translate into English:\n${text}`;
    const res = await env.AI.run(model, {
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.2,
    });
    if (res && typeof res === 'object') {
      const out = res.response || res.text || res.output || '';
      if (typeof out === 'string' && out.trim()) return out.trim();
      if (Array.isArray(res.choices) && res.choices[0] && res.choices[0].message && res.choices[0].message.content) {
        const alt = String(res.choices[0].message.content || '').trim();
        if (alt) return alt;
      }
    } else if (typeof res === 'string' && res.trim()) {
      return res.trim();
    }
  } catch (_) {}
  return text;
}

function consumeSseEvents(buffer) {
  let normalized = buffer.replace(/\r/g, '');
  const events = [];
  let eventEndIndex;
  while ((eventEndIndex = normalized.indexOf('\n\n')) !== -1) {
    const rawEvent = normalized.slice(0, eventEndIndex);
    normalized = normalized.slice(eventEndIndex + 2);
    const lines = rawEvent.split('\n');
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).trimStart());
      }
    }
    if (dataLines.length === 0) continue;
    events.push(dataLines.join('\n'));
  }
  return { events, buffer: normalized };
}

// --- External API Call ---
async function callExternalApi(apiUrl, apiKey, model, messages) {
  const requestBody = {
    model: model,
    messages: messages,
    stream: true,
    max_tokens: 1024
  };
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody)
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`外部API请求失败: ${response.status} - ${errorText}`);
  }
  return response.body;
}

// --- HTML Template ---
const HTML_CONTENT = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ZQ-AiTool</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3C%3Fxml%20version%3D%221.0%22%20standalone%3D%22no%22%3F%3E%3C!DOCTYPE%20svg%20PUBLIC%20%22-%2F%2FW3C%2F%2FDTD%20SVG%201.1%2F%2FEN%22%20%22http%3A%2F%2Fwww.w3.org%2FGraphics%2FSVG%2F1.1%2FDTD%2Fsvg11.dtd%22%3E%3Csvg%20t%3D%221776951849314%22%20class%3D%22icon%22%20viewBox%3D%220%200%201024%201024%22%20version%3D%221.1%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20p-id%3D%225342%22%20xmlns%3Axlink%3D%22http%3A%2F%2Fwww.w3.org%2F1999%2Fxlink%22%20width%3D%22200%22%20height%3D%22200%22%3E%3Cpath%20d%3D%22M511.994264%20511.994264m-511.994264%200a511.994264%20511.994264%200%201%200%201023.988529%200%20511.994264%20511.994264%200%201%200-1023.988529%200Z%22%20fill%3D%22%2328176D%22%20p-id%3D%225343%22%3E%3C%2Fpath%3E%3Cpath%20d%3D%22M769.87841%20652.183853h-53.444341V522.260992h53.444341zM789.528583%20522.260992h-19.650173v129.922861h84.898383V522.260992h-65.24821z%22%20fill%3D%22%23F8C642%22%20p-id%3D%225344%22%3E%3C%2Fpath%3E%3Cpath%20d%3D%22M772.012054%20782.095242h-55.577985V652.172382H772.012054z%22%20fill%3D%22%23F8C642%22%20p-id%3D%225345%22%3E%3C%2Fpath%3E%3Cpath%20d%3D%22M842.777913%20782.095242h-72.910974V652.183853h84.886912v117.923981a11.99888%2011.99888%200%200%201-11.975938%2011.987408z%22%20fill%3D%22%237B49B6%22%20p-id%3D%225346%22%3E%3C%2Fpath%3E%3Cpath%20d%3D%22M836.571992%20522.260992H716.434069V392.338132h120.137923z%22%20fill%3D%22%23FC3A64%22%20p-id%3D%225347%22%3E%3C%2Fpath%3E%3Cpath%20d%3D%22M854.776793%20522.260992h-65.24821V392.338132h65.24821z%22%20fill%3D%22%23FFFFFF%22%20p-id%3D%225348%22%3E%3C%2Fpath%3E%3Cpath%20d%3D%22M348.518131%20692.73456l-20.18932%2088.95919H169.211736l126.951818-522.14628h224.124391l120.447646%20522.157751H483.316253l-20.533455-88.959189z%20M376.565226%20570.24504h58.170477l-28.735367-127.640091z%22%20fill%3D%22%23F8C642%22%20p-id%3D%225349%22%3E%3C%2Fpath%3E%3Cpath%20d%3D%22M296.163554%20259.54747l-22.896524%2094.190059H542.014406l-21.726461-94.190059H296.163554z%22%20fill%3D%22%237B49B6%22%20p-id%3D%225350%22%3E%3C%2Fpath%3E%3Cpath%20d%3D%22M220.625674%20570.24504h214.1215l28.047095%20122.48952H190.846427l29.779247-122.48952z%22%20fill%3D%22%23FC3A64%22%20p-id%3D%225351%22%3E%3C%2Fpath%3E%3Cpath%20d%3D%22M406.000336%20442.604949h156.513112l29.435111%20127.640091H434.747174l-28.746838-127.640091z%22%20fill%3D%22%23FFFFFF%22%20p-id%3D%225352%22%3E%3C%2Fpath%3E%3Cpath%20d%3D%22M718.556241%20241.893286h134.098379v47.61697H718.556241z%22%20fill%3D%22%23FC3A64%22%20p-id%3D%225353%22%3E%3C%2Fpath%3E%3Cpath%20d%3D%22M718.556241%20288.087826h134.098379v47.61697H718.556241z%22%20fill%3D%22%23FC3A64%22%20p-id%3D%225354%22%3E%3C%2Fpath%3E%3C%2Fsvg%3E">
    <style>
        :root {
            --primary-color: #4361ee;
            --primary-hover: #3a0ca3;
            --secondary-color: #64748b;
            --success-color: #059669;
            --warning-color: #d97706;
            --error-color: #dc2626;
            --background-color: #f8fafc;
            --surface-color: #ffffff;
            --text-primary: #0f172a;
            --text-secondary: #475569;
            --border-color: #e2e8f0;
            --border-focus: #3b82f6;
            --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
            --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1);
            --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1);
            --radius-sm: 6px;
            --radius-md: 8px;
            --radius-lg: 12px;
            --radius-xl: 16px;
            --user-msg-bg: #e3f2fd;
            --assistant-msg-bg: #f8f9fa;
            --gradient-bg: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
        }
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Microsoft YaHei", sans-serif;
            background: var(--gradient-bg);
            color: var(--text-primary);
            line-height: 1.6;
            min-height: 100vh;
            display: flex;
            overflow: hidden;
        }
        /* App Container */
        .app-container {
            display: flex;
            width: 100vw;
            height: 100vh;
            overflow: hidden;
        }
        /* Header */
        .header {
            background: var(--surface-color);
            border-radius: var(--radius-xl);
            box-shadow: var(--shadow-lg);
            padding: 12px 16px;
            text-align: center;
            margin-bottom: 12px;
            border: 1px solid var(--border-color);
        }
        .header h1 {
            font-size: 1.4rem;
            font-weight: 700;
            color: var(--primary-color);
            margin: 0;
        }
        .header p {
            display: none;
        }
        /* Sidebar */
        .sidebar {
            width: 320px;
            height: 100vh;
            background-color: var(--surface-color);
            box-shadow: 2px 0 10px rgba(0, 0, 0, 0.1);
            transition: all 0.3s ease;
            overflow-y: auto;
            padding: 20px;
            z-index: 100;
        }
        .sidebar.collapsed {
            width: 0;
            padding: 0;
            overflow: hidden;
        }
        .sidebar-toggle {
            position: absolute;
            left: 300px;
            top: 20px;
            width: 40px;
            height: 40px;
            background-color: var(--primary-color);
            color: white;
            border: none;
            border-radius: 50%;
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
            z-index: 101;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.2rem;
            transition: all 0.3s ease;
        }
        .sidebar-toggle:hover {
            background-color: var(--primary-hover);
            transform: scale(1.05);
        }
        .sidebar.collapsed + .sidebar-toggle {
            left: 10px;
        }
        /* Tool Selector */
        .tool-selector {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-bottom: 12px;
        }
        .tool-btn {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 14px 16px;
            border: 2px solid var(--border-color);
            border-radius: var(--radius-lg);
            background: var(--surface-color);
            color: var(--text-secondary);
            cursor: pointer;
            font-weight: 600;
            transition: all 0.3s ease;
            font-size: 0.95rem;
        }
        .tool-btn:hover {
            border-color: var(--primary-color);
            color: var(--primary-color);
            transform: translateY(-1px);
        }
        .tool-btn.active {
            background: var(--primary-color);
            color: white;
            border-color: var(--primary-color);
            box-shadow: var(--shadow-md);
        }
        .tool-btn .tool-icon {
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        /* Settings */
        .settings-container {
            display: flex;
            flex-direction: column;
            gap: 16px;
        }
        .setting-group {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .setting-group label {
            font-size: 0.9rem;
            color: var(--text-primary);
            font-weight: 600;
        }
        .form-input, .form-select, .form-textarea {
            width: 100%;
            padding: 10px 14px;
            border: 1px solid var(--border-color);
            border-radius: var(--radius-md);
            font-size: 0.95rem;
            color: var(--text-primary);
            background: var(--surface-color);
            transition: all 0.2s ease;
            font-family: inherit;
        }
        .form-input:focus, .form-select:focus, .form-textarea:focus {
            outline: none;
            border-color: var(--border-focus);
            box-shadow: 0 0 0 3px rgb(59 130 246 / 0.1);
        }
        .form-textarea {
            resize: vertical;
            min-height: 80px;
        }
        .api-mode-selector {
            display: flex;
            gap: 8px;
            margin-bottom: 8px;
        }
        .api-mode-btn {
            flex: 1;
            padding: 10px 12px;
            border: 2px solid var(--border-color);
            border-radius: var(--radius-md);
            background: white;
            cursor: pointer;
            font-weight: 500;
            transition: all 0.3s ease;
            font-size: 0.85rem;
        }
        .api-mode-btn:hover {
            border-color: var(--primary-color);
        }
        .api-mode-btn.active {
            background: var(--primary-color);
            color: white;
            border-color: var(--primary-color);
        }
        .workers-settings {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .workers-settings.hidden {
            display: none;
        }
        .external-api-settings {
            display: none;
            flex-direction: column;
            gap: 12px;
            padding-top: 8px;
        }
        .external-api-settings.visible {
            display: flex;
        }
        .model-link {
            padding: 10px 14px;
            background-color: var(--primary-color);
            color: white;
            border: none;
            border-radius: var(--radius-md);
            text-decoration: none;
            font-size: 0.9rem;
            font-weight: 500;
            transition: all 0.3s ease;
            text-align: center;
            display: block;
        }
        .model-link:hover {
            background-color: var(--primary-hover);
            transform: translateY(-1px);
        }
        /* Main Content */
        .main-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            height: 100vh;
            padding: 20px;
            overflow: hidden;
        }
        /* Tool Panels */
        .tool-panel {
            display: none;
            flex-direction: column;
            height: 100%;
        }
        .tool-panel.active {
            display: flex;
        }
        /* Chat Panel */
        .chat-container {
            display: flex;
            flex-direction: column;
            height: 100%;
            border: 1px solid var(--border-color);
            border-radius: var(--radius-xl);
            overflow: hidden;
            background-color: var(--surface-color);
            box-shadow: var(--shadow-lg);
        }
        .chat-messages {
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
            padding: 20px;
            background-color: #f9f9f9;
            -webkit-overflow-scrolling: touch;
        }
        .chat-messages::-webkit-scrollbar {
            width: 8px;
        }
        .chat-messages::-webkit-scrollbar-track {
            background: #f1f1f1;
            border-radius: 4px;
        }
        .chat-messages::-webkit-scrollbar-thumb {
            background: #c1c1c1;
            border-radius: 4px;
        }
        .message {
            margin-bottom: 16px;
            padding: 14px 18px;
            border-radius: 16px;
            max-width: 75%;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
            animation: fadeIn 0.3s ease;
            word-break: break-word;
            overflow-wrap: break-word;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .message p {
            white-space: pre-wrap;
            margin: 0;
            word-break: break-word;
            overflow-wrap: break-word;
        }
        .user-message {
            background-color: var(--user-msg-bg);
            align-self: flex-end;
            margin-left: auto;
            border-bottom-right-radius: 6px;
        }
        .assistant-message {
            background-color: var(--assistant-msg-bg);
            align-self: flex-start;
            border-bottom-left-radius: 6px;
        }
        .message-input {
            display: flex;
            padding: 16px 20px;
            border-top: 1px solid var(--border-color);
            background-color: var(--surface-color);
            gap: 12px;
            align-items: flex-end;
        }
        #user-input {
            flex: 1;
            padding: 12px 16px;
            border: 1px solid var(--border-color);
            border-radius: 12px;
            font-family: inherit;
            resize: none;
            min-height: 50px;
            max-height: 200px;
            transition: all 0.3s ease;
            background-color: #f9f9f9;
            font-size: 0.95rem;
        }
        #user-input:focus {
            outline: none;
            border-color: var(--primary-color);
            box-shadow: 0 0 0 3px rgba(67, 97, 238, 0.1);
            background-color: white;
        }
        #send-button {
            padding: 0 24px;
            background-color: var(--primary-color);
            color: white;
            border: none;
            border-radius: 12px;
            cursor: pointer;
            transition: all 0.3s ease;
            font-weight: 600;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 50px;
            font-size: 1rem;
        }
        #send-button:hover {
            background-color: var(--primary-hover);
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(67, 97, 238, 0.4);
        }
        #send-button:disabled {
            background-color: var(--text-secondary);
            cursor: not-allowed;
            transform: none;
            box-shadow: none;
        }
        .typing-indicator {
            display: none;
            font-style: italic;
            color: var(--text-secondary);
            padding: 12px 20px;
            background-color: var(--background-color);
            border-top: 1px solid var(--border-color);
        }
        .typing-indicator.visible {
            display: block;
            animation: pulse 1.5s infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.6; }
        }
        /* Voice Panel */
        .voice-container {
            background: var(--surface-color);
            border-radius: var(--radius-xl);
            box-shadow: var(--shadow-lg);
            border: 1px solid var(--border-color);
            overflow: hidden;
            padding: 20px;
            height: 100%;
            overflow-y: auto;
            overflow-x: hidden;
            -webkit-overflow-scrolling: touch;
        }
        .voice-mode-switcher {
            display: flex;
            gap: 12px;
            margin-bottom: 20px;
        }
        .voice-mode-btn {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 12px 20px;
            border: 2px solid var(--border-color);
            background: var(--surface-color);
            color: var(--text-secondary);
            border-radius: var(--radius-lg);
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
        }
        .voice-mode-btn:hover {
            border-color: var(--primary-color);
            color: var(--primary-color);
        }
        .voice-mode-btn.active {
            background: var(--primary-color);
            color: white;
            border-color: var(--primary-color);
        }
        .voice-subpanel {
            display: none;
        }
        .voice-subpanel.active {
            display: block;
        }
        .controls-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
            margin-bottom: 20px;
        }
        .btn-primary {
            width: 100%;
            background: var(--primary-color);
            color: white;
            border: none;
            padding: 14px 28px;
            font-size: 1rem;
            font-weight: 600;
            border-radius: var(--radius-md);
            cursor: pointer;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }
        .btn-primary:hover:not(:disabled) {
            background: var(--primary-hover);
            transform: translateY(-1px);
            box-shadow: var(--shadow-md);
        }
        .btn-primary:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }
        .result-container {
            margin-top: 20px;
            padding: 16px;
            background: var(--background-color);
            border-radius: var(--radius-lg);
            border: 1px solid var(--border-color);
        }
        .audio-player {
            width: 100%;
            margin-bottom: 12px;
            border-radius: var(--radius-md);
        }
        .loading-container {
            text-align: center;
            padding: 20px;
        }
        .loading-spinner {
            width: 40px;
            height: 40px;
            border: 3px solid var(--border-color);
            border-top: 3px solid var(--primary-color);
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 12px;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        .input-method-tabs {
            display: flex;
            gap: 4px;
            margin-bottom: 16px;
            background: var(--background-color);
            padding: 4px;
            border-radius: var(--radius-lg);
            border: 1px solid var(--border-color);
        }
        .tab-btn {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 10px 14px;
            border: none;
            background: transparent;
            color: var(--text-secondary);
            border-radius: var(--radius-md);
            font-size: 0.85rem;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.3s ease;
        }
        .tab-btn:hover {
            color: var(--primary-color);
            background: rgba(37, 99, 235, 0.05);
        }
        .tab-btn.active {
            background: var(--primary-color);
            color: white;
            box-shadow: var(--shadow-sm);
        }
        .file-drop-zone {
            border: 2px dashed var(--border-color);
            border-radius: var(--radius-lg);
            padding: 40px 20px;
            text-align: center;
            cursor: pointer;
            transition: all 0.3s ease;
            background: var(--background-color);
        }
        .file-drop-zone:hover, .file-drop-zone.dragover {
            border-color: var(--primary-color);
            background: rgba(67, 97, 238, 0.05);
        }
        .file-info {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px;
            background: var(--surface-color);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-lg);
            margin-top: 12px;
        }
        .file-remove-btn {
            width: 30px;
            height: 30px;
            border: none;
            background: var(--error-color);
            color: white;
            border-radius: var(--radius-md);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.8rem;
            font-weight: 600;
        }
        /* Image Panel */
        .image-container {
            background: var(--surface-color);
            border-radius: var(--radius-xl);
            box-shadow: var(--shadow-lg);
            border: 1px solid var(--border-color);
            overflow: hidden;
            padding: 20px;
            height: 100%;
            overflow-y: auto;
            overflow-x: hidden;
            -webkit-overflow-scrolling: touch;
        }
        .image-form {
            display: flex;
            flex-direction: column;
            gap: 16px;
        }
        .random-prompt-btn {
            padding: 8px 16px;
            background: var(--success-color);
            color: white;
            border: none;
            border-radius: var(--radius-md);
            cursor: pointer;
            font-weight: 500;
            transition: all 0.3s ease;
            align-self: flex-start;
        }
        .random-prompt-btn:hover {
            background: #047857;
        }
        .image-result {
            margin-top: 24px;
            text-align: center;
        }
        .generated-image {
            max-width: 100%;
            border-radius: var(--radius-lg);
            box-shadow: var(--shadow-lg);
        }
        .image-info {
            margin-top: 12px;
            color: var(--text-secondary);
            font-size: 0.85rem;
        }
        .advanced-options-container {
            margin-top: 16px;
            background: var(--surface-color);
            border-radius: var(--radius-lg);
            overflow: hidden;
        }
        .advanced-options-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 14px 16px;
            cursor: pointer;
            user-select: none;
            font-weight: 600;
            color: var(--text-primary);
            background: linear-gradient(135deg, #f0f4ff 0%, #e8f0fe 100%);
            transition: all 0.3s ease;
        }
        .advanced-options-header:hover {
            background: linear-gradient(135deg, #e0e9ff 0%, #d7e3fd 100%);
        }
        .advanced-options-content {
            padding: 16px;
            border-top: 1px solid var(--border-color);
            max-height: 600px;
            overflow: hidden;
            transition: max-height 0.3s ease, padding 0.3s ease;
        }
        .advanced-options-content.collapsed {
            max-height: 0;
            padding-top: 0;
            padding-bottom: 0;
        }
        .slider-container {
            margin-bottom: 16px;
        }
        .slider-label {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
            font-size: 0.9rem;
            color: var(--text-primary);
            font-weight: 500;
        }
        .form-slider {
            width: 100%;
            height: 8px;
            border-radius: 4px;
            background: linear-gradient(90deg, #e0e7ff 0%, #c7d2fe 100%);
            outline: none;
            -webkit-appearance: none;
            appearance: none;
        }
        .form-slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 24px;
            height: 24px;
            border-radius: 50%;
            background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(79, 70, 229, 0.4);
            transition: all 0.2s ease;
        }
        .form-slider::-webkit-slider-thumb:hover {
            transform: scale(1.1);
            box-shadow: 0 4px 12px rgba(79, 70, 229, 0.5);
        }
        .form-slider::-moz-range-thumb {
            width: 24px;
            height: 24px;
            border-radius: 50%;
            background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
            cursor: pointer;
            border: none;
            box-shadow: 0 2px 8px rgba(79, 70, 229, 0.4);
            transition: all 0.2s ease;
        }
        .form-slider::-moz-range-thumb:hover {
            transform: scale(1.1);
            box-shadow: 0 4px 12px rgba(79, 70, 229, 0.5);
        }
        .btn-secondary {
            padding: 10px 16px;
            border-radius: var(--radius-md);
            background: var(--surface-color);
            border: 1px solid var(--border-color);
            color: var(--text-primary);
            cursor: pointer;
            font-weight: 500;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .btn-secondary:hover {
            background: var(--border-color);
            border-color: #94a3b8;
        }
        .image-gallery {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 12px;
            margin-bottom: 16px;
        }
        .gallery-item {
            position: relative;
            border-radius: var(--radius-lg);
            overflow: hidden;
            box-shadow: var(--shadow-md);
        }
        .gallery-item img {
            width: 100%;
            height: auto;
            display: block;
        }
        .gallery-item-overlay {
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            background: linear-gradient(transparent, rgba(0,0,0,0.6));
            padding: 12px 8px 8px;
            opacity: 0;
            transition: opacity 0.3s ease;
        }
        .gallery-item:hover .gallery-item-overlay {
            opacity: 1;
        }
        .gallery-download-btn {
            display: block;
            width: 100%;
            padding: 8px;
            background: #4f46e5;
            color: white;
            border: none;
            border-radius: var(--radius-md);
            cursor: pointer;
            font-weight: 500;
            text-align: center;
            text-decoration: none;
        }
        .gallery-download-btn:hover {
            background: #4338ca;
        }
        /* Responsive */
        @media (max-width: 768px) {
            .sidebar {
                position: fixed;
                left: -320px;
                top: 0;
                width: 300px;
                height: 100vh;
                box-shadow: 2px 0 10px rgba(0, 0, 0, 0.1);
                padding: 16px;
                padding-bottom: 100px;
                z-index: 1000;
                overflow-y: auto;
                -webkit-overflow-scrolling: touch;
            }
            .sidebar.collapsed {
                left: -320px;
            }
            .sidebar.open {
                left: 0;
            }
            .sidebar-toggle {
                position: fixed;
                left: 10px;
                top: 10px;
                margin: 0;
                width: 44px;
                height: 44px;
                z-index: 1001;
            }
            .sidebar.open + .sidebar-toggle {
                left: 310px;
            }
            .main-content {
                padding: 12px;
                padding-top: 64px;
                padding-bottom: 100px;
                height: 100vh;
                box-sizing: border-box;
            }
            .message {
                max-width: 85%;
                word-break: break-word;
                overflow-wrap: break-word;
            }
            .message p {
                white-space: pre-wrap;
                word-break: break-word;
                overflow-wrap: break-word;
            }
            .controls-grid {
                grid-template-columns: 1fr;
            }
            .voice-mode-switcher {
                flex-direction: column;
            }
            .chat-messages {
                -webkit-overflow-scrolling: touch;
                padding: 12px;
                padding-bottom: 20px;
            }
            .chat-container {
                height: calc(100vh - 24px);
                display: flex;
                flex-direction: column;
            }
            .message-input {
                position: sticky;
                bottom: 0;
                background: var(--surface-color);
                padding-top: 10px;
                padding-bottom: calc(env(safe-area-inset-bottom, 20px) + 16px);
                z-index: 100;
                flex-shrink: 0;
            }
            .voice-container, .image-container {
                max-height: calc(100vh - 24px);
                overflow-y: auto;
                -webkit-overflow-scrolling: touch;
                padding-bottom: 100px;
            }
            .tool-panel {
                overflow-y: auto;
                -webkit-overflow-scrolling: touch;
            }
            .btn-primary, .btn-secondary {
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .setting-group label {
                word-break: keep-all;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
        }
        /* Password Screen */
        .password-screen {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: var(--gradient-bg);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        }
        .password-container {
            background: var(--surface-color);
            border-radius: var(--radius-xl);
            padding: 40px;
            box-shadow: var(--shadow-lg);
            border: 1px solid var(--border-color);
            text-align: center;
            max-width: 400px;
            width: 90%;
        }
        .password-container h2 {
            color: var(--primary-color);
            margin-bottom: 20px;
            font-size: 1.8rem;
        }
        .password-input {
            width: 100%;
            padding: 14px 16px;
            font-size: 1rem;
            border: 2px solid var(--border-color);
            border-radius: var(--radius-md);
            margin-bottom: 20px;
            outline: none;
            transition: all 0.3s ease;
            background: var(--background-color);
            color: var(--text-primary);
        }
        .password-input:focus {
            border-color: var(--primary-color);
            box-shadow: 0 0 0 3px rgba(67, 97, 238, 0.1);
        }
        .password-error {
            color: #dc2626;
            margin-bottom: 16px;
            font-size: 0.9rem;
            display: none;
        }
        .password-error.visible {
            display: block;
        }
        .password-btn {
            width: 100%;
            padding: 14px 24px;
            font-size: 1rem;
            font-weight: 600;
            background: var(--primary-color);
            color: white;
            border: none;
            border-radius: var(--radius-md);
            cursor: pointer;
            transition: all 0.3s ease;
        }
        .password-btn:hover {
            background: var(--primary-hover);
            transform: translateY(-1px);
        }
        .password-btn:disabled {
            background: var(--text-secondary);
            cursor: not-allowed;
            transform: none;
        }
    </style>
</head>
<body>
    <!-- Password Screen -->
    <div class="password-screen" id="password-screen">
        <div class="password-container">
            <h2>🔐 ZQ-AiTool</h2>
            <div class="password-error" id="password-error">密码错误，请重试</div>
            <input type="password" class="password-input" id="password-input" placeholder="请输入访问密码">
            <button class="password-btn" id="password-btn">进入</button>
        </div>
    </div>
    
    <div class="app-container" id="app-container" style="display: none;">
        <!-- Sidebar -->
        <div class="sidebar" id="sidebar">
            <div class="header">
                <h1>ZQ-AiTool</h1>
            </div>
            
            <!-- Tool Selector -->
            <div class="tool-selector">
                <button class="tool-btn active" data-tool="chat">
                    <span class="tool-icon">💬</span>
                    <span>对话</span>
                </button>
                <button class="tool-btn" data-tool="image">
                    <span class="tool-icon">🎨</span>
                    <span>文图转换</span>
                </button>
                <button class="tool-btn" data-tool="voice">
                    <span class="tool-icon">🎤</span>
                    <span>文字语音转换</span>
                </button>
            </div>
            
            <!-- Settings -->
            <div class="settings-container" id="chat-settings">
                <div style="display:flex;gap:8px;margin-bottom:16px;">
                    <button class="btn-primary" id="load-config-btn" style="flex:1;font-size:0.85rem;">加载配置</button>
                    <button class="btn-primary" id="save-config-btn" style="flex:1;font-size:0.85rem;">保存配置</button>
                </div>
                
                <div class="setting-group">
                    <label>API 模式</label>
                    <div class="api-mode-selector">
                        <button class="api-mode-btn active" data-mode="workers">Workers AI</button>
                        <button class="api-mode-btn" data-mode="external">外部 API</button>
                    </div>
                </div>
                
                <div class="setting-group workers-settings" id="workers-settings">
                    <label for="model-input">模型 ID</label>
                    <div style="display:flex;flex-direction:column;gap:8px;">
                        <input type="text" class="form-input" id="model-input" value="@cf/meta/llama-3.1-8b-instruct-fp8" placeholder="请输入模型 ID">
                        <a href="https://developers.cloudflare.com/workers-ai/models/" target="_blank" class="model-link">查看可用模型</a>
                    </div>
                </div>
                
                <div class="external-api-settings" id="external-api-settings">
                    <div class="setting-group">
                        <label for="api-url-input">API 地址</label>
                        <input type="text" class="form-input" id="api-url-input" placeholder="请输入 API 地址">
                    </div>
                    <div class="setting-group">
                        <label for="api-key-input">API 密钥</label>
                        <input type="password" class="form-input" id="api-key-input" placeholder="请输入 API 密钥">
                    </div>
                    <div class="setting-group">
                        <label for="external-model-input">模型名称</label>
                        <input type="text" class="form-input" id="external-model-input" placeholder="请输入模型名称">
                    </div>
                </div>
                
                <div class="setting-group">
                    <label for="system-prompt-input">系统提示词</label>
                    <textarea class="form-textarea" id="system-prompt-input" placeholder="请输入系统提示词" rows="3">你是一个乐于助人、友好的助手。请提供简洁准确的回应。</textarea>
                </div>
                
                <div class="setting-group" style="margin-top:16px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                        <label>对话历史</label>
                        <button class="btn-secondary" id="new-chat-btn" style="padding:4px 12px;font-size:0.85rem;">🆕 新话题</button>
                    </div>
                    <div id="conversation-history" style="max-height:300px;overflow-y:auto;border:1px solid var(--border-color);border-radius:var(--radius-md);padding:8px;">
                        <p style="color:var(--text-secondary);font-size:0.85rem;text-align:center;">暂无历史记录</p>
                    </div>
                </div>
            </div>
        </div>
        <button class="sidebar-toggle" id="sidebar-toggle">☰</button>
        
        <!-- Main Content -->
        <div class="main-content">
            <!-- Chat Panel -->
            <div class="tool-panel active" id="chat-panel">
                <div class="chat-container">
                    <div id="chat-messages" class="chat-messages">
                    </div>
                    <div class="typing-indicator" id="typing-indicator">AI 正在思考...</div>
                    <div class="message-input">
                        <textarea id="user-input" placeholder="请输入你的消息..." rows="1" autofocus></textarea>
                        <button id="send-button">发送</button>
                    </div>
                </div>
            </div>
            
            <!-- Voice Panel -->
            <div class="tool-panel" id="voice-panel">
                <div class="voice-container">
                    <div class="voice-mode-switcher">
                        <button class="voice-mode-btn active" data-voice-mode="tts">
                            <span>🔊</span>
                            <span>文字转语音</span>
                        </button>
                        <button class="voice-mode-btn" data-voice-mode="stt">
                            <span>📝</span>
                            <span>语音转文字</span>
                        </button>
                    </div>
                    
                    <!-- TTS Subpanel -->
                    <div class="voice-subpanel active" id="tts-subpanel">
                        <div class="setting-group">
                            <label>输入方式</label>
                            <div class="input-method-tabs">
                                <button class="tab-btn active" data-input="text">手动输入</button>
                                <button class="tab-btn" data-input="file">上传文件</button>
                            </div>
                        </div>
                        
                        <div id="text-input-area">
                            <div class="setting-group">
                                <label for="tts-text">输入文本</label>
                                <textarea class="form-textarea" id="tts-text" placeholder="请输入要转换为语音的文本..." rows="4"></textarea>
                            </div>
                        </div>
                        
                        <div id="file-input-area" style="display:none;">
                            <div class="setting-group">
                                <label>上传 txt 文件</label>
                                <div class="file-drop-zone" id="tts-file-drop">
                                    <div style="font-size:2rem;margin-bottom:8px;">📄</div>
                                    <p style="font-weight:600;">拖拽 txt 文件到此处，或点击选择文件</p>
                                    <p style="color:var(--text-secondary);font-size:0.85rem;">支持 txt 格式，最大 500KB</p>
                                    <input type="file" id="tts-file-input" accept=".txt,text/plain" style="display:none;">
                                </div>
                                <div class="file-info" id="tts-file-info" style="display:none;">
                                    <div style="flex:1;">
                                        <div style="font-weight:600;" id="tts-file-name"></div>
                                        <div style="color:var(--text-secondary);font-size:0.8rem;" id="tts-file-size"></div>
                                    </div>
                                    <button class="file-remove-btn" id="tts-file-remove">✕</button>
                                </div>
                            </div>
                        </div>
                        
                        <div class="controls-grid">
                            <div class="setting-group">
                                <label for="tts-voice">语音选择</label>
                                <select class="form-select" id="tts-voice">
                                    <option value="zh-CN-XiaoxiaoNeural">晓晓 (女声·温柔)</option>
                                    <option value="zh-CN-YunxiNeural">云希 (男声·清朗)</option>
                                    <option value="zh-CN-YunyangNeural">云扬 (男声·阳光)</option>
                                    <option value="zh-CN-XiaoyiNeural">晓伊 (女声·甜美)</option>
                                    <option value="zh-CN-YunjianNeural">云健 (男声·稳重)</option>
                                    <option value="zh-CN-XiaochenNeural">晓辰 (女声·知性)</option>
                                    <option value="zh-CN-XiaohanNeural">晓涵 (女声·优雅)</option>
                                    <option value="zh-CN-XiaomengNeural">晓梦 (女声·梦幻)</option>
                                    <option value="zh-CN-XiaomoNeural">晓墨 (女声·文艺)</option>
                                    <option value="zh-CN-XiaoqiuNeural">晓秋 (女声·成熟)</option>
                                    <option value="zh-CN-XiaoruiNeural">晓睿 (女声·智慧)</option>
                                    <option value="zh-CN-XiaoshuangNeural">晓双 (女声·活泼)</option>
                                    <option value="zh-CN-XiaoxuanNeural">晓萱 (女声·清新)</option>
                                    <option value="zh-CN-XiaoyanNeural">晓颜 (女声·柔美)</option>
                                    <option value="zh-CN-XiaoyouNeural">晓悠 (女声·悠扬)</option>
                                    <option value="zh-CN-XiaozhenNeural">晓甄 (女声·端庄)</option>
                                    <option value="zh-CN-YunfengNeural">云枫 (男声·磁性)</option>
                                    <option value="zh-CN-YunhaoNeural">云皓 (男声·豪迈)</option>
                                    <option value="zh-CN-YunxiaNeural">云夏 (男声·热情)</option>
                                    <option value="zh-CN-YunyeNeural">云野 (男声·野性)</option>
                                    <option value="zh-CN-YunzeNeural">云泽 (男声·深沉)</option>
                                </select>
                            </div>
                            <div class="setting-group">
                                <label for="tts-speed">语速</label>
                                <select class="form-select" id="tts-speed">
                                    <option value="0.5">🐌 很慢</option>
                                    <option value="0.75">🚶 慢速</option>
                                    <option value="1.0" selected>⚡ 正常</option>
                                    <option value="1.25">🏃 快速</option>
                                    <option value="1.5">🚀 很快</option>
                                    <option value="2.0">💨 极速</option>
                                </select>
                            </div>
                            <div class="setting-group">
                                <label for="tts-pitch">音调</label>
                                <select class="form-select" id="tts-pitch">
                                    <option value="-50">📉 很低沉</option>
                                    <option value="-25">📊 低沉</option>
                                    <option value="0" selected>🎵 标准</option>
                                    <option value="25">📈 高亢</option>
                                    <option value="50">🎶 很高亢</option>
                                </select>
                            </div>
                            <div class="setting-group">
                                <label for="tts-style">风格</label>
                                <select class="form-select" id="tts-style">
                                    <option value="general" selected>🎭 通用风格</option>
                                    <option value="assistant">🤖 智能助手</option>
                                    <option value="chat">💬 聊天对话</option>
                                    <option value="customerservice">📞 客服专业</option>
                                    <option value="newscast">📺 新闻播报</option>
                                    <option value="affectionate">💕 亲切温暖</option>
                                    <option value="calm">😌 平静舒缓</option>
                                    <option value="cheerful">😊 愉快欢乐</option>
                                    <option value="gentle">🌸 温和柔美</option>
                                    <option value="lyrical">🎼 抒情诗意</option>
                                    <option value="serious">🎯 严肃正式</option>
                                </select>
                            </div>
                        </div>
                        
                        <button class="btn-primary" id="tts-generate">
                            <span>🎤</span>
                            <span>生成语音</span>
                        </button>
                        
                        <div class="result-container" id="tts-result" style="display:none;">
                            <div id="tts-loading" class="loading-container" style="display:none;">
                                <div class="loading-spinner"></div>
                                <div>正在生成语音...</div>
                            </div>
                            <div id="tts-success" style="display:none;">
                                <audio id="tts-audio" controls class="audio-player"></audio>
                                <div style="display:flex;gap:8px;margin-top:12px;">
                                    <a id="tts-download" class="btn-primary" href="#" download="voice.mp3" style="text-decoration:none;flex:1;">
                                        <span>⬇️</span>
                                        <span>下载音频</span>
                                    </a>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- STT Subpanel -->
                    <div class="voice-subpanel" id="stt-subpanel">
                        <div class="setting-group">
                            <label>上传音频文件</label>
                            <div class="file-drop-zone" id="stt-file-drop">
                                <div style="font-size:2rem;margin-bottom:8px;">🎵</div>
                                <p style="font-weight:600;">拖拽音频文件到此处，或点击选择文件</p>
                                <p style="color:var(--text-secondary);font-size:0.85rem;">支持 mp3, wav, ogg 等格式</p>
                                <input type="file" id="stt-file-input" accept="audio/*" style="display:none;">
                            </div>
                            <div class="file-info" id="stt-file-info" style="display:none;">
                                <div style="flex:1;">
                                    <div style="font-weight:600;" id="stt-file-name"></div>
                                    <div style="color:var(--text-secondary);font-size:0.8rem;" id="stt-file-size"></div>
                                </div>
                                <button class="file-remove-btn" id="stt-file-remove">✕</button>
                            </div>
                        </div>
                        
                        <div class="setting-group">
                            <label for="stt-token">API Token</label>
                            <input type="password" class="form-input" id="stt-token" placeholder="请输入您的硅基流动 API Token">
                        </div>
                        
                        <div style="display:flex;gap:8px;margin-bottom:16px;">
                            <button class="btn-primary" id="load-config-btn-voice" style="flex:1;font-size:0.85rem;">加载配置</button>
                            <button class="btn-primary" id="save-config-btn-voice" style="flex:1;font-size:0.85rem;">保存配置</button>
                        </div>
                        
                        <button class="btn-primary" id="stt-transcribe">
                            <span>📝</span>
                            <span>转录文字</span>
                        </button>
                        
                        <div class="result-container" id="stt-result" style="display:none;">
                            <div id="stt-loading" class="loading-container" style="display:none;">
                                <div class="loading-spinner"></div>
                                <div>正在转录...</div>
                            </div>
                            <div id="stt-success" style="display:none;">
                                <div class="setting-group">
                                    <label>转录结果</label>
                                    <textarea class="form-textarea" id="stt-text" readonly rows="6"></textarea>
                                </div>
                                <div style="display:flex;gap:8px;margin-top:12px;">
                                    <button class="btn-primary" id="stt-copy" style="flex:1;">
                                        <span>📋</span>
                                        <span>复制文字</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Image Panel -->
            <div class="tool-panel" id="image-panel">
                <div class="image-container">
                    <div class="image-form">
                        <div class="setting-group">
                            <label for="img-model">模型</label>
                            <select class="form-select" id="img-model">
                                <option value="flux-1-schnell">FLUX.1 [schnell] - 高性能文生图</option>
                                <option value="stable-diffusion-xl-base-1.0">Stable Diffusion XL Base 1.0</option>
                                <option value="dreamshaper-8-lcm">DreamShaper 8 LCM</option>
                                <option value="stable-diffusion-xl-lightning">Stable Diffusion XL Lightning</option>
                                <option value="stable-diffusion-v1-5-img2img">Stable Diffusion v1.5 图生图</option>
                                <option value="stable-diffusion-v1-5-inpainting">Stable Diffusion v1.5 局部重绘</option>
                            </select>
                        </div>
                        
                        <div class="setting-group">
                            <label for="img-prompt">提示词</label>
                            <div style="display:flex;gap:8px;">
                                <textarea class="form-textarea" id="img-prompt" placeholder="请输入图片描述..." rows="3" style="flex:1;"></textarea>
                                <button class="random-prompt-btn" id="random-prompt">🎲 随机</button>
                            </div>
                        </div>
                        
                        <div class="setting-group" id="img-url-group" style="display:none;">
                            <label for="img-url">输入图片 URL</label>
                            <input type="text" class="form-input" id="img-url" placeholder="请输入图片 URL">
                        </div>
                        
                        <div class="setting-group" id="img-mask-group" style="display:none;">
                            <label for="img-mask-url">遮罩图片 URL</label>
                            <input type="text" class="form-input" id="img-mask-url" placeholder="请输入遮罩图片 URL">
                        </div>
                        
                        <!-- Advanced Options -->
                        <div class="advanced-options-container">
                            <div class="advanced-options-header" id="advanced-toggle">
                                <span style="display:flex;align-items:center;gap:8px;">
                                    <span>🔧</span>
                                    <span>高级选项</span>
                                </span>
                                <span id="advanced-toggle-icon">▼</span>
                            </div>
                            <div class="advanced-options-content" id="advanced-content">
                                <div class="slider-container">
                                    <div class="slider-label">
                                        <span>📐 图像宽度</span>
                                        <span id="width-value">1024px</span>
                                    </div>
                                    <input type="range" class="form-slider" id="img-width-slider" min="256" max="2048" step="64" value="1024">
                                </div>
                                
                                <div class="slider-container">
                                    <div class="slider-label">
                                        <span>📏 图像高度</span>
                                        <span id="height-value">1024px</span>
                                    </div>
                                    <input type="range" class="form-slider" id="img-height-slider" min="256" max="2048" step="64" value="1024">
                                </div>
                                
                                <div class="slider-container">
                                    <div class="slider-label">
                                        <span>🦶 迭代步数</span>
                                        <span id="steps-value">20</span>
                                    </div>
                                    <input type="range" class="form-slider" id="img-steps-slider" min="1" max="50" step="1" value="20">
                                </div>
                                
                                <div class="slider-container">
                                    <div class="slider-label">
                                        <span>🧭 引导系数</span>
                                        <span id="guidance-value">7.5</span>
                                    </div>
                                    <input type="range" class="form-slider" id="img-guidance-slider" min="0" max="30" step="0.5" value="7.5">
                                </div>
                                
                                <div class="slider-container">
                                    <div class="slider-label">
                                        <span>🖼️ 生成数量</span>
                                        <span id="outputs-value">1</span>
                                    </div>
                                    <input type="range" class="form-slider" id="img-outputs-slider" min="1" max="8" step="1" value="1">
                                </div>
                                
                                <div class="setting-group">
                                    <div class="slider-label">
                                        <span>🌱 随机种子</span>
                                    </div>
                                    <div style="display:flex;gap:8px;">
                                        <input type="number" class="form-input" id="img-seed" placeholder="留空则随机生成" style="flex:1;">
                                        <button class="btn-secondary" id="random-seed" style="white-space:nowrap;">
                                            <span>🎲</span>
                                            <span>随机</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <button class="btn-primary" id="img-generate">
                            <span>🎨</span>
                            <span>生成图片</span>
                        </button>
                    </div>
                    
                    <div class="image-result" id="img-result" style="display:none;">
                        <div id="img-loading" class="loading-container" style="display:none;">
                            <div class="loading-spinner"></div>
                            <div>正在生成图片...</div>
                        </div>
                        <div id="img-success" style="display:none;">
                            <div id="image-gallery" class="image-gallery"></div>
                            <div class="image-info" id="img-info"></div>
                            <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
                                <a class="btn-primary" id="img-download" href="#" style="flex:1;text-decoration:none;">
                                    <span>⬇️</span>
                                    <span>下载全部</span>
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
    
    <script>
        // --- State ---
        let currentTool = 'chat';
        let currentApiMode = 'workers';
        let currentVoiceMode = 'tts';
        let chatHistory = [];
        let isProcessing = false;
        let ttsFileContent = '';
        let sttFile = null;
        let currentConversationId = null;
        let currentConversationName = '';
        let currentPassword = '';
        
        // --- Helper Function for API Path ---
        function getApiPath(path) {
            if (!currentPassword) {
                throw new Error('请先输入访问密码');
            }
            return \`/api/\${path}/\${encodeURIComponent(currentPassword)}\`;
        }
        
        // --- DOM Elements ---
        const passwordScreen = document.getElementById('password-screen');
        const appContainer = document.getElementById('app-container');
        const passwordInput = document.getElementById('password-input');
        const passwordBtn = document.getElementById('password-btn');
        const passwordError = document.getElementById('password-error');
        
        const sidebar = document.getElementById('sidebar');
        const sidebarToggle = document.getElementById('sidebar-toggle');
        const toolBtns = document.querySelectorAll('.tool-btn');
        const toolPanels = document.querySelectorAll('.tool-panel');
        const chatSettings = document.getElementById('chat-settings');
        
        // Chat Elements
        const chatMessages = document.getElementById('chat-messages');
        const userInput = document.getElementById('user-input');
        const sendButton = document.getElementById('send-button');
        const typingIndicator = document.getElementById('typing-indicator');
        const modelInput = document.getElementById('model-input');
        const systemPromptInput = document.getElementById('system-prompt-input');
        const apiModeBtns = document.querySelectorAll('.api-mode-btn');
        const externalApiSettings = document.getElementById('external-api-settings');
        const workersSettings = document.getElementById('workers-settings');
        const apiUrlInput = document.getElementById('api-url-input');
        const apiKeyInput = document.getElementById('api-key-input');
        const externalModelInput = document.getElementById('external-model-input');
        const saveConfigBtn = document.getElementById('save-config-btn');
        const loadConfigBtn = document.getElementById('load-config-btn');
        const saveConfigBtnVoice = document.getElementById('save-config-btn-voice');
        const loadConfigBtnVoice = document.getElementById('load-config-btn-voice');
        const conversationHistoryDiv = document.getElementById('conversation-history');
        const newChatBtn = document.getElementById('new-chat-btn');
        
        // Voice Elements
        const voiceModeBtns = document.querySelectorAll('.voice-mode-btn');
        const voiceSubpanels = document.querySelectorAll('.voice-subpanel');
        const ttsText = document.getElementById('tts-text');
        const ttsVoice = document.getElementById('tts-voice');
        const ttsSpeed = document.getElementById('tts-speed');
        const ttsPitch = document.getElementById('tts-pitch');
        const ttsStyle = document.getElementById('tts-style');
        const ttsGenerate = document.getElementById('tts-generate');
        const ttsResult = document.getElementById('tts-result');
        const ttsLoading = document.getElementById('tts-loading');
        const ttsSuccess = document.getElementById('tts-success');
        const ttsAudio = document.getElementById('tts-audio');
        const ttsDownload = document.getElementById('tts-download');
        const ttsFileDrop = document.getElementById('tts-file-drop');
        const ttsFileInput = document.getElementById('tts-file-input');
        const ttsFileInfo = document.getElementById('tts-file-info');
        const ttsFileName = document.getElementById('tts-file-name');
        const ttsFileSize = document.getElementById('tts-file-size');
        const ttsFileRemove = document.getElementById('tts-file-remove');
        const ttsInputTabs = document.querySelectorAll('#tts-subpanel .tab-btn');
        const ttsTextArea = document.getElementById('text-input-area');
        const ttsFileArea = document.getElementById('file-input-area');
        const sttFileDrop = document.getElementById('stt-file-drop');
        const sttFileInput = document.getElementById('stt-file-input');
        const sttFileInfo = document.getElementById('stt-file-info');
        const sttFileName = document.getElementById('stt-file-name');
        const sttFileSize = document.getElementById('stt-file-size');
        const sttFileRemove = document.getElementById('stt-file-remove');
        const sttTranscribe = document.getElementById('stt-transcribe');
        const sttResult = document.getElementById('stt-result');
        const sttLoading = document.getElementById('stt-loading');
        const sttSuccess = document.getElementById('stt-success');
        const sttText = document.getElementById('stt-text');
        const sttCopy = document.getElementById('stt-copy');
        const sttToken = document.getElementById('stt-token');
        
        // Image Elements
        const imgModel = document.getElementById('img-model');
        const imgPrompt = document.getElementById('img-prompt');
        const imgGenerate = document.getElementById('img-generate');
        const imgResult = document.getElementById('img-result');
        const imgLoading = document.getElementById('img-loading');
        const imgSuccess = document.getElementById('img-success');
        const imgInfo = document.getElementById('img-info');
        const imgDownload = document.getElementById('img-download');
        const randomPromptBtn = document.getElementById('random-prompt');
        const imgUrlGroup = document.getElementById('img-url-group');
        const imgMaskGroup = document.getElementById('img-mask-group');
        const imgUrl = document.getElementById('img-url');
        const imgMaskUrl = document.getElementById('img-mask-url');
        
        // Advanced Options Elements
        const advancedToggle = document.getElementById('advanced-toggle');
        const advancedContent = document.getElementById('advanced-content');
        const advancedToggleIcon = document.getElementById('advanced-toggle-icon');
        const imgWidthSlider = document.getElementById('img-width-slider');
        const imgHeightSlider = document.getElementById('img-height-slider');
        const imgStepsSlider = document.getElementById('img-steps-slider');
        const imgGuidanceSlider = document.getElementById('img-guidance-slider');
        const imgOutputsSlider = document.getElementById('img-outputs-slider');
        const imgSeed = document.getElementById('img-seed');
        const randomSeedBtn = document.getElementById('random-seed');
        const widthValue = document.getElementById('width-value');
        const heightValue = document.getElementById('height-value');
        const stepsValue = document.getElementById('steps-value');
        const guidanceValue = document.getElementById('guidance-value');
        const outputsValue = document.getElementById('outputs-value');
        const imageGallery = document.getElementById('image-gallery');
        
        // --- Config Functions ---
        async function loadConfig() {
            try {
                const response = await fetch(getApiPath('config'));
                const config = await response.json();
                if (config) {
                    if (config.apiMode) {
                        apiModeBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === config.apiMode));
                        currentApiMode = config.apiMode;
                        if (config.apiMode === 'external') {
                            externalApiSettings.classList.add('visible');
                            workersSettings.classList.add('hidden');
                        } else {
                            externalApiSettings.classList.remove('visible');
                            workersSettings.classList.remove('hidden');
                        }
                    }
                    if (config.model) modelInput.value = config.model;
                    if (config.apiUrl) apiUrlInput.value = config.apiUrl;
                    if (config.apiKey) apiKeyInput.value = config.apiKey;
                    if (config.externalModel) externalModelInput.value = config.externalModel;
                    if (config.systemPrompt) systemPromptInput.value = config.systemPrompt;
                    if (config.sttToken) sttToken.value = config.sttToken;
                }
                alert('配置加载成功！');
            } catch (error) {
                alert('加载配置失败: ' + error.message);
            }
        }
        
        async function saveConfig() {
            try {
                const config = {
                    apiMode: currentApiMode,
                    model: modelInput.value,
                    apiUrl: apiUrlInput.value,
                    apiKey: apiKeyInput.value,
                    externalModel: externalModelInput.value,
                    systemPrompt: systemPromptInput.value,
                    sttToken: sttToken.value
                };
                const response = await fetch(getApiPath('config'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(config)
                });
                const result = await response.json();
                if (result.success) {
                    alert('配置保存成功！');
                }
            } catch (error) {
                alert('保存配置失败: ' + error.message);
            }
        }
        
        function renderConversationHistory(history) {
            if (!history || history.length === 0) {
                conversationHistoryDiv.innerHTML = '<p style="color:var(--text-secondary);font-size:0.85rem;text-align:center;">暂无历史记录</p>';
                return;
            }
            
            conversationHistoryDiv.innerHTML = history.map(item => {
                const date = new Date(item.timestamp).toLocaleString('zh-CN');
                const displayName = item.name || (item.conversation[0]?.content?.slice(0, 20) + '...');
                const isActive = item.id === currentConversationId;
                return \`
                    <div style="padding:8px;border-bottom:1px solid var(--border-color);cursor:pointer;display:flex;justify-content:space-between;align-items:center;\${isActive ? 'background:rgba(59,130,246,0.1);' : ''}" data-id="\${item.id}">
                        <div style="flex:1;min-width:0;">
                            <div style="font-weight:500;font-size:0.9rem;display:flex;align-items:center;gap:8px;">
                                <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" data-name="\${item.id}">\${displayName}</span>
                                <button class="file-remove-btn" data-edit-id="\${item.id}" style="opacity:0.6;font-size:0.75rem;" title="重命名">✏️</button>
                            </div>
                            <div style="font-size:0.8rem;color:var(--text-secondary);">\${date}</div>
                        </div>
                        <button class="file-remove-btn" data-delete-id="\${item.id}">✕</button>
                    </div>
                \`;
            }).join('');
            
            // 添加点击事件 - 加载对话
            conversationHistoryDiv.querySelectorAll('[data-id]').forEach(el => {
                el.addEventListener('click', (e) => {
                    if (e.target.dataset.deleteId || e.target.dataset.editId) return; // 点击其他按钮不触发
                    const id = el.dataset.id;
                    const item = history.find(h => h.id === id);
                    if (item) {
                        loadConversation(item.id, item.name, item.conversation);
                    }
                });
            });
            
            // 添加编辑按钮事件
            conversationHistoryDiv.querySelectorAll('[data-edit-id]').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const id = btn.dataset.editId;
                    const item = history.find(h => h.id === id);
                    if (!item) return;
                    const newName = prompt('请输入对话名称：', item.name || '');
                    if (newName !== null && newName.trim()) {
                        try {
                            await fetch(getApiPath('conversation'), {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ id, name: newName.trim() })
                            });
                            loadConversationHistory();
                        } catch (error) {
                            alert('重命名失败');
                        }
                    }
                });
            });
            
            // 添加删除按钮事件
            conversationHistoryDiv.querySelectorAll('[data-delete-id]').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const id = btn.dataset.deleteId;
                    if (confirm('确定要删除这条历史吗？')) {
                        try {
                            await fetch(getApiPath('conversation'), {
                                method: 'DELETE',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ id })
                            });
                            loadConversationHistory();
                        } catch (error) {
                            alert('删除失败');
                        }
                    }
                });
            });
        }
        
        function loadConversation(id, name, conversation) {
            currentConversationId = id;
            currentConversationName = name || '';
            chatHistory = [...conversation];
            chatMessages.innerHTML = '';
            conversation.forEach(msg => {
                addMessageToChat(msg.role, msg.content);
            });
            renderConversationHistory(loadedHistory || []);
        }
        
        async function saveCurrentConversation() {
            if (chatHistory.length === 0) return; // 没有消息时不保存
            try {
                const data = {
                    id: currentConversationId,
                    name: currentConversationName,
                    conversation: chatHistory
                };
                const response = await fetch(getApiPath('conversation'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                const result = await response.json();
                if (result.id && !currentConversationId) {
                    currentConversationId = result.id;
                }
                loadConversationHistory();
            } catch (error) {
                console.error('保存对话失败:', error);
            }
        }
        
        async function startNewChat() {
            if (chatHistory.length > 0 && confirm('是否保存当前对话？')) {
                await saveCurrentConversation();
            }
            currentConversationId = null;
            currentConversationName = '';
            chatHistory = [];
            chatMessages.innerHTML = '';
            loadConversationHistory();
        }
        
        let loadedHistory = [];
        async function loadConversationHistory() {
            try {
                const response = await fetch(getApiPath('conversation'));
                const history = await response.json();
                loadedHistory = history;
                renderConversationHistory(history);
            } catch (error) {
                console.error('加载历史失败:', error);
            }
        }
        
        // --- Password Authentication ---
        async function verifyPassword(password) {
            try {
                // 先验证密码是否正确，使用简单的test端点
                const response = await fetch(\`/api/config/\${encodeURIComponent(password)}\`);
                if (response.ok) {
                    return true;
                }
                return false;
            } catch {
                return false;
            }
        }
        
        passwordBtn.addEventListener('click', async () => {
            const password = passwordInput.value.trim();
            if (!password) {
                passwordError.textContent = '请输入密码';
                passwordError.classList.add('visible');
                return;
            }
            
            passwordBtn.disabled = true;
            passwordError.classList.remove('visible');
            
            const isValid = await verifyPassword(password);
            
            if (isValid) {
                currentPassword = password;
                passwordScreen.style.display = 'none';
                appContainer.style.display = 'flex';
                // 初始化应用
                loadConfig();
                loadConversationHistory();
            } else {
                passwordError.textContent = '密码错误，请重试';
                passwordError.classList.add('visible');
                passwordBtn.disabled = false;
            }
        });
        
        passwordInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                passwordBtn.click();
            }
        });
        
        // Event listeners for config
        saveConfigBtn.addEventListener('click', saveConfig);
        loadConfigBtn.addEventListener('click', loadConfig);
        saveConfigBtnVoice.addEventListener('click', saveConfig);
        loadConfigBtnVoice.addEventListener('click', loadConfig);
        newChatBtn.addEventListener('click', startNewChat);
        
        // --- Sidebar Toggle ---
        sidebarToggle.addEventListener('click', () => {
            const isMobile = window.innerWidth <= 768;
            if (isMobile) {
                sidebar.classList.toggle('open');
            } else {
                sidebar.classList.toggle('collapsed');
            }
        });
        
        // --- Tool Switching ---
        toolBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const tool = btn.dataset.tool;
                switchTool(tool);
            });
        });
        
        function switchTool(tool) {
            currentTool = tool;
            toolBtns.forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
            toolPanels.forEach(p => p.classList.toggle('active', p.id === tool + '-panel'));
            chatSettings.style.display = tool === 'chat' ? 'flex' : 'none';
        }
        
        // --- API Mode Switching ---
        apiModeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                apiModeBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentApiMode = btn.dataset.mode;
                if (currentApiMode === 'external') {
                    externalApiSettings.classList.add('visible');
                    workersSettings.classList.add('hidden');
                } else {
                    externalApiSettings.classList.remove('visible');
                    workersSettings.classList.remove('hidden');
                }
            });
        });
        
        // --- Chat ---
        userInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = this.scrollHeight + 'px';
        });
        
        userInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        
        sendButton.addEventListener('click', sendMessage);
        
        async function sendMessage() {
            const message = userInput.value.trim();
            if (message === '' || isProcessing) return;
            if (currentApiMode === 'external' && !apiKeyInput.value.trim()) {
                alert('请先输入 API 密钥！');
                apiKeyInput.focus();
                return;
            }
            isProcessing = true;
            userInput.disabled = true;
            sendButton.disabled = true;
            addMessageToChat('user', message);
            userInput.value = '';
            userInput.style.height = 'auto';
            typingIndicator.classList.add('visible');
            chatHistory.push({ role: 'user', content: message });
            try {
                const assistantMessageEl = document.createElement('div');
                assistantMessageEl.className = 'message assistant-message';
                assistantMessageEl.innerHTML = '<p></p>';
                chatMessages.appendChild(assistantMessageEl);
                const assistantTextEl = assistantMessageEl.querySelector('p');
                chatMessages.scrollTop = chatMessages.scrollHeight;
                
                const requestBody = {
                    messages: chatHistory,
                    systemPrompt: systemPromptInput.value.trim(),
                    apiMode: currentApiMode
                };
                if (currentApiMode === 'workers') {
                    requestBody.model = modelInput.value.trim();
                } else {
                    requestBody.apiUrl = apiUrlInput.value.trim();
                    requestBody.apiKey = apiKeyInput.value.trim();
                    requestBody.model = externalModelInput.value.trim();
                }
                
                const response = await fetch(getApiPath('chat'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestBody)
                });
                if (!response.ok) throw new Error('获取响应失败');
                if (!response.body) throw new Error('响应体为空');
                
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let responseText = '';
                let buffer = '';
                const flushAssistantText = () => {
                    assistantTextEl.textContent = responseText;
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                };
                
                let sawDone = false;
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                        const parsed = consumeSseEvents(buffer + '\\n\\n');
                        for (const data of parsed.events) {
                            if (data === '[DONE]') break;
                            try {
                                const jsonData = JSON.parse(data);
                                let content = '';
                                if (typeof jsonData.response === 'string' && jsonData.response.length > 0) {
                                    content = jsonData.response;
                                } else if (jsonData.choices?.[0]?.delta?.content) {
                                    content = jsonData.choices[0].delta.content;
                                }
                                if (content) {
                                    responseText += content;
                                    flushAssistantText();
                                }
                            } catch (e) {
                                console.error('解析 SSE 数据出错:', e, data);
                            }
                        }
                        break;
                    }
                    buffer += decoder.decode(value, { stream: true });
                    const parsed = consumeSseEvents(buffer);
                    buffer = parsed.buffer;
                    for (const data of parsed.events) {
                        if (data === '[DONE]') {
                            sawDone = true;
                            buffer = '';
                            break;
                        }
                        try {
                            const jsonData = JSON.parse(data);
                            let content = '';
                            if (typeof jsonData.response === 'string' && jsonData.response.length > 0) {
                                content = jsonData.response;
                            } else if (jsonData.choices?.[0]?.delta?.content) {
                                content = jsonData.choices[0].delta.content;
                            }
                            if (content) {
                                responseText += content;
                                flushAssistantText();
                            }
                        } catch (e) {
                            console.error('解析 SSE 数据出错:', e, data);
                        }
                    }
                    if (sawDone) break;
                }
                
                if (responseText.length > 0) {
                    chatHistory.push({ role: 'assistant', content: responseText });
                }
            } catch (error) {
                console.error('错误:', error);
                addMessageToChat('assistant', '抱歉，处理您的请求时发生了错误。' + (error.message ? '\\n\\n错误详情：' + error.message : ''));
            } finally {
                typingIndicator.classList.remove('visible');
                isProcessing = false;
                userInput.disabled = false;
                sendButton.disabled = false;
                // 保存对话历史
                saveCurrentConversation();
                const isMobile = window.innerWidth <= 768;
                if (!isMobile) userInput.focus();
            }
        }
        
        function addMessageToChat(role, content) {
            const messageEl = document.createElement('div');
            messageEl.className = 'message ' + role + '-message';
            messageEl.innerHTML = '<p>' + content + '</p>';
            chatMessages.appendChild(messageEl);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }

        function consumeSseEvents(buffer) {
            let normalized = buffer.replace(/\\r/g, '');
            const events = [];
            let eventEndIndex;
            while ((eventEndIndex = normalized.indexOf('\\n\\n')) !== -1) {
                const rawEvent = normalized.slice(0, eventEndIndex);
                normalized = normalized.slice(eventEndIndex + 2);
                const lines = rawEvent.split('\\n');
                const dataLines = [];
                for (const line of lines) {
                    if (line.startsWith('data:')) {
                        dataLines.push(line.slice('data:'.length).trimStart());
                    }
                }
                if (dataLines.length === 0) continue;
                events.push(dataLines.join('\\n'));
            }
            return { events, buffer: normalized };
        }
        
        // --- Voice ---
        voiceModeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                voiceModeBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentVoiceMode = btn.dataset.voiceMode;
                voiceSubpanels.forEach(p => p.classList.toggle('active', p.id === currentVoiceMode + '-subpanel'));
            });
        });
        
        ttsInputTabs.forEach(btn => {
            btn.addEventListener('click', () => {
                ttsInputTabs.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                if (btn.dataset.input === 'text') {
                    ttsTextArea.style.display = 'block';
                    ttsFileArea.style.display = 'none';
                } else {
                    ttsTextArea.style.display = 'none';
                    ttsFileArea.style.display = 'block';
                }
            });
        });
        
        ttsFileDrop.addEventListener('click', () => ttsFileInput.click());
        ttsFileDrop.addEventListener('dragover', (e) => { e.preventDefault(); ttsFileDrop.classList.add('dragover'); });
        ttsFileDrop.addEventListener('dragleave', () => ttsFileDrop.classList.remove('dragover'));
        ttsFileDrop.addEventListener('drop', (e) => {
            e.preventDefault();
            ttsFileDrop.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file) handleTtsFile(file);
        });
        ttsFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) handleTtsFile(file);
        });
        ttsFileRemove.addEventListener('click', () => {
            ttsFileContent = '';
            ttsFileInfo.style.display = 'none';
            ttsFileInput.value = '';
        });
        
        function handleTtsFile(file) {
            if (file.type !== 'text/plain' && !file.name.endsWith('.txt')) {
                alert('请上传 txt 文件！');
                return;
            }
            if (file.size > 500 * 1024) {
                alert('文件太大！请上传小于 500KB 的文件。');
                return;
            }
            const reader = new FileReader();
            reader.onload = (e) => {
                ttsFileContent = e.target.result;
                ttsFileName.textContent = file.name;
                ttsFileSize.textContent = (file.size / 1024).toFixed(2) + ' KB';
                ttsFileInfo.style.display = 'flex';
            };
            reader.readAsText(file);
        }
        
        sttFileDrop.addEventListener('click', () => sttFileInput.click());
        sttFileDrop.addEventListener('dragover', (e) => { e.preventDefault(); sttFileDrop.classList.add('dragover'); });
        sttFileDrop.addEventListener('dragleave', () => sttFileDrop.classList.remove('dragover'));
        sttFileDrop.addEventListener('drop', (e) => {
            e.preventDefault();
            sttFileDrop.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file) handleSttFile(file);
        });
        sttFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) handleSttFile(file);
        });
        sttFileRemove.addEventListener('click', () => {
            sttFile = null;
            sttFileInfo.style.display = 'none';
            sttFileInput.value = '';
        });
        
        function handleSttFile(file) {
            sttFile = file;
            sttFileName.textContent = file.name;
            sttFileSize.textContent = (file.size / 1024).toFixed(2) + ' KB';
            sttFileInfo.style.display = 'flex';
        }
        
        ttsGenerate.addEventListener('click', async () => {
            const text = ttsFileContent || ttsText.value.trim();
            if (!text) {
                alert('请输入文本或上传文件！');
                return;
            }
            ttsResult.style.display = 'block';
            ttsLoading.style.display = 'block';
            ttsSuccess.style.display = 'none';
            try {
                let response;
                
                if (ttsFileContent) {
                    const formData = new FormData();
                    formData.append('file', new Blob([ttsFileContent], { type: 'text/plain' }), 'text.txt');
                    formData.append('voice', ttsVoice.value);
                    formData.append('speed', ttsSpeed.value);
                    formData.append('volume', '0');
                    formData.append('pitch', ttsPitch.value);
                    formData.append('style', ttsStyle.value);
                    response = await fetch(getApiPath('tts'), {
                        method: 'POST',
                        body: formData
                    });
                } else {
                    response = await fetch(getApiPath('tts'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            text,
                            voice: ttsVoice.value,
                            speed: ttsSpeed.value,
                            volume: '0',
                            pitch: ttsPitch.value,
                            style: ttsStyle.value
                        })
                    });
                }
                
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.error?.message || errorData.message || '生成语音失败');
                }
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                ttsAudio.src = url;
                ttsDownload.href = url;
                ttsSuccess.style.display = 'block';
            } catch (error) {
                alert('生成语音失败：' + error.message);
            } finally {
                ttsLoading.style.display = 'none';
            }
        });
        
        sttTranscribe.addEventListener('click', async () => {
            if (!sttFile) {
                alert('请先上传音频文件！');
                return;
            }
            if (!sttToken.value.trim()) {
                alert('请先输入 API Token！');
                return;
            }
            sttResult.style.display = 'block';
            sttLoading.style.display = 'block';
            sttSuccess.style.display = 'none';
            try {
                const formData = new FormData();
                formData.append('audio', sttFile);
                formData.append('token', sttToken.value.trim());
                const response = await fetch(getApiPath('stt'), {
                    method: 'POST',
                    body: formData
                });
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.error?.message || errorData.message || '转录失败');
                }
                const data = await response.json();
                sttText.value = data.text || '';
                sttSuccess.style.display = 'block';
            } catch (error) {
                alert('转录失败：' + error.message);
            } finally {
                sttLoading.style.display = 'none';
            }
        });
        
        sttCopy.addEventListener('click', () => {
            sttText.select();
            document.execCommand('copy');
            alert('已复制到剪贴板！');
        });
        
        // --- Image ---
        imgModel.addEventListener('change', () => {
            const model = imgModel.value;
            if (model === 'stable-diffusion-v1-5-img2img' || model === 'stable-diffusion-v1-5-inpainting') {
                imgUrlGroup.style.display = 'block';
                if (model === 'stable-diffusion-v1-5-inpainting') {
                    imgMaskGroup.style.display = 'block';
                } else {
                    imgMaskGroup.style.display = 'none';
                }
            } else {
                imgUrlGroup.style.display = 'none';
                imgMaskGroup.style.display = 'none';
            }
        });
        
        const randomPrompts = [
            '赛博朋克风城市夜景，霓虹灯雨夜街道，反光地面，强烈对比度，广角镜头，电影感',
            '清晨森林小径，阳光穿过树叶薄雾弥漫，柔和光线，高饱和度，超清细节',
            '水墨山水，远山近水小桥人家，留白构图，国画风格，淡雅色调',
            '可爱橘猫坐在窗台，落日与晚霞，暖色调，浅景深，柔焦',
            '科幻机甲战士，蓝色能量核心，强烈光影，硬边金属质感，战损细节',
            '复古胶片风人像，暖色调，轻微颗粒，高光溢出，自然肤色，50mm',
            '海边灯塔与星空，银河拱桥，长曝光，拍岸浪花，清冷色调',
            '蒸汽朋克飞船穿越云层，黄铜齿轮与管道，体积光，戏剧化天空',
            '古风少女立于竹林，微风拂过衣袂，侧光，国风写意，细腻材质',
            '极光下雪原与麋鹿，宁静辽阔，低饱和度，广角远景，细腻噪点控制'
        ];
        
        randomPromptBtn.addEventListener('click', () => {
            const prompt = randomPrompts[Math.floor(Math.random() * randomPrompts.length)];
            imgPrompt.value = prompt;
        });
        
        // Advanced Options Toggle
        advancedToggle.addEventListener('click', () => {
            const isCollapsed = advancedContent.classList.toggle('collapsed');
            advancedToggleIcon.textContent = isCollapsed ? '▶' : '▼';
        });
        
        // Slider Event Listeners
        imgWidthSlider.addEventListener('input', () => {
            widthValue.textContent = imgWidthSlider.value + 'px';
        });
        
        imgHeightSlider.addEventListener('input', () => {
            heightValue.textContent = imgHeightSlider.value + 'px';
        });
        
        imgStepsSlider.addEventListener('input', () => {
            stepsValue.textContent = imgStepsSlider.value;
        });
        
        imgGuidanceSlider.addEventListener('input', () => {
            guidanceValue.textContent = imgGuidanceSlider.value;
        });
        
        imgOutputsSlider.addEventListener('input', () => {
            outputsValue.textContent = imgOutputsSlider.value;
        });
        
        // Random Seed
        randomSeedBtn.addEventListener('click', () => {
            imgSeed.value = Math.floor(Math.random() * 1000000);
        });
        
        // 存储生成的图片数据，用于下载
        let generatedImages = [];
        
        imgGenerate.addEventListener('click', async () => {
            const prompt = imgPrompt.value.trim();
            if (!prompt) {
                alert('请输入提示词！');
                return;
            }
            imgResult.style.display = 'block';
            imgLoading.style.display = 'block';
            imgSuccess.style.display = 'none';
            imageGallery.innerHTML = '';
            
            try {
                const requestBody = {
                    model: imgModel.value,
                    prompt,
                    width: parseInt(imgWidthSlider.value),
                    height: parseInt(imgHeightSlider.value),
                    num_steps: parseInt(imgStepsSlider.value),
                    guidance: parseFloat(imgGuidanceSlider.value),
                    num_outputs: parseInt(imgOutputsSlider.value)
                };
                
                if (imgSeed.value) {
                    requestBody.seed = parseInt(imgSeed.value);
                }
                
                if (imgModel.value === 'stable-diffusion-v1-5-img2img' || imgModel.value === 'stable-diffusion-v1-5-inpainting') {
                    if (!imgUrl.value.trim()) {
                        alert('请输入图片 URL！');
                        return;
                    }
                    requestBody.image_url = imgUrl.value.trim();
                    if (imgModel.value === 'stable-diffusion-v1-5-inpainting') {
                        if (!imgMaskUrl.value.trim()) {
                            alert('请输入遮罩图片 URL！');
                            return;
                        }
                        requestBody.mask_url = imgMaskUrl.value.trim();
                    }
                }
                
                const response = await fetch(getApiPath('image'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestBody)
                });
                
                if (!response.ok) throw new Error('生成图片失败');
                
                // 清空之前存储的图片
                generatedImages = [];
                const timestamp = Date.now();
                
                const contentType = response.headers.get('content-type');
                if (contentType && contentType.includes('application/json')) {
                    const data = await response.json();
                    if (data.images && Array.isArray(data.images)) {
                        data.images.forEach((imageData, index) => {
                            // 存储图片数据
                            generatedImages.push({
                                data: imageData,
                                filename: \`generated-\${timestamp}-\${index + 1}.png\`
                            });
                            
                            const item = document.createElement('div');
                            item.className = 'gallery-item';
                            const img = document.createElement('img');
                            img.src = imageData;
                            img.alt = \`Generated \${index + 1}\`;
                            
                            const overlay = document.createElement('div');
                            overlay.className = 'gallery-item-overlay';
                            const downloadBtn = document.createElement('a');
                            downloadBtn.className = 'gallery-download-btn';
                            downloadBtn.href = imageData;
                            downloadBtn.download = \`generated-\${timestamp}-\${index + 1}.png\`;
                            downloadBtn.textContent = '下载';
                            
                            overlay.appendChild(downloadBtn);
                            item.appendChild(img);
                            item.appendChild(overlay);
                            imageGallery.appendChild(item);
                        });
                        
                        imgInfo.textContent = '模型：' + imgModel.options[imgModel.selectedIndex].text + ' | 生成数量：' + data.images.length;
                    }
                } else {
                    const blob = await response.blob();
                    const url = URL.createObjectURL(blob);
                    
                    // 存储图片数据（需要读取blob）
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        generatedImages.push({
                            data: reader.result,
                            filename: \`generated-\${timestamp}-1.png\`
                        });
                    };
                    reader.readAsDataURL(blob);
                    
                    const item = document.createElement('div');
                    item.className = 'gallery-item';
                    const img = document.createElement('img');
                    img.src = url;
                    img.alt = 'Generated';
                    
                    const overlay = document.createElement('div');
                    overlay.className = 'gallery-item-overlay';
                    const downloadBtn = document.createElement('a');
                    downloadBtn.className = 'gallery-download-btn';
                    downloadBtn.href = url;
                    downloadBtn.download = \`generated-\${timestamp}-1.png\`;
                    downloadBtn.textContent = '下载';
                    
                    overlay.appendChild(downloadBtn);
                    item.appendChild(img);
                    item.appendChild(overlay);
                    imageGallery.appendChild(item);
                    
                    imgDownload.href = url;
                    imgInfo.textContent = '模型：' + imgModel.options[imgModel.selectedIndex].text;
                }
                
                imgSuccess.style.display = 'block';
            } catch (error) {
                alert('生成图片失败：' + error.message);
            } finally {
                imgLoading.style.display = 'none';
            }
        });
        
        // Download All Images as Zip
        imgDownload.addEventListener('click', async (e) => {
            e.preventDefault();
            if (generatedImages.length === 0) {
                alert('没有可下载的图片！');
                return;
            }
            
            try {
                // Show loading or processing state
                imgDownload.textContent = '正在打包...';
                
                const zip = new JSZip();
                
                // Add all images to zip
                for (const img of generatedImages) {
                    // Extract base64 data from data URL
                    const base64Data = img.data.split(',')[1];
                    zip.file(img.filename, base64Data, { base64: true });
                }
                
                // Generate and download zip
                const zipBlob = await zip.generateAsync({ type: 'blob' });
                const zipUrl = URL.createObjectURL(zipBlob);
                const a = document.createElement('a');
                a.href = zipUrl;
                a.download = \`generated-images-\${Date.now()}.zip\`;
                a.click();
                URL.revokeObjectURL(zipUrl);
                
                imgDownload.textContent = '下载全部';
            } catch (error) {
                imgDownload.textContent = '下载全部';
                alert('打包失败：' + error.message);
            }
        });
    </script>
</body>
</html>`;

// --- KV Helper Functions ---
async function getConfig(env) {
    try {
        const config = await env.AiTool.get('config', 'json');
        return config || {};
    } catch (error) {
        console.error('Error getting config:', error);
        return {};
    }
}

async function saveConfig(env, config) {
    try {
        await env.AiTool.put('config', JSON.stringify(config));
        return true;
    } catch (error) {
        console.error('Error saving config:', error);
        return false;
    }
}

async function getConversationHistory(env) {
    try {
        const history = await env.AiTool.get('conversation_history', 'json');
        return history || [];
    } catch (error) {
        console.error('Error getting conversation history:', error);
        return [];
    }
}

async function saveConversationHistory(env, history) {
    try {
        // 过滤掉超过30天的记录
        const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
        const filteredHistory = history.filter(item => item.timestamp > thirtyDaysAgo);
        await env.AiTool.put('conversation_history', JSON.stringify(filteredHistory));
        return true;
    } catch (error) {
        console.error('Error saving conversation history:', error);
        return false;
    }
}

// --- Worker Handler ---
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        
        if (url.pathname === '/' || url.pathname === '/index.html') {
            return new Response(HTML_CONTENT, {
                headers: {
                    'content-type': 'text/html; charset=utf-8',
                    'cache-control': 'public, max-age=3600'
                }
            });
        }
        
        // --- Password verification helper ---
        function verifyPassword(path, env) {
            const pathParts = path.split('/');
            if (pathParts.length >= 4) {
                const password = decodeURIComponent(pathParts[3]);
                if (password === env.PASSWORD) {
                    return true;
                }
            }
            return false;
        }
        
        function getApiPath(path) {
            const pathParts = path.split('/');
            if (pathParts.length >= 4) {
                return '/' + pathParts.slice(0, 3).join('/');
            }
            return path;
        }
        
        // 配置管理API - 带密码保护
        if (url.pathname.startsWith('/api/config/')) {
            if (!verifyPassword(url.pathname, env)) {
                return new Response(JSON.stringify({ error: 'Invalid password' }), {
                    status: 401,
                    headers: { 'content-type': 'application/json' }
                });
            }
            
            if (request.method === 'GET') {
                try {
                    const config = await getConfig(env);
                    return new Response(JSON.stringify(config), {
                        headers: { 'content-type': 'application/json' }
                    });
                } catch (error) {
                    return new Response(JSON.stringify({ error: 'Failed to get config' }), {
                        status: 500,
                        headers: { 'content-type': 'application/json' }
                    });
                }
            }
            if (request.method === 'POST') {
                try {
                    const config = await request.json();
                    await saveConfig(env, config);
                    return new Response(JSON.stringify({ success: true }), {
                        headers: { 'content-type': 'application/json' }
                    });
                } catch (error) {
                    return new Response(JSON.stringify({ error: 'Failed to save config' }), {
                        status: 500,
                        headers: { 'content-type': 'application/json' }
                    });
                }
            }
            return new Response('Method Not Allowed', { status: 405 });
        }
        
        // 对话历史API - 带密码保护
        if (url.pathname.startsWith('/api/conversation/')) {
            if (!verifyPassword(url.pathname, env)) {
                return new Response(JSON.stringify({ error: 'Invalid password' }), {
                    status: 401,
                    headers: { 'content-type': 'application/json' }
                });
            }
            
            if (request.method === 'GET') {
                try {
                    const history = await getConversationHistory(env);
                    return new Response(JSON.stringify(history), {
                        headers: { 'content-type': 'application/json' }
                    });
                } catch (error) {
                    return new Response(JSON.stringify({ error: 'Failed to get history' }), {
                        status: 500,
                        headers: { 'content-type': 'application/json' }
                    });
                }
            }
            if (request.method === 'POST') {
                try {
                    const { id, name, conversation } = await request.json();
                    const history = await getConversationHistory(env);
                    
                    if (id) {
                        // 更新现有对话
                        const index = history.findIndex(item => item.id === id);
                        if (index !== -1) {
                            history[index] = {
                                ...history[index],
                                timestamp: Date.now(),
                                conversation,
                                name: name || history[index].name
                            };
                        }
                        await saveConversationHistory(env, history);
                        return new Response(JSON.stringify({ success: true, id }), {
                            headers: { 'content-type': 'application/json' }
                        });
                    } else {
                        // 创建新对话
                        const newItem = {
                            id: Date.now().toString(),
                            timestamp: Date.now(),
                            conversation,
                            name: name || ''
                        };
                        history.unshift(newItem);
                        await saveConversationHistory(env, history);
                        return new Response(JSON.stringify({ success: true, id: newItem.id }), {
                            headers: { 'content-type': 'application/json' }
                        });
                    }
                } catch (error) {
                    return new Response(JSON.stringify({ error: 'Failed to save history' }), {
                        status: 500,
                        headers: { 'content-type': 'application/json' }
                    });
                }
            }
            if (request.method === 'PUT') {
                try {
                    const { id, name } = await request.json();
                    const history = await getConversationHistory(env);
                    const index = history.findIndex(item => item.id === id);
                    if (index !== -1) {
                        history[index] = {
                            ...history[index],
                            name: name,
                            timestamp: Date.now()
                        };
                        await saveConversationHistory(env, history);
                    }
                    return new Response(JSON.stringify({ success: true }), {
                        headers: { 'content-type': 'application/json' }
                    });
                } catch (error) {
                    return new Response(JSON.stringify({ error: 'Failed to update history' }), {
                        status: 500,
                        headers: { 'content-type': 'application/json' }
                    });
                }
            }
            if (request.method === 'DELETE') {
                try {
                    const { id } = await request.json();
                    const history = await getConversationHistory(env);
                    const filteredHistory = history.filter(item => item.id !== id);
                    await saveConversationHistory(env, filteredHistory);
                    return new Response(JSON.stringify({ success: true }), {
                        headers: { 'content-type': 'application/json' }
                    });
                } catch (error) {
                    return new Response(JSON.stringify({ error: 'Failed to delete history' }), {
                        status: 500,
                        headers: { 'content-type': 'application/json' }
                    });
                }
            }
            return new Response('Method Not Allowed', { status: 405 });
        }
        
        if (url.pathname.startsWith('/api/chat/')) {
            if (!verifyPassword(url.pathname, env)) {
                return new Response(JSON.stringify({ error: 'Invalid password' }), {
                    status: 401,
                    headers: { 'content-type': 'application/json' }
                });
            }
            
            if (request.method === 'POST') {
                return handleChatRequest(request, env);
            }
            return new Response('Method Not Allowed', { status: 405 });
        }
        
        if (url.pathname.startsWith('/api/image/')) {
            if (!verifyPassword(url.pathname, env)) {
                return new Response(JSON.stringify({ error: 'Invalid password' }), {
                    status: 401,
                    headers: { 'content-type': 'application/json' }
                });
            }
            
            if (request.method === 'POST') {
                return handleImageRequest(request, env);
            }
            return new Response('Method Not Allowed', { status: 405 });
        }
        
        if (url.pathname.startsWith('/api/tts/')) {
            if (!verifyPassword(url.pathname, env)) {
                return new Response(JSON.stringify({ error: 'Invalid password' }), {
                    status: 401,
                    headers: { 'content-type': 'application/json' }
                });
            }
            
            if (request.method === 'POST') {
                return handleTtsRequest(request, env);
            }
            return new Response('Method Not Allowed', { status: 405 });
        }
        
        if (url.pathname.startsWith('/api/stt/')) {
            if (!verifyPassword(url.pathname, env)) {
                return new Response(JSON.stringify({ error: 'Invalid password' }), {
                    status: 401,
                    headers: { 'content-type': 'application/json' }
                });
            }
            
            if (request.method === 'POST') {
                return handleSttRequest(request, env);
            }
            return new Response('Method Not Allowed', { status: 405 });
        }
        
        return new Response('Not Found', { status: 404 });
    },
};

// --- Chat Handler ---
async function handleChatRequest(request, env) {
    try {
        const body = await request.json();
        const messages = body.messages || [];
        const apiMode = body.apiMode || 'workers';
        const systemPrompt = body.systemPrompt || DEFAULT_SYSTEM_PROMPT;
        
        if (!messages.some(msg => msg.role === 'system')) {
            messages.unshift({ role: 'system', content: systemPrompt });
        }
        
        let stream;
        
        if (apiMode === 'workers') {
            const model = body.model || DEFAULT_CHAT_MODEL;
            stream = await env.AI.run(model, {
                messages,
                max_tokens: 1024,
                stream: true
            });
        } else {
            const apiUrl = body.apiUrl;
            const apiKey = body.apiKey;
            const model = body.model;
            
            if (!apiUrl || !apiKey || !model) {
                throw new Error('External API configuration incomplete');
            }
            
            stream = await callExternalApi(apiUrl, apiKey, model, messages);
        }
        
        return new Response(stream, {
            headers: {
                'content-type': 'text/event-stream; charset=utf-8',
                'cache-control': 'no-cache',
                'connection': 'keep-alive'
            }
        });
    } catch (error) {
        console.error('Error handling chat request:', error);
        return new Response(
            JSON.stringify({ error: 'Failed to handle request', message: error.message }),
            {
                status: 500,
                headers: { 'content-type': 'application/json' }
            }
        );
    }
}

// --- Image Handler ---
async function handleImageRequest(request, env) {
    try {
        const body = await request.json();
        const selectedModel = AVAILABLE_MODELS.find(m => m.id === body.model);
        if (!selectedModel) {
            return new Response(JSON.stringify({ error: 'Invalid model' }), {
                status: 400,
                headers: { 'content-type': 'application/json' }
            });
        }
        
        const model = selectedModel.key;
        const numOutputs = Math.max(1, Math.min(8, parseInt(body.num_outputs) || 1));
        const clamp = (val, min, max) => Math.max(min, Math.min(max, val));
        const sanitizeDimension = (val, def = 512) => {
            let v = typeof val === 'number' ? val : def;
            v = clamp(v, 256, 2048);
            v = Math.round(v / 64) * 64;
            return v;
        };
        
        const promptEn = await translateToEnglishIfNeeded(body.prompt || '', env);
        
        const generateSingleImage = async (seedOffset = 0) => {
            let inputs = {};
            const baseSeed = body.seed || Math.floor(Math.random() * 1000000);
            const currentSeed = baseSeed + seedOffset;
            
            if (body.model === 'flux-1-schnell') {
                let steps = body.num_steps || 6;
                if (steps >= 8) steps = 8;
                else if (steps <= 4) steps = 4;
                inputs = { 
                    prompt: promptEn, 
                    steps,
                    height: sanitizeDimension(parseInt(body.height), 1024),
                    width: sanitizeDimension(parseInt(body.width), 1024),
                    guidance: clamp(parseFloat(body.guidance) || 4.0, 0.0, 30.0)
                };
            } else if (body.model === 'stable-diffusion-v1-5-img2img' || body.model === 'stable-diffusion-v1-5-inpainting') {
                if (!body.image_url) {
                    throw new Error('Image URL required');
                }
                
                const fetchImageToBytes = async (url, label) => {
                    const resp = await fetch(url);
                    if (!resp.ok) {
                        throw new Error(`${label} fetch failed, HTTP ${resp.status}`);
                    }
                    const bytes = new Uint8Array(await resp.arrayBuffer());
                    return bytes;
                };
                
                const imageBytes = await fetchImageToBytes(body.image_url, 'Input image');
                
                let maskBytes = undefined;
                if (body.model === 'stable-diffusion-v1-5-inpainting') {
                    if (!body.mask_url) {
                        throw new Error('Mask URL required');
                    }
                    maskBytes = await fetchImageToBytes(body.mask_url, 'Mask image');
                }
                
                inputs = {
                    prompt: promptEn,
                    height: sanitizeDimension(parseInt(body.height), 512),
                    width: sanitizeDimension(parseInt(body.width), 512),
                    num_steps: clamp(parseInt(body.num_steps) || 20, 1, 50),
                    guidance: clamp(parseFloat(body.guidance) || 7.5, 0.0, 30.0),
                    seed: currentSeed,
                    image: [...imageBytes],
                    ...(maskBytes ? { mask: [...maskBytes], mask_image: [...maskBytes] } : {})
                };
            } else {
                inputs = {
                    prompt: promptEn,
                    height: sanitizeDimension(parseInt(body.height), 1024),
                    width: sanitizeDimension(parseInt(body.width), 1024),
                    num_steps: clamp(parseInt(body.num_steps) || 20, 1, 50),
                    guidance: clamp(parseFloat(body.guidance) || 7.5, 0.0, 30.0),
                    seed: currentSeed,
                };
            }
            
            const result = await env.AI.run(model, inputs);
            
            if (body.model === 'flux-1-schnell') {
                if (result && result.image) {
                    const binaryString = atob(result.image);
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }
                    return bytes;
                }
            }
            
            if (result instanceof Uint8Array) {
                return result;
            } else if (result && result.byteLength !== undefined) {
                return new Uint8Array(result);
            } else {
                return new Uint8Array(await new Response(result).arrayBuffer());
            }
        };
        
        const bytesToBase64 = (bytes) => {
            let binary = '';
            const chunkSize = 0x8000;
            for (let i = 0; i < bytes.length; i += chunkSize) {
                const sub = bytes.subarray(i, i + chunkSize);
                binary += String.fromCharCode.apply(null, sub);
            }
            return btoa(binary);
        };
        
        console.log('Generating image(s) with model:', model, 'count:', numOutputs);
        
        try {
            if (numOutputs === 1) {
                const result = await generateSingleImage(0);
                return new Response(result, {
                    headers: { 'content-type': 'image/png' }
                });
            } else {
                const images = [];
                for (let i = 0; i < numOutputs; i++) {
                    const result = await generateSingleImage(i);
                    images.push(`data:image/png;base64,${bytesToBase64(result)}`);
                }
                return new Response(JSON.stringify({ images }), {
                    headers: { 'content-type': 'application/json' }
                });
            }
        } catch (aiError) {
            console.error('AI generation error:', aiError);
            return new Response(
                JSON.stringify({ error: 'Image generation failed', message: aiError?.message || String(aiError) }),
                {
                    status: 500,
                    headers: { 'content-type': 'application/json' }
                }
            );
        }
    } catch (error) {
        console.error('Error handling image request:', error);
        return new Response(
            JSON.stringify({ error: 'Failed to handle request', message: error.message }),
            {
                status: 500,
                headers: { 'content-type': 'application/json' }
            }
        );
    }
}

// --- TTS Handler ---
async function handleTtsRequest(request, env) {
    try {
        const contentType = request.headers.get("content-type") || "";
        
        if (contentType.includes("multipart/form-data")) {
            return await handleFileUpload(request);
        }
        
        const body = await request.json();
        const {
            text,
            voice = "zh-CN-XiaoxiaoNeural",
            speed = '1.0',
            volume = '0',
            pitch = '0',
            style = "general"
        } = body;

        let rate = parseInt(String((parseFloat(speed) - 1.0) * 100));
        let numVolume = parseInt(String(parseFloat(volume) * 100));
        let numPitch = parseInt(pitch);
        return await getVoice(
            text,
            voice,
            rate >= 0 ? `+${rate}%` : `${rate}%`,
            numPitch >= 0 ? `+${numPitch}Hz` : `${numPitch}Hz`,
            numVolume >= 0 ? `+${numVolume}%` : `${numVolume}%`,
            style,
            "audio-24khz-48kbitrate-mono-mp3"
        );
    } catch (error) {
        console.error("Error:", error);
        return new Response(JSON.stringify({
            error: {
                message: error.message,
                type: "api_error",
                param: null,
                code: "edge_tts_error"
            }
        }), {
            status: 500,
            headers: { 'content-type': 'application/json', ...makeCORSHeaders() }
        });
    }
}

// --- STT Handler ---
async function handleSttRequest(request, env) {
    try {
        if (request.method !== 'POST') {
            return new Response(JSON.stringify({
                error: {
                    message: "只支持 POST 方法",
                    type: "invalid_request_error",
                    param: "method",
                    code: "method_not_allowed"
                }
            }), {
                status: 405,
                headers: { 'content-type': 'application/json', ...makeCORSHeaders() }
            });
        }

        const contentType = request.headers.get("content-type") || "";
        if (!contentType.includes("multipart/form-data")) {
            return new Response(JSON.stringify({
                error: {
                    message: "请求必须使用 multipart/form-data 格式",
                    type: "invalid_request_error",
                    param: "content-type",
                    code: "invalid_content_type"
                }
            }), {
                status: 400,
                headers: { 'content-type': 'application/json', ...makeCORSHeaders() }
            });
        }

        const formData = await request.formData();
        const audioFile = formData.get('audio') || formData.get('file');
        const customToken = formData.get('token');

        if (!audioFile) {
            return new Response(JSON.stringify({
                error: {
                    message: "未找到音频文件",
                    type: "invalid_request_error",
                    param: "file",
                    code: "missing_file"
                }
            }), {
                status: 400,
                headers: { 'content-type': 'application/json', ...makeCORSHeaders() }
            });
        }

        if (audioFile.size > 10 * 1024 * 1024) {
            return new Response(JSON.stringify({
                error: {
                    message: "音频文件大小不能超过 10MB",
                    type: "invalid_request_error",
                    param: "file",
                    code: "file_too_large"
                }
            }), {
                status: 400,
                headers: { 'content-type': 'application/json', ...makeCORSHeaders() }
            });
        }

        const allowedTypes = [
            'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/m4a', 'audio/flac', 'audio/aac',
            'audio/ogg', 'audio/webm', 'audio/amr', 'audio/3gpp'
        ];
        
        const isValidType = allowedTypes.some(type => 
            (audioFile.type && audioFile.type.includes(type)) || 
            (audioFile.name && audioFile.name.toLowerCase().match(/\.(mp3|wav|m4a|flac|aac|ogg|webm|amr|3gp)$/i))
        );

        if (!isValidType) {
            return new Response(JSON.stringify({
                error: {
                    message: "不支持的音频文件格式，请上传 mp3, wav, m4a, flac, aac, ogg, webm, amr 或 3gp 格式的文件",
                    type: "invalid_request_error",
                    param: "file",
                    code: "invalid_file_type"
                }
            }), {
                status: 400,
                headers: { 'content-type': 'application/json', ...makeCORSHeaders() }
            });
        }

        const token = customToken;
        
        if (!token) {
            return new Response(JSON.stringify({
                error: {
                    message: "请在配置中设置 API Token",
                    type: "invalid_request_error",
                    param: "token",
                    code: "missing_token"
                }
            }), {
                status: 400,
                headers: { 'content-type': 'application/json', ...makeCORSHeaders() }
            });
        }

        const apiFormData = new FormData();
        apiFormData.append('file', audioFile);
        apiFormData.append('model', 'FunAudioLLM/SenseVoiceSmall');

        const apiResponse = await fetch('https://api.siliconflow.cn/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: apiFormData
        });

        if (!apiResponse.ok) {
            const errorText = await apiResponse.text();
            console.error('硅基流动 API 错误:', apiResponse.status, errorText);
            
            let errorMessage = '语音转录服务暂时不可用';
            
            if (apiResponse.status === 401) {
                errorMessage = 'API Token 无效，请检查您的配置';
            } else if (apiResponse.status === 429) {
                errorMessage = '请求过于频繁，请稍后再试';
            } else if (apiResponse.status === 413) {
                errorMessage = '音频文件太大，请选择较小的文件';
            }

            return new Response(JSON.stringify({
                error: {
                    message: errorMessage,
                    type: "api_error",
                    param: null,
                    code: "transcription_api_error"
                }
            }), {
                status: apiResponse.status,
                headers: { 'content-type': 'application/json', ...makeCORSHeaders() }
            });
        }

        const transcriptionResult = await apiResponse.json();
        return new Response(JSON.stringify(transcriptionResult), {
            headers: { 'content-type': 'application/json', ...makeCORSHeaders() }
        });
    } catch (error) {
        console.error("语音转录处理失败:", error);
        return new Response(JSON.stringify({
            error: {
                message: "语音转录处理失败",
                type: "api_error",
                param: null,
                code: "transcription_processing_error"
            }
        }), {
            status: 500,
            headers: { 'content-type': 'application/json', ...makeCORSHeaders() }
        });
    }
}

// --- TTS Helper Functions ---
async function handleFileUpload(request) {
    try {
        const formData = await request.formData();
        const file = formData.get('file');
        const voice = formData.get('voice') || 'zh-CN-XiaoxiaoNeural';
        const speed = formData.get('speed') || '1.0';
        const volume = formData.get('volume') || '0';
        const pitch = formData.get('pitch') || '0';
        const style = formData.get('style') || 'general';

        if (!file) {
            return new Response(JSON.stringify({
                error: {
                    message: "未找到上传的文件",
                    type: "invalid_request_error",
                    param: "file",
                    code: "missing_file"
                }
            }), {
                status: 400,
                headers: { 'content-type': 'application/json', ...makeCORSHeaders() }
            });
        }

        if (!file.type.includes('text/') && !file.name.toLowerCase().endsWith('.txt')) {
            return new Response(JSON.stringify({
                error: {
                    message: "不支持的文件类型，请上传 txt 文件",
                    type: "invalid_request_error",
                    param: "file",
                    code: "invalid_file_type"
                }
            }), {
                status: 400,
                headers: { 'content-type': 'application/json', ...makeCORSHeaders() }
            });
        }

        if (file.size > 500 * 1024) {
            return new Response(JSON.stringify({
                error: {
                    message: "文件大小超过限制（最大 500KB）",
                    type: "invalid_request_error",
                    param: "file",
                    code: "file_too_large"
                }
            }), {
                status: 400,
                headers: { 'content-type': 'application/json', ...makeCORSHeaders() }
            });
        }

        const text = await file.text();
        
        if (!text.trim()) {
            return new Response(JSON.stringify({
                error: {
                    message: "文件内容为空",
                    type: "invalid_request_error",
                    param: "file",
                    code: "empty_file"
                }
            }), {
                status: 400,
                headers: { 'content-type': 'application/json', ...makeCORSHeaders() }
            });
        }

        if (text.length > 10000) {
            return new Response(JSON.stringify({
                error: {
                    message: "文本内容过长（最大 10000 字符）",
                    type: "invalid_request_error",
                    param: "file",
                    code: "text_too_long"
                }
            }), {
                status: 400,
                headers: { 'content-type': 'application/json', ...makeCORSHeaders() }
            });
        }

        let rate = parseInt(String((parseFloat(speed) - 1.0) * 100));
        let numVolume = parseInt(String(parseFloat(volume) * 100));
        let numPitch = parseInt(pitch);

        return await getVoice(
            text,
            voice,
            rate >= 0 ? `+${rate}%` : `${rate}%`,
            numPitch >= 0 ? `+${numPitch}Hz` : `${numPitch}Hz`,
            numVolume >= 0 ? `+${numVolume}%` : `${numVolume}%`,
            style,
            "audio-24khz-48kbitrate-mono-mp3"
        );
    } catch (error) {
        console.error("文件上传处理失败:", error);
        return new Response(JSON.stringify({
            error: {
                message: "文件处理失败",
                type: "api_error",
                param: null,
                code: "file_processing_error"
            }
        }), {
            status: 500,
            headers: { 'content-type': 'application/json', ...makeCORSHeaders() }
        });
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function optimizedTextSplit(text, maxChunkSize = 1500) {
    const chunks = [];
    const sentences = text.split(/[。！？\n]/);
    let currentChunk = '';
    
    for (const sentence of sentences) {
        const trimmedSentence = sentence.trim();
        if (!trimmedSentence) continue;
        
        if (trimmedSentence.length > maxChunkSize) {
            if (currentChunk) {
                chunks.push(currentChunk.trim());
                currentChunk = '';
            }
            
            for (let i = 0; i < trimmedSentence.length; i += maxChunkSize) {
                chunks.push(trimmedSentence.slice(i, i + maxChunkSize));
            }
        } else if ((currentChunk + trimmedSentence).length > maxChunkSize) {
            if (currentChunk) {
                chunks.push(currentChunk.trim());
            }
            currentChunk = trimmedSentence;
        } else {
            currentChunk += (currentChunk ? '。' : '') + trimmedSentence;
        }
    }
    
    if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
    }
    
    return chunks.filter(chunk => chunk.length > 0);
}

async function processBatchedAudioChunks(chunks, voiceName, rate, pitch, volume, style, outputFormat, batchSize = 3, delayMs = 1000) {
    const audioChunks = [];
    
    for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        const batchPromises = batch.map(async (chunk, index) => {
            try {
                if (index > 0) {
                    await delay(index * 200);
                }
                return await getAudioChunk(chunk, voiceName, rate, pitch, volume, style, outputFormat);
            } catch (error) {
                console.error(`处理音频块失败 (批次 ${Math.floor(i/batchSize) + 1}, 块 ${index + 1}):`, error);
                throw error;
            }
        });
        
        try {
            const batchResults = await Promise.all(batchPromises);
            audioChunks.push(...batchResults);
            
            if (i + batchSize < chunks.length) {
                await delay(delayMs);
            }
        } catch (error) {
            console.error(`批次处理失败:`, error);
            throw error;
        }
    }
    
    return audioChunks;
}

async function getVoice(text, voiceName = "zh-CN-XiaoxiaoNeural", rate = '+0%', pitch = '+0Hz', volume = '+0%', style = "general", outputFormat = "audio-24khz-48kbitrate-mono-mp3") {
    try {
        const cleanText = text.trim();
        if (!cleanText) {
            throw new Error("文本内容为空");
        }
        
        if (cleanText.length <= 1500) {
            const audioBlob = await getAudioChunk(cleanText, voiceName, rate, pitch, volume, style, outputFormat);
            return new Response(audioBlob, {
                headers: { 'content-type': 'audio/mpeg', ...makeCORSHeaders() }
            });
        }

        const chunks = optimizedTextSplit(cleanText, 1500);
        
        if (chunks.length > 40) {
            throw new Error(`文本过长，分块数量(${chunks.length})超过限制。请缩短文本或分批处理。`);
        }
        
        console.log(`文本已分为 ${chunks.length} 个块进行处理`);

        const audioChunks = await processBatchedAudioChunks(
            chunks, 
            voiceName, 
            rate, 
            pitch, 
            volume, 
            style, 
            outputFormat,
            3,
            800
        );

        const concatenatedAudio = new Blob(audioChunks, { type: 'audio/mpeg' });
        return new Response(concatenatedAudio, {
            headers: { 'content-type': 'audio/mpeg', ...makeCORSHeaders() }
        });
    } catch (error) {
        console.error("语音合成失败:", error);
        return new Response(JSON.stringify({
            error: {
                message: error.message || String(error),
                type: "api_error",
                param: `${voiceName}, ${rate}, ${pitch}, ${volume}, ${style}, ${outputFormat}`,
                code: "edge_tts_error"
            }
        }), {
            status: 500,
            headers: { 'content-type': 'application/json', ...makeCORSHeaders() }
        });
    }
}

async function getAudioChunk(text, voiceName, rate, pitch, volume, style, outputFormat = 'audio-24khz-48kbitrate-mono-mp3', maxRetries = 3) {
    const retryDelay = 500;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const endpoint = await getEndpoint();
            const url = `https://${endpoint.r}.tts.speech.microsoft.com/cognitiveservices/v1`;
            
            let m = text.match(/\[(\d+)\]\s*?$/);
            let slien = 0;
            if (m && m.length == 2) {
                slien = parseInt(m[1]);
                text = text.replace(m[0], '');
            }
            
            if (!text.trim()) {
                throw new Error("文本块为空");
            }
            
            if (text.length > 2000) {
                throw new Error(`文本块过长: ${text.length} 字符，最大支持 2000 字符`);
            }
            
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Authorization": endpoint.t,
                    "Content-Type": "application/ssml+xml",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 Edg/127.0.0.0",
                    "X-Microsoft-OutputFormat": outputFormat
                },
                body: getSsml(text, voiceName, rate, pitch, volume, style, slien)
            });

            if (!response.ok) {
                const errorText = await response.text();
                
                if (response.status === 429) {
                    if (attempt < maxRetries) {
                        console.log(`频率限制，第${attempt + 1}次重试，等待${retryDelay * (attempt + 1)}ms`);
                        await delay(retryDelay * (attempt + 1));
                        continue;
                    }
                    throw new Error(`请求频率过高，已重试${maxRetries}次仍失败`);
                } else if (response.status >= 500) {
                    if (attempt < maxRetries) {
                        console.log(`服务器错误，第${attempt + 1}次重试，等待${retryDelay * (attempt + 1)}ms`);
                        await delay(retryDelay * (attempt + 1));
                        continue;
                    }
                    throw new Error(`Edge TTS 服务器错误: ${response.status} ${errorText}`);
                } else {
                    throw new Error(`Edge TTS API 错误: ${response.status} ${errorText}`);
                }
            }

            return await response.blob();
        } catch (error) {
            if (attempt === maxRetries) {
                throw new Error(`音频生成失败（已重试${maxRetries}次）: ${error.message}`);
            }
            
            if (error.message.includes('fetch') || error.message.includes('network')) {
                console.log(`网络错误，第${attempt + 1}次重试，等待${retryDelay * (attempt + 1)}ms`);
                await delay(retryDelay * (attempt + 1));
                continue;
            }
            
            throw error;
        }
    }
}

function escapeXmlText(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function getSsml(text, voiceName, rate, pitch, volume, style, slien = 0) {
    const escapedText = escapeXmlText(text);
    
    let slienStr = '';
    if (slien > 0) {
        slienStr = `<break time="${slien}ms" />`;
    }
    return `<speak xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" version="1.0" xml:lang="zh-CN"> 
                <voice name="${voiceName}"> 
                    <mstts:express-as style="${style}" styledegree="2.0" role="default"> 
                        <prosody rate="${rate}" pitch="${pitch}" volume="${volume}">${escapedText}</prosody> 
                    </mstts:express-as> 
                    ${slienStr}
                </voice> 
            </speak>`;
}

async function getEndpoint() {
    const now = Date.now() / 1000;

    if (tokenInfo.token && tokenInfo.expiredAt && now < tokenInfo.expiredAt - TOKEN_REFRESH_BEFORE_EXPIRY) {
        return tokenInfo.endpoint;
    }

    const endpointUrl = "https://dev.microsofttranslator.com/apps/endpoint?api-version=1.0";
    const clientId = crypto.randomUUID().replace(/-/g, "");

    try {
        const response = await fetch(endpointUrl, {
            method: "POST",
            headers: {
                "Accept-Language": "zh-Hans",
                "X-ClientVersion": "4.0.530a 5fe1dc6c",
                "X-UserId": "0f04d16a175c411e",
                "X-HomeGeographicRegion": "zh-Hans-CN",
                "X-ClientTraceId": clientId,
                "X-MT-Signature": await sign(endpointUrl),
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 Edg/127.0.0.0",
                "Content-Type": "application/json; charset=utf-8",
                "Content-Length": "0",
                "Accept-Encoding": "gzip"
            }
        });

        if (!response.ok) {
            throw new Error(`获取 endpoint 失败: ${response.status}`);
        }

        const data = await response.json();
        const jwt = data.t.split(".")[1];
        const decodedJwt = JSON.parse(atob(jwt));

        tokenInfo = {
            endpoint: data,
            token: data.t,
            expiredAt: decodedJwt.exp
        };

        return data;
    } catch (error) {
        console.error("获取 endpoint 失败:", error);
        if (tokenInfo.token) {
            console.log("使用过期的缓存 token");
            return tokenInfo.endpoint;
        }
        throw error;
    }
}

function makeCORSHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
        'Access-Control-Max-Age': '86400'
    };
}

async function hmacSha256(key, data) {
    const cryptoKey = await crypto.subtle.importKey(
        "raw",
        key,
        { name: "HMAC", hash: { name: "SHA-256" } },
        false,
        ["sign"]
    );
    const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
    return new Uint8Array(signature);
}

async function base64ToBytes(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

async function bytesToBase64(bytes) {
    return btoa(String.fromCharCode.apply(null, bytes));
}

function uuid() {
    return crypto.randomUUID().replace(/-/g, "");
}

async function sign(urlStr) {
    const url = urlStr.split("://")[1];
    const encodedUrl = encodeURIComponent(url);
    const uuidStr = uuid();
    const formattedDate = dateFormat();
    const bytesToSign = `MSTranslatorAndroidApp${encodedUrl}${formattedDate}${uuidStr}`.toLowerCase();
    const decode = await base64ToBytes("oik6PdDdMnOXemTbwvMn9de/h9lFnfBaCWbGMMZqqoSaQaqUOqjVGm5NqsmjcBI1x+sS9ugjB55HEJWRiFXYFw==");
    const signData = await hmacSha256(decode, bytesToSign);
    const signBase64 = await bytesToBase64(signData);
    return `MSTranslatorAndroidApp::${signBase64}::${formattedDate}::${uuidStr}`;
}

function dateFormat() {
    const formattedDate = (new Date()).toUTCString().replace(/GMT/, "").trim() + " GMT";
    return formattedDate.toLowerCase();
}
