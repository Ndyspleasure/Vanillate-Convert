/**
 * Error model.
 *
 * Every failure has a stable `code` that clients can map to a localized, actionable message.
 * Codes are classified by kind (CLAUDE.md §23):
 *
 *   user            — the request or file cannot be processed as given; the user can fix it;
 *   developer       — the API was called incorrectly (bad request shape, wrong usage);
 *   system          — an unexpected bug in our code;
 *   engine          — a conversion engine failed or produced an invalid result;
 *   infrastructure  — storage, queue, workers or configuration are unavailable.
 *
 * Internal details (engine stderr, stack traces) live in `detail` and are only logged; they
 * are never sent to users.
 */
import type { Locale } from '../catalog/constants.ts';

export type ErrorKind = 'user' | 'developer' | 'system' | 'engine' | 'infrastructure';

interface ErrorSpec {
  kind: ErrorKind;
  /** HTTP status used by the API. */
  status: number;
  /** Whether retrying the same request may succeed. */
  retryable: boolean;
  message: Record<Locale, string>;
}

export const ERRORS = {
  // ------------------------------------------------------------------ user
  'file-empty': {
    kind: 'user',
    status: 422,
    retryable: false,
    message: {
      en: 'This file is empty. Choose a file that contains data.',
      id: 'File ini kosong. Pilih file yang berisi data.',
    },
  },
  'file-too-large': {
    kind: 'user',
    status: 413,
    retryable: false,
    message: {
      en: 'This file is larger than the limit for this conversion. Try a smaller file.',
      id: 'Ukuran file melebihi batas untuk konversi ini. Coba file yang lebih kecil.',
    },
  },
  'total-too-large': {
    kind: 'user',
    status: 413,
    retryable: false,
    message: {
      en: 'Together these files are too large. Convert fewer files at once.',
      id: 'Total ukuran file terlalu besar. Konversi lebih sedikit file sekaligus.',
    },
  },
  'too-many-files': {
    kind: 'user',
    status: 422,
    retryable: false,
    message: {
      en: 'Too many files at once. Remove some files and try again.',
      id: 'Terlalu banyak file sekaligus. Kurangi jumlah file lalu coba lagi.',
    },
  },
  'format-unknown': {
    kind: 'user',
    status: 415,
    retryable: false,
    message: {
      en: "We couldn't recognize this file's format.",
      id: 'Kami tidak bisa mengenali format file ini.',
    },
  },
  'format-mismatch': {
    kind: 'user',
    status: 415,
    retryable: false,
    message: {
      en: "This file's contents don't match the expected format. It may be renamed or damaged.",
      id: 'Isi file ini tidak sesuai dengan format yang diharapkan. File mungkin diganti namanya atau rusak.',
    },
  },
  'conversion-unsupported': {
    kind: 'user',
    status: 422,
    retryable: false,
    message: {
      en: "This conversion isn't available. Choose another output format.",
      id: 'Konversi ini tidak tersedia. Pilih format hasil yang lain.',
    },
  },
  'invalid-options': {
    kind: 'user',
    status: 422,
    retryable: false,
    message: {
      en: 'Some settings are not valid. Check the highlighted options.',
      id: 'Beberapa pengaturan tidak valid. Periksa opsi yang ditandai.',
    },
  },
  'input-corrupt': {
    kind: 'user',
    status: 422,
    retryable: false,
    message: {
      en: "We couldn't read this file. It may be damaged, incomplete or use a feature we don't support yet.",
      id: 'Kami tidak bisa membaca file ini. File mungkin rusak, tidak lengkap, atau memakai fitur yang belum didukung.',
    },
  },
  'password-protected': {
    kind: 'user',
    status: 422,
    retryable: false,
    message: {
      en: 'This file is password protected. Remove the password and try again.',
      id: 'File ini dilindungi kata sandi. Hapus kata sandinya lalu coba lagi.',
    },
  },
  'image-too-large': {
    kind: 'user',
    status: 422,
    retryable: false,
    message: {
      en: 'This image has too many pixels to process. Resize it and try again.',
      id: 'Gambar ini memiliki terlalu banyak piksel untuk diproses. Perkecil ukurannya lalu coba lagi.',
    },
  },
  'media-too-long': {
    kind: 'user',
    status: 422,
    retryable: false,
    message: {
      en: 'This recording is longer than the limit for this conversion. Trim it and try again.',
      id: 'Durasi rekaman melebihi batas untuk konversi ini. Potong rekamannya lalu coba lagi.',
    },
  },
  'too-many-pages': {
    kind: 'user',
    status: 422,
    retryable: false,
    message: {
      en: 'This document has too many pages. Choose a page range and try again.',
      id: 'Dokumen ini memiliki terlalu banyak halaman. Pilih rentang halaman lalu coba lagi.',
    },
  },
  'no-subtitle-track': {
    kind: 'user',
    status: 422,
    retryable: false,
    message: {
      en: "This video doesn't contain a text subtitle track to extract.",
      id: 'Video ini tidak memiliki trek subtitle teks yang bisa diekstrak.',
    },
  },
  'no-audio-track': {
    kind: 'user',
    status: 422,
    retryable: false,
    message: {
      en: "This file doesn't contain an audio track.",
      id: 'File ini tidak memiliki trek audio.',
    },
  },
  'font-flavor-mismatch': {
    kind: 'user',
    status: 422,
    retryable: false,
    message: {
      en: 'This font uses a different outline type than the chosen format. Try converting to the other format (TTF or OTF).',
      id: 'Font ini memakai jenis outline yang berbeda dari format yang dipilih. Coba konversi ke format lainnya (TTF atau OTF).',
    },
  },
  'archive-unsafe': {
    kind: 'user',
    status: 422,
    retryable: false,
    message: {
      en: 'This archive contains unsafe entries (such as links or paths outside the archive) and was not extracted.',
      id: 'Arsip ini berisi entri yang tidak aman (seperti link atau path di luar arsip) sehingga tidak diekstrak.',
    },
  },
  'archive-too-large': {
    kind: 'user',
    status: 422,
    retryable: false,
    message: {
      en: 'This archive expands to too much data or too many files to process safely.',
      id: 'Arsip ini mengembang menjadi data atau file yang terlalu banyak untuk diproses dengan aman.',
    },
  },
  'page-range-invalid': {
    kind: 'user',
    status: 422,
    retryable: false,
    message: {
      en: "The selected pages don't exist in this document.",
      id: 'Halaman yang dipilih tidak ada di dokumen ini.',
    },
  },
  'browser-unsupported': {
    kind: 'user',
    status: 422,
    retryable: false,
    message: {
      en: "Your browser can't process this file locally. Try an up-to-date Chrome, Edge, Firefox or Safari.",
      id: 'Browser kamu tidak bisa memproses file ini secara lokal. Coba Chrome, Edge, Firefox, atau Safari versi terbaru.',
    },
  },
  'rate-limited': {
    kind: 'user',
    status: 429,
    retryable: true,
    message: {
      en: "You've started many conversions in a short time. Please wait a moment and try again.",
      id: 'Kamu memulai banyak konversi dalam waktu singkat. Tunggu sebentar lalu coba lagi.',
    },
  },
  'job-not-found': {
    kind: 'user',
    status: 404,
    retryable: false,
    message: {
      en: "This conversion doesn't exist or has already been deleted.",
      id: 'Konversi ini tidak ada atau sudah dihapus.',
    },
  },
  'job-expired': {
    kind: 'user',
    status: 410,
    retryable: false,
    message: {
      en: 'This conversion has expired and its files were deleted for your privacy. Please convert the file again.',
      id: 'Konversi ini sudah kedaluwarsa dan file-nya dihapus demi privasimu. Silakan konversi ulang.',
    },
  },
  'job-not-ready': {
    kind: 'user',
    status: 409,
    retryable: true,
    message: {
      en: "The conversion isn't finished yet.",
      id: 'Konversi belum selesai.',
    },
  },
  'job-cancelled': {
    kind: 'user',
    status: 409,
    retryable: false,
    message: {
      en: 'This conversion was cancelled.',
      id: 'Konversi ini dibatalkan.',
    },
  },
  'upload-incomplete': {
    kind: 'user',
    status: 409,
    retryable: true,
    message: {
      en: "The upload didn't finish. Please try again.",
      id: 'Unggahan belum selesai. Silakan coba lagi.',
    },
  },
  unauthorized: {
    kind: 'user',
    status: 403,
    retryable: false,
    message: {
      en: "You don't have access to this conversion.",
      id: 'Kamu tidak memiliki akses ke konversi ini.',
    },
  },
  // ------------------------------------------------------------- developer
  'bad-request': {
    kind: 'developer',
    status: 400,
    retryable: false,
    message: {
      en: 'The request is not valid.',
      id: 'Permintaan tidak valid.',
    },
  },
  'not-found': {
    kind: 'developer',
    status: 404,
    retryable: false,
    message: {
      en: 'Not found.',
      id: 'Tidak ditemukan.',
    },
  },
  'method-not-allowed': {
    kind: 'developer',
    status: 405,
    retryable: false,
    message: {
      en: 'This method is not allowed.',
      id: 'Metode ini tidak diizinkan.',
    },
  },
  // ---------------------------------------------------------------- engine
  'conversion-failed': {
    kind: 'engine',
    status: 422,
    retryable: false,
    message: {
      en: "We couldn't convert this file. It may be damaged, unsupported, or use a feature this converter doesn't support yet.",
      id: 'Kami tidak bisa mengonversi file ini. File mungkin rusak, tidak didukung, atau memakai fitur yang belum didukung konverter ini.',
    },
  },
  'conversion-timeout': {
    kind: 'engine',
    status: 422,
    retryable: false,
    message: {
      en: 'The conversion took too long and was stopped. Try a smaller file or simpler settings.',
      id: 'Konversi memakan waktu terlalu lama dan dihentikan. Coba file yang lebih kecil atau pengaturan yang lebih sederhana.',
    },
  },
  'output-invalid': {
    kind: 'engine',
    status: 422,
    retryable: false,
    message: {
      en: "The converted file didn't pass our quality check, so we didn't deliver it.",
      id: 'File hasil konversi tidak lolos pemeriksaan kualitas, jadi tidak kami kirimkan.',
    },
  },
  'output-too-large': {
    kind: 'engine',
    status: 422,
    retryable: false,
    message: {
      en: 'The converted file would be too large. Try a lower quality or smaller size.',
      id: 'File hasil konversi akan terlalu besar. Coba kualitas atau ukuran yang lebih kecil.',
    },
  },
  // -------------------------------------------------------- infrastructure
  'server-processing-disabled': {
    kind: 'infrastructure',
    status: 503,
    retryable: false,
    message: {
      en: 'This conversion needs our processing servers, which are not enabled here yet.',
      id: 'Konversi ini membutuhkan server pemrosesan kami, yang belum diaktifkan di sini.',
    },
  },
  'server-unavailable': {
    kind: 'infrastructure',
    status: 503,
    retryable: true,
    message: {
      en: 'Our conversion servers are busy or temporarily unavailable. Please try again in a few minutes.',
      id: 'Server konversi kami sedang sibuk atau tidak tersedia sementara. Silakan coba lagi beberapa menit lagi.',
    },
  },
  'storage-error': {
    kind: 'infrastructure',
    status: 503,
    retryable: true,
    message: {
      en: 'We had trouble storing your file. Please try again.',
      id: 'Kami mengalami kendala saat menyimpan file kamu. Silakan coba lagi.',
    },
  },
  // ---------------------------------------------------------------- system
  'internal-error': {
    kind: 'system',
    status: 500,
    retryable: true,
    message: {
      en: 'Something went wrong on our side. Please try again.',
      id: 'Terjadi kesalahan di sisi kami. Silakan coba lagi.',
    },
  },
} as const satisfies Record<string, ErrorSpec>;

