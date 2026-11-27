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
    aboutText: '원본 저작권과 라이선스는 NOTICE에 따릅니다. 파일은 앱의 Documents 폴더(파일 앱 › AllEditor)에 저장됩니다.',
    save2: '저장 중…', tabs: '탭',
    keyConfirm: '이 Keynote 파일(.key)은 직접 변환하면 표가 비거나 글자가 겹치는 등 모양이 달라질 수 있습니다.\n\n원본과 거의 같게 열려면 Keynote 앱에서 [공유(…) › 내보내기 › PowerPoint]로 내보내 iCloud Drive › AllEditor 폴더에 저장한 뒤 그 .pptx 파일을 여세요. (최신 Keynote의 Keynote 교환 형식 .keyx도 정확합니다.)\n\n그래도 지금 이 파일을 변환해 열까요?',
    iworkConfirm: 'Apple iWork 파일을 편집 가능한 사본(docx/pptx/xlsx)으로 변환해 엽니다. 텍스트·표·이미지·차트는 유지되고, 수식은 계산 결과 값으로, 페이지 레이아웃과 애니메이션은 단순화됩니다. 원본은 그대로 보존됩니다.',
    converting: '변환 중…', convertFailed: '변환 실패',
    printers: '프린터', printerName: '이름', printerHost: 'IP 주소', printerProto: '방식', protoAuto: '자동 (IPP → RAW)', protoIpp: 'IPP (포트 631)', protoRaw: 'RAW (포트 9100)',
    addPrinter: '프린터 추가', test: '테스트 인쇄', remove: '삭제', iosPrint: 'iOS 인쇄 창 테스트 (AirPrint)', printOk: '인쇄 작업을 보냈습니다', printFail: '인쇄 실패',
    printerHint: '같은 Wi-Fi 네트워크의 프린터 IP를 입력하세요. 앱의 인쇄 창에서 이 프린터를 고르면 PDF를 직접 보냅니다. PDF를 직접 받을 수 있는 프린터(IPP 또는 RAW 9100)만 지원합니다.',
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
    aboutText: 'Original copyrights and license: see NOTICE. Files live in the app’s Documents folder (Files › AllEditor).',
    save2: 'Saving…', tabs: 'Tabs',
    keyConfirm: 'Converting this Keynote file (.key) directly can change its look (empty tables, overlapping text).\n\nFor a near-exact copy, export it from the Keynote app with [Share (…) › Export › PowerPoint], save it to iCloud Drive › AllEditor and open that .pptx. (The Keynote Interchange Format .keyx of recent Keynote is exact as well.)\n\nConvert and open this file anyway?',
    iworkConfirm: 'This Apple iWork file will be converted to an editable copy (docx/pptx/xlsx). Text, tables, images and charts are kept; formulas become their calculated values; page layout and animations are simplified. The original is left untouched.',
    converting: 'Converting…', convertFailed: 'Conversion failed',
    printers: 'Printers', printerName: 'Name', printerHost: 'IP address', printerProto: 'Method', protoAuto: 'Auto (IPP → RAW)', protoIpp: 'IPP (port 631)', protoRaw: 'RAW (port 9100)',
    addPrinter: 'Add printer', test: 'Test print', remove: 'Remove', iosPrint: 'iOS print dialog test (AirPrint)', printOk: 'Print job sent', printFail: 'Print failed',
    printerHint: 'Enter the IP of a printer on the same Wi-Fi network. Pick it in an app’s print dialog to send the PDF directly. Only printers that accept PDF directly (IPP or RAW 9100) are supported.',
  },
}
export const LANGS: Array<[string, string]> = [['ko', '한국어'], ['en', 'English'], ['zh', '中文'], ['ja', '日本語'], ['fr', 'Français'], ['de', 'Deutsch'], ['es', 'Español'], ['th', 'ไทย'], ['id', 'Bahasa Indonesia'], ['ru', 'Русский'], ['ar', 'العربية']]
export const uiLang = (code: string): Lang => (code === 'ko' ? 'ko' : 'en')
export const tr = (lang: string, key: string) => D[uiLang(lang)][key] ?? key
