/**
 * Aggregates the catalog JSON files into one object.
 *
 * The catalog is plain data. Validation lives in `@vanillate/core/validate` and compilation
 * (rule expansion, indexes) in `@vanillate/core`. `scripts/catalog-check.ts` fails when a JSON
 * file exists on disk but is not listed here.
 */

import categories from './categories.json' with { type: 'json' };
import limitations from './limitations.json' with { type: 'json' };
import limits from './limits.json' with { type: 'json' };
import options from './options.json' with { type: 'json' };
import popular from './popular.json' with { type: 'json' };
import tools from './tools.json' with { type: 'json' };
import formats3d from './formats/3d.json' with { type: 'json' };
import formatsArchive from './formats/archive.json' with { type: 'json' };
import formatsAudio from './formats/audio.json' with { type: 'json' };
import formatsCad from './formats/cad.json' with { type: 'json' };
import formatsData from './formats/data.json' with { type: 'json' };
import formatsDeveloper from './formats/developer.json' with { type: 'json' };
import formatsDocument from './formats/document.json' with { type: 'json' };
import formatsEbook from './formats/ebook.json' with { type: 'json' };
import formatsFont from './formats/font.json' with { type: 'json' };
import formatsImage from './formats/image.json' with { type: 'json' };
import formatsMetadata from './formats/metadata.json' with { type: 'json' };
import formatsPdf from './formats/pdf.json' with { type: 'json' };
import formatsPresentation from './formats/presentation.json' with { type: 'json' };
import formatsScientific from './formats/scientific.json' with { type: 'json' };
import formatsSpreadsheet from './formats/spreadsheet.json' with { type: 'json' };
import formatsSubtitle from './formats/subtitle.json' with { type: 'json' };
import formatsVector from './formats/vector.json' with { type: 'json' };
import formatsVideo from './formats/video.json' with { type: 'json' };
import formatsWeb from './formats/web.json' with { type: 'json' };
import engineAssimp from './engines/assimp.json' with { type: 'json' };
import engineBrowserArchive from './engines/browser-archive.json' with { type: 'json' };
import engineBrowserData from './engines/browser-data.json' with { type: 'json' };
import engineBrowserImage from './engines/browser-image.json' with { type: 'json' };
import engineBrowserSubtitle from './engines/browser-subtitle.json' with { type: 'json' };
import engineBrowserText from './engines/browser-text.json' with { type: 'json' };
import engineExiftool from './engines/exiftool.json' with { type: 'json' };
import engineFfmpeg from './engines/ffmpeg.json' with { type: 'json' };
import engineFonttools from './engines/fonttools.json' with { type: 'json' };
import engineGhostscript from './engines/ghostscript.json' with { type: 'json' };
import engineImagemagick from './engines/imagemagick.json' with { type: 'json' };
import engineLibreoffice from './engines/libreoffice.json' with { type: 'json' };
import enginePandoc from './engines/pandoc.json' with { type: 'json' };
import enginePoppler from './engines/poppler.json' with { type: 'json' };
import engineQpdf from './engines/qpdf.json' with { type: 'json' };
import engineRsvg from './engines/rsvg.json' with { type: 'json' };
import engineSevenzip from './engines/sevenzip.json' with { type: 'json' };
import rulesArchive from './conversions/archive.json' with { type: 'json' };
import rulesData from './conversions/data.json' with { type: 'json' };
import rulesDocument from './conversions/document.json' with { type: 'json' };
import rulesImage from './conversions/image.json' with { type: 'json' };
import rulesMedia from './conversions/media.json' with { type: 'json' };
import rulesPdf from './conversions/pdf.json' with { type: 'json' };
import rulesSpecialized from './conversions/specialized.json' with { type: 'json' };
import rulesSpreadsheet from './conversions/spreadsheet.json' with { type: 'json' };

/** Relative paths of every JSON file included below (checked by `catalog:check`). */
export const CATALOG_FILES = [
  'categories.json',
  'limitations.json',
  'limits.json',
  'options.json',
  'popular.json',
  'tools.json',
  'formats/3d.json',
  'formats/archive.json',
  'formats/audio.json',
  'formats/cad.json',
  'formats/data.json',
  'formats/developer.json',
  'formats/document.json',
  'formats/ebook.json',
  'formats/font.json',
  'formats/image.json',
  'formats/metadata.json',
  'formats/pdf.json',
  'formats/presentation.json',
  'formats/scientific.json',
  'formats/spreadsheet.json',
  'formats/subtitle.json',
  'formats/vector.json',
  'formats/video.json',
  'formats/web.json',
  'engines/assimp.json',
  'engines/browser-archive.json',
  'engines/browser-data.json',
  'engines/browser-image.json',
  'engines/browser-subtitle.json',
  'engines/browser-text.json',
  'engines/exiftool.json',
  'engines/ffmpeg.json',
  'engines/fonttools.json',
  'engines/ghostscript.json',
  'engines/imagemagick.json',
  'engines/libreoffice.json',
  'engines/pandoc.json',
  'engines/poppler.json',
  'engines/qpdf.json',
  'engines/rsvg.json',
  'engines/sevenzip.json',
  'conversions/archive.json',
  'conversions/data.json',
  'conversions/document.json',
  'conversions/image.json',
  'conversions/media.json',
  'conversions/pdf.json',
  'conversions/specialized.json',
  'conversions/spreadsheet.json',
] as const;

export const rawCatalog = {
  categories: categories.categories,
  formats: [
    ...formats3d.formats,
    ...formatsArchive.formats,
    ...formatsAudio.formats,
    ...formatsCad.formats,
    ...formatsData.formats,
    ...formatsDeveloper.formats,
    ...formatsDocument.formats,
    ...formatsEbook.formats,
    ...formatsFont.formats,
    ...formatsImage.formats,
    ...formatsMetadata.formats,
    ...formatsPdf.formats,
    ...formatsPresentation.formats,
    ...formatsScientific.formats,
    ...formatsSpreadsheet.formats,
    ...formatsSubtitle.formats,
    ...formatsVector.formats,
    ...formatsVideo.formats,
    ...formatsWeb.formats,
  ],
  engines: [
    engineAssimp.engine,
    engineBrowserArchive.engine,
    engineBrowserData.engine,
    engineBrowserImage.engine,
    engineBrowserSubtitle.engine,
    engineBrowserText.engine,
    engineExiftool.engine,
    engineFfmpeg.engine,
    engineFonttools.engine,
    engineGhostscript.engine,
    engineImagemagick.engine,
    engineLibreoffice.engine,
    enginePandoc.engine,
    enginePoppler.engine,
    engineQpdf.engine,
    engineRsvg.engine,
    engineSevenzip.engine,
  ],
  options: options.options,
  limitations: limitations.limitations,
  rules: [
    ...rulesArchive.rules,
    ...rulesData.rules,
    ...rulesDocument.rules,
    ...rulesImage.rules,
    ...rulesMedia.rules,
    ...rulesPdf.rules,
    ...rulesSpecialized.rules,
    ...rulesSpreadsheet.rules,
  ],
  tools: tools.tools,
  limits,
  popular,
};