export type ErrorCode = keyof typeof ERRORS;

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.hasOwn(ERRORS, value);
}

export function errorSpec(code: ErrorCode): ErrorSpec {
  return ERRORS[code];
}

export function errorMessage(code: ErrorCode, locale: Locale): string {
  return ERRORS[code].message[locale];
}

/** Public shape of an error in API responses and job records. Never includes internals. */
export interface PublicError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  /** Optional structured, non-sensitive details (e.g. which options are invalid). */
  fields?: Record<string, string>;
}

export class VanillateError extends Error {
  override name = 'VanillateError';
  readonly code: ErrorCode;
  readonly kind: ErrorKind;
  readonly status: number;
  readonly retryable: boolean;
  /** Internal diagnostic detail for logs. Never sent to clients. */
  readonly detail: string | undefined;
  readonly fields: Record<string, string> | undefined;

  constructor(
    code: ErrorCode,
    options: {
      detail?: string;
      fields?: Record<string, string>;
      cause?: unknown;
      retryable?: boolean;
    } = {},
  ) {
    super(`${code}${options.detail ? `: ${options.detail}` : ''}`, { cause: options.cause });
    const spec = ERRORS[code];
    this.code = code;
    this.kind = spec.kind;
    this.status = spec.status;
    this.retryable = options.retryable ?? spec.retryable;
    this.detail = options.detail;
    this.fields = options.fields;
  }

  toPublic(locale: Locale = 'en'): PublicError {
    return {
      code: this.code,
      message: errorMessage(this.code, locale),
      retryable: this.retryable,
      ...(this.fields ? { fields: this.fields } : {}),
    };
  }
}

/** Converts anything thrown into a `VanillateError`, treating unknown errors as system errors. */
export function toVanillateError(error: unknown): VanillateError {
  if (error instanceof VanillateError) return error;
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return new VanillateError('internal-error', { detail, cause: error });
}
