/** NanoLED v2の登録操作。共通操作・スライダー・物理ボタン・LED数は含めない。 */
export const MAX_NAMED_CONTROLS = 16
export const MAX_CONTROL_MODES = MAX_NAMED_CONTROLS
export const MAX_CONTROL_ACTIONS = MAX_NAMED_CONTROLS - 1

/** 同梱候補は無線ON時にSPARKLEを1つ登録する。汎用プロトコルの固定配分ではない。 */
export const STARTER_FIXED_ACTION_COUNT = 1
export const MAX_WIRELESS_STARTER_MODES = MAX_NAMED_CONTROLS - STARTER_FIXED_ACTION_COUNT
