# AllEditor bundled fonts

All files are under the SIL Open Font License 1.1 (license texts in `licenses/`). They ship in the app at
`office/hwp/studio/fonts/` (the 한글 editor reads its font files from there; the other editors use the same copy,
see `shim/runtime/fonts.ts`). Files are WOFF2-compressed copies; family names, glyphs and metrics are unchanged.

| Files | Family | Source |
|---|---|---|
| NanumGothic-Regular/Bold, NanumMyeongjo-Regular/Bold, NanumGothicCoding-Regular | 나눔고딕 · 나눔명조 · 나눔고딕코딩 (NAVER) | google/fonts @ 66928797 `ofl/nanum*` |
| NotoSansKR-ExtraLight/Regular/Bold | Noto Sans KR | google/fonts @ 66928797 `ofl/notosanskr` (static instances of the variable font, fontTools instancer) |
| NotoSerifKR-Regular/Bold, GowunBatang-Regular/Bold, GowunDodum-Regular | Noto Serif KR · 고운바탕 · 고운돋움 | 이음오피스 `packages/ui/template-fonts` |
| Pretendard-*.woff2 | Pretendard | npm `pretendard@1.3.9` `dist/web/static/woff2` |
| `tpl/*` | 이음오피스 design-template fonts (Pretendard, Noto Serif KR, Black Han Sans, Do Hyeon, Gowun, Bebas Neue, Space Grotesk, Playfair Display, Archivo Black) | 이음오피스 `packages/ui/template-fonts`, WOFF2 content under the original file names |
| Carlito-Regular/Bold, Caladea-Regular/Bold, LiberationSans-Regular/Bold | stand-ins for Calibri, Cambria, Segoe UI / Tahoma / Aptos (metric-compatible, OFL) | 이음오피스 `packages/ui/src/fonts`, `apps/docs/src/renderer/fonts` |

Windows / 한컴 font names the iPad lacks are drawn with these look-alikes (shim/runtime/fonts.ts `ALIASES`;
함초롬바탕·함초롬돋움 in the 한글 editor: ieumoffice-ios/apps/hwp/studio-plugin/ribbon.mjs). Documents keep their font names.
