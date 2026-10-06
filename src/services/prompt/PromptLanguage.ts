import { localeDefinition } from '../../i18n/locales'
import type { ExtendedLocale, Locale } from '../../i18n/types'

const guides: Record<ExtendedLocale, string> = {
  'zh-TW': '請用繁體中文回答、提問、提供選項、整理需求及撰寫程式註解。使用容易理解的語言，每次只問一個問題。以下共用技術規格以英文提供，不代表要改用英文回答。程式碼、紀錄、識別碼與使用者輸入保持原樣。',
  es: 'Responde, pregunta, presenta opciones, resume los requisitos y escribe comentarios del código en español sencillo. Haz una sola pregunta por respuesta. Las especificaciones técnicas compartidas siguientes están en inglés, pero no cambian el idioma de la conversación. Conserva sin traducir el código existente, los registros, los identificadores y los datos del usuario.',
  de: 'Antworte, stelle Fragen, biete Auswahlmöglichkeiten an, fasse Anforderungen zusammen und schreibe Codekommentare in einfachem Deutsch. Stelle pro Antwort nur eine Frage. Die folgenden gemeinsamen technischen Vorgaben sind auf Englisch; die Gesprächssprache bleibt Deutsch. Übersetze bestehenden Code, Protokolle, Kennungen und Nutzereingaben nicht.',
  fr: 'Réponds, pose les questions, propose les choix, résume les besoins et rédige les commentaires du code en français simple. Pose une seule question par réponse. Les spécifications techniques communes ci-dessous sont en anglais, mais la conversation reste en français. Ne traduis pas le code existant, les journaux, les identifiants ou les données de l’utilisateur.',
  ko: '답변, 질문, 선택지, 요구 사항 요약과 코드 주석은 쉬운 한국어로 작성하세요. 답변마다 질문은 하나만 하세요. 아래 공통 기술 사양은 영어로 제공되지만 대화 언어는 한국어로 유지하세요. 기존 코드, 로그, 식별자와 사용자 입력은 번역하지 마세요.',
  pt: 'Responda, faça perguntas, ofereça opções, resuma os requisitos e escreva os comentários do código em português simples. Faça apenas uma pergunta por resposta. As especificações técnicas compartilhadas abaixo estão em inglês, mas a conversa deve continuar em português. Não traduza código existente, registros, identificadores ou dados do usuário.',
}

export const promptLanguageName = (locale: Locale) => localeDefinition(locale).aiLanguage
export const promptLanguageGuide = (locale: ExtendedLocale) => `${guides[locale]}\nResponse language: ${promptLanguageName(locale)}. Apply this language to every question, choice, explanation, summary and new code comment.`
