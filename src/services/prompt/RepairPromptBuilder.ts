import type { DeviceInfo, ParsedTraceback } from '../../types'
import { boardDefinitions, identifyBoard, identifySoc, isBoardId } from '../../config/boards'
import type { Locale } from '../../i18n/types'
import { appMessages } from '../../i18n/appMessages'
import { serviceMessages } from '../../i18n/serviceMessages'
import { createWorkshopContext, type WorkshopContext } from './WorkshopRules'

const sensitive = /(?:password|passwd|pswd|api_key|token|secret|ssid)\s*=\s*[^\n#]+/i
export const hasSensitiveAssignments = (source: string) => sensitive.test(source)

function metadata(locale: Locale, value: string) {
  if (locale === 'ja') return value
  return serviceMessages[value]?.[locale] ?? appMessages[value]?.[locale] ?? value
}

// Translate only application sentinels; actual device values and captured payloads stay verbatim.
const deviceValue = (locale: Locale, value: string) => value === '未接続' || value === '未取得' ? metadata(locale, value) : value

function fenced(value: string, language = '') {
  let length = 3
  for (const run of value.matchAll(/~+/g)) length = Math.max(length, run[0].length + 1)
  const fence = '~'.repeat(length)
  return `${fence}${language}\n${value}\n${fence}`
}

const copy = {
  ja: {
    intro: 'あなたはM5Stack {board}向けMicroPythonのデバッグ担当です。日本語で回答してください。原因を分析し、以下の設定と修正条件に従って対処を示してください。SoCだけから機種を推測しないでください。',
    knownError: '以下のmain.pyに関する操作でエラーが発生しました。',
    unknownError: '機器の通信操作でエラーが発生しました。',
    environment: '実行環境（機器からの取得情報）', device: '機器', detected: '確認できた機種', firmware: 'ファームウェア情報', unknown: '未確認', unavailable: '未取得',
    execution: '実行方法: ブラウザのWeb Serial APIからRaw REPLを使用してmain.pyを書込み、実行\n取得したMicroPython版から講師設定の対象UIFlow2版を推測しないでください。',
    stage: 'エラー発生ステージ', error: 'エラー', type: '種類', message: 'メッセージ', log: '関連するシリアルログ',
    knownSource: 'エラーに対応するmain.py（操作時のスナップショット）',
    unknownSource: 'エラーに対応するmain.py\n機器で実行されたmain.pyは未取得です。編集中コードをエラーが起きたコードとして扱わないでください。この機器の実行コードと選択教材の対応は未確認で、教材設定はブラウザ側の参考情報です。',
    workshop: '操作時のワークショップ設定',
    invalid: '設定が未設定または不正です。次の項目を講師が修正するまで、不足値を推測せず、教材に適合した修正版として確定しないでください。',
    mismatch: '選択教材と取得した機器の種類が一致しません。講師が機種と配線を確認するまでGPIOに依存する修正版を確定しないでください。',
    constraints: '修正条件',
    rules: '- CPython専用APIではなくMicroPythonで動作させる\n- 上記の対象機器・SoCで利用可能と確認できたAPIを使う。M5NanoC6はESP32-C6、AtomS3LiteはESP32-S3。ESP32-S3だけでAtomS3Liteと断定しない\n- 存在が確認できないライブラリを勝手に仮定しない\n- 使用するGPIO番号や周辺機器の前提を明記する。内蔵LED・ボタンのピン番号は機種ごとに異なる\n- 無限ループには適切なsleep_ms()を入れる\n- Ctrl-Cによる停止を極力妨げない\n- エラー原因を簡潔に説明する',
    blocked: '教材設定が不正または未完成、または機器が不一致のため、設定に依存する修正版の生成は保留し、講師が確認する項目を示す',
    complete: '対応するコードがある場合、修正後の完全なmain.pyを1つのPythonコードブロックで出力する',
    evidence: '静的確認と実機確認を区別し、実機未確認のコードを実機確認済みとしない',
  },
  en: {
    intro: 'You are a MicroPython debugging assistant for M5Stack {board}. Respond in English. Analyze the cause and propose a remedy following the settings and repair constraints below. Do not infer the exact board solely from its SoC.',
    knownError: 'An error occurred during an operation involving the following main.py.',
    unknownError: 'An error occurred during a device communication operation.',
    environment: 'Runtime environment (information retrieved from the device)', device: 'Device', detected: 'Detected board', firmware: 'Firmware information', unknown: 'Unconfirmed', unavailable: 'Not retrieved',
    execution: 'Execution: write and run main.py through Raw REPL using the browser Web Serial API.\nDo not infer the instructor-configured target UIFlow2 version from the retrieved MicroPython version.',
    stage: 'Stage where the error occurred', error: 'Error', type: 'Type', message: 'Message', log: 'Related serial log',
    knownSource: 'main.py associated with this error (operation snapshot)',
    unknownSource: 'main.py associated with this error\nThe main.py executed on the device has not been retrieved. Do not treat the current editor as the failing program. Its relationship with the selected workshop is unconfirmed; workshop settings are browser-side reference information.',
    workshop: 'Workshop settings at the operation',
    invalid: 'Settings are missing or invalid. Do not guess values or finalize a kit-compatible repair until the instructor resolves the following.',
    mismatch: 'The selected kit and detected board do not match. Do not finalize GPIO-dependent repairs until the instructor verifies the board and wiring.',
    constraints: 'Repair constraints',
    rules: '- Use MicroPython, not CPython-only APIs.\n- Use APIs verified for the target board and SoC above. M5NanoC6 uses ESP32-C6; AtomS3Lite uses ESP32-S3. ESP32-S3 alone does not identify AtomS3Lite.\n- Do not assume unverified libraries.\n- State GPIO assignments and peripheral assumptions explicitly. Onboard LED and button pins differ between boards.\n- Include appropriate sleep_ms() calls in infinite loops.\n- Avoid obstructing Ctrl-C.\n- Explain the cause briefly.',
    blocked: 'Defer setting-dependent corrected code until the instructor resolves invalid settings or board mismatch; list what needs confirmation.',
    complete: 'When the corresponding source is available, output the complete corrected main.py in one Python code block.',
    evidence: 'Distinguish static checks from hardware tests; never label untested code hardware-verified.',
  },
  zh: {
    intro: '你是 M5Stack {board} 的 MicroPython 调试助手，请用简体中文回答。按照下方设置和修复条件分析原因并提供解决方案，不能仅凭 SoC 推测设备型号。',
    knownError: '在与下方 main.py 相关的操作中发生了错误。',
    unknownError: '设备通信操作发生了错误。',
    environment: '运行环境（从设备获取的信息）', device: '设备', detected: '已识别型号', firmware: '固件信息', unknown: '未确认', unavailable: '未获取',
    execution: '运行方式: 通过浏览器 Web Serial API 的 Raw REPL 写入并运行 main.py。\n不要根据读取的 MicroPython 版本推测讲师设置的目标 UIFlow2 版本。',
    stage: '错误发生阶段', error: '错误', type: '类型', message: '消息', log: '相关串口日志',
    knownSource: '与错误对应的 main.py（操作时快照）',
    unknownSource: '与错误对应的 main.py\n尚未获取设备实际运行的 main.py。不要将当前编辑区代码视为出错程序。设备运行代码与所选教材的对应关系尚未确认，教材设置仅是浏览器侧参考信息。',
    workshop: '操作时的工作坊设置',
    invalid: '设置缺失或无效。在讲师修正以下项目之前，不要猜测缺失值，也不要确定为适用该套件的修复代码。',
    mismatch: '所选套件与读取到的设备型号不一致。在讲师确认设备和接线之前，不要确定依赖 GPIO 的修复代码。',
    constraints: '修复条件',
    rules: '- 使用 MicroPython，不使用 CPython 专用 API。\n- 使用已在上述目标设备和 SoC 上确认的 API。M5NanoC6 使用 ESP32-C6，AtomS3Lite 使用 ESP32-S3。不能仅凭 ESP32-S3 确认具体设备。\n- 不擅自假设未确认的库存在。\n- 明确 GPIO 和外设前提，各型号的内置 LED 和按钮引脚不同。\n- 无限循环中加入适当的 sleep_ms()。\n- 尽量不妨碍 Ctrl-C 停止。\n- 简短解释错误原因。',
    blocked: '在讲师解决无效设置或设备不一致之前，暂缓依赖设置的修复代码，列出需要确认的项目。',
    complete: '如果已有对应源代码，请在一个 Python 代码块中输出修复后的完整 main.py。',
    evidence: '区分静态检查与实机验证，不能将未在实机验证的代码标为已验证。',
  },
}

export class RepairPromptBuilder {
  build(error: ParsedTraceback, source: string, device: DeviceInfo, terminalLog: string, stage: string, workshop: WorkshopContext | null = null, options: { sourceKnown?: boolean; locale?: Locale } = {}) {
    const locale = options.locale ?? workshop?.locale ?? 'ja'
    const text = copy[locale]
    // Locale may change, but the captured profile/code/device must not change.
    const context = workshop && workshop.locale !== locale ? createWorkshopContext(workshop.profile, locale) : workshop
    const sourceKnown = options.sourceKnown !== false
    const detectedId = isBoardId(device.boardId) ? device.boardId : identifyBoard(device.deviceName)
    const selectedId = context && isBoardId(context.profile.boardId) ? context.profile.boardId : undefined
    const targetId = selectedId ?? detectedId
    const target = targetId ? boardDefinitions[targetId].name : 'M5NanoC6 / AtomS3Lite'
    const mismatch = !!selectedId && !!detectedId && selectedId !== detectedId
    const soc = device.soc ?? identifySoc(`${device.deviceName} ${device.microPythonVersion}`) ?? (detectedId ? boardDefinitions[detectedId].soc : undefined)
    const blocked = !!context?.errors.length || mismatch
    const stageLabel = metadata(locale, stage)
    const stageOutput = stageLabel !== stage && /^[A-Z][A-Z0-9_]*$/.test(stage) ? `${stageLabel} (${stage})` : stageLabel
    const codeSection = sourceKnown ? `## ${text.knownSource}\n${fenced(source, 'python')}` : `## ${text.unknownSource}`
    const workshopSection = context ? `\n\n## ${text.workshop}\n${context.errors.length ? `${text.invalid}\n${context.errors.map(message => `- ${message}`).join('\n')}\n\n` : ''}${context.rules}` : ''
    return `${text.intro.replace('{board}', target)}
${sourceKnown ? text.knownError : text.unknownError}

## ${text.environment}
${text.device}: ${deviceValue(locale, device.deviceName)}
${text.detected}: ${detectedId ? boardDefinitions[detectedId].name : text.unknown}
SoC: ${soc ?? text.unknown}
MicroPython: ${deviceValue(locale, device.microPythonVersion)}
${text.firmware}: ${deviceValue(locale, device.firmwareInfo)}
boot_option: ${device.bootOption ?? text.unavailable}
${text.execution}
${mismatch ? text.mismatch : ''}

## ${text.stage}
${stageOutput}

## ${text.error}
${text.type}: ${error.exceptionType}
${text.message}: ${error.message}
Traceback:
${fenced(error.traceback)}

## ${text.log}
${fenced(terminalLog)}

${codeSection}${workshopSection}

## ${text.constraints}
${text.rules}
- ${blocked ? text.blocked : text.complete}
- ${text.evidence}`
  }
}
