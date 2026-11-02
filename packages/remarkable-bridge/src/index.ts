// remarkable-bridge: reMarkable documents without the cloud. See README.md.

export { RmFormatError } from './doc/json.ts';
export { parseMetadata, isTrashed, type Metadata, type ItemKind } from './doc/metadata.ts';
export { parseContent, type Content, type PageRef, type FileType } from './doc/content.ts';
export { openBundle, UUID_RE, type DocumentBundle, type Entry, type FileReader } from './doc/bundle.ts';
export { SourceError, type DocumentSource, type SourceErrorCode } from './sources/source.ts';
export { createFolderSource, type FolderSource, type FolderSourceOptions } from './sources/folder.ts';
export { createDesktopSource, desktopLibraryCandidates, findDesktopLibrary, type DesktopLibraryOptions, type DesktopSource, type DesktopSourceOptions } from './sources/desktop.ts';
export { openRmdoc, rmdocIds, type OpenRmdocOptions } from './sources/rmdoc.ts';
export { readZip, writeZip, type ZipArchive, type ZipEntry, type ZipInput, type ZipReadOptions, type ZipWriteOptions } from './zip.ts';

export { readPage, RM2_PAGE, type Page, type Layer, type Stroke, type Highlight } from './rm/page.ts';
export { Points, type DecodedPoints } from './rm/points.ts';
export { Pen, PenColor, ParagraphStyle, toolOf, colorOf, argbToRgba, type Tool, type Rgba } from './rm/codes.ts';
export type { TypedText, Paragraph, ParagraphKind, TextSpan } from './rm/text.ts';
export { readBlocks, isV6, type Block } from './rm/blocks.ts';

export { pageToSvg, type SvgOptions } from './render/svg.ts';
export { pdfMapping, notebookFrame, UNITS_PER_POINT, type PdfBox, type PdfMapping } from './geometry.ts';
export { pageMarkdown, textMarkdown, highlightsOf, type PassageHighlight } from './extract/markdown.ts';
export { readDocument, documentMarkdown, type ReadDocument, type DocumentPage } from './document.ts';
export { documentToPdf, type PdfOptions } from './export/pdf.ts';
export { drawHighlights, shownToPdf, type PageHighlights, type ShownRect, type HighlightOptions } from './export/marks.ts';
export { readHandwriting, hasHandwriting, handwritingPdf, recognizeOnMac, MACHINE_READ, type Handwriting, type HandwrittenLine, type HandwritingCache, type ReadHandwritingOptions, type ReadHandwritingResult, type RawLine, type Recognizer } from './ocr/handwriting.ts';
