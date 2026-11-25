export type Lang = 'ko' | 'en'
const D: Record<Lang, Record<string, string>> = {
  ko: {
    home: '홈', settings: '설정', openFile: '로컬 파일 열기…', newDoc: '새 문서', newSlides: '새 슬라이드', newSheet: '새 스프레드시트',
    newSection: '새로 만들기', recent: '문서 목록', empty: '문서가 없습니다. “로컬 파일 열기”를 누르거나 새로 만드세요.',
    unsupported: '지원하지 않는 파일 형식입니다', del: '삭제', confirmDel: '파일을 삭제할까요?', closeTab: '탭 닫기',
    general: '일반', language: '언어', theme: '테마', themeSystem: '시스템', themeLight: '라이트', themeDark: '다크',
    docTheme: '문서 페이지 테마', follow: 'UI 따라가기', unit: '측정 단위', author: '작성자 이름', autosave: '자동 저장 기본값', on: '켜기', off: '끄기',
    ai: 'AI 모델', provider: '제공자', apiKey: 'API 키', model: '모델', baseUrl: '기본 URL', save: '저장', saved: '저장했습니다',
    aiNote: 'API 키는 이 기기의 앱 전용 저장소에만 보관되며 AI 요청 시 선택한 제공자로 전송됩니다.',
    gsk: 'Genspark 계정 로그인은 iOS 버전에서 지원하지 않습니다. 다른 제공자를 선택하세요.',
    reloadHint: '언어·테마 변경은 열려 있는 탭을 다시 불러와 적용합니다.', applied: '적용됨', about: '정보',
    aboutText: 'AllEditor — GenOffice(Apache-2.0)의 iOS 포트. 파일은 앱의 Documents 폴더(파일 앱 › AllEditor)에 저장됩니다.',
    save2: '저장 중…', tabs: '탭',
  },
  en: {
    home: 'Home', settings: 'Settings', openFile: 'Open local file…', newDoc: 'New document', newSlides: 'New slides', newSheet: 'New spreadsheet',
    newSection: 'New', recent: 'Documents', empty: 'No documents yet. Tap “Open local file” or create a new one.',
    unsupported: 'Unsupported file type', del: 'Delete', confirmDel: 'Delete this file?', closeTab: 'Close tab',
    general: 'General', language: 'Language', theme: 'Theme', themeSystem: 'System', themeLight: 'Light', themeDark: 'Dark',
    docTheme: 'Document page theme', follow: 'Follow UI', unit: 'Measurement unit', author: 'Author name', autosave: 'AutoSave default', on: 'On', off: 'Off',
    ai: 'AI model', provider: 'Provider', apiKey: 'API key', model: 'Model', baseUrl: 'Base URL', save: 'Save', saved: 'Saved',
    aiNote: 'The API key is kept in this app’s private storage and sent to the selected provider with AI requests.',
    gsk: 'Genspark account sign-in is not supported on iOS. Pick another provider.',
    reloadHint: 'Language and theme changes reload the open tabs.', applied: 'Applied', about: 'About',
    aboutText: 'AllEditor — iOS port of GenOffice (Apache-2.0). Files live in the app’s Documents folder (Files › AllEditor).',
    save2: 'Saving…', tabs: 'Tabs',
  },
}
export const LANGS: Array<[string, string]> = [['ko', '한국어'], ['en', 'English'], ['zh', '中文'], ['ja', '日本語'], ['fr', 'Français'], ['de', 'Deutsch'], ['es', 'Español'], ['th', 'ไทย'], ['id', 'Bahasa Indonesia'], ['ru', 'Русский'], ['ar', 'العربية']]
export const uiLang = (code: string): Lang => (code === 'ko' ? 'ko' : 'en')
export const tr = (lang: string, key: string) => D[uiLang(lang)][key] ?? key
